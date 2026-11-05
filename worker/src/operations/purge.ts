import { AppError } from "../errors";
import { AuthContext, requireSuperAdmin } from "../auth/authorize";
import { auditWrite } from "../audit";
import { COMMIT_CHUNK_SIZE, type WriteOp } from "../firestore/client";
import { isGenerationOnlyFixture } from "../../../shared/bracket";
import { parseInput, purgeInput, deleteEntitiesInput, withdrawEntrantsInput } from "../validation";
import type { CompetitionDoc, FixtureDoc, ParticipantDoc, TeamDoc } from "../../../shared/types";

const PURGE_CHUNKS_PER_CALL = 20;

type Row<T> = { id: string; data: T };

const byCompetition = (competitionId: string) => [{ field: "competitionId", op: "EQUAL", value: competitionId }];

function seatsEntrant(fixture: FixtureDoc, kind: "PARTICIPANT" | "TEAM", id: string): boolean {
  return [fixture.slotA, fixture.slotB].some(
    (slot) => slot.kind === kind && (kind === "PARTICIPANT" ? slot.participantId : slot.teamId) === id
  );
}

const isSeated = (fixtures: Array<Row<FixtureDoc>>, collection: "participants" | "teams", id: string) =>
  fixtures.some((f) => seatsEntrant(f.data, collection === "participants" ? "PARTICIPANT" : "TEAM", id));

const isOnTeam = (teams: Array<Row<TeamDoc>>, participantId: string) =>
  teams.some((t) => t.data.memberIds.includes(participantId) || t.data.captainParticipantId === participantId);

interface PurgePlan {
  competition: CompetitionDoc;
  fixtures: Array<Row<FixtureDoc>>;
  teams: Array<Row<TeamDoc>>;
  participants: Array<Row<ParticipantDoc>>;
  blockers: Array<{ code: string; message: string }>;
}

async function buildPlan(
  ctx: AuthContext,
  competitionId: string,
  importBatchId: string | undefined,
  transaction: string
): Promise<PurgePlan> {
  const competition = await ctx.db.getDocument<CompetitionDoc>("competitions", competitionId, transaction);
  if (!competition) throw new AppError(404, "COMPETITION_NOT_FOUND", "Competition not found");

  const [allFixtures, allTeams, allParticipants] = await Promise.all([
    ctx.db.runQuery<FixtureDoc>("fixtures", byCompetition(competitionId), transaction),
    ctx.db.runQuery<TeamDoc>("teams", byCompetition(competitionId), transaction),
    ctx.db.runQuery<ParticipantDoc>("participants", byCompetition(competitionId), transaction),
  ]);
  const inScope = <T extends { importBatchId?: string }>(row: Row<T>) => !importBatchId || row.data.importBatchId === importBatchId;
  const fixtures = allFixtures.filter(inScope);
  const teams = allTeams.filter(inScope);
  const participants = allParticipants.filter(inScope);

  const blockers: PurgePlan["blockers"] = [];
  const operational = fixtures.filter((f) => !isGenerationOnlyFixture(f.data));
  if (operational.length > 0) {
    blockers.push({
      code: "FIXTURES_PUBLISHED_OR_PLAYED",
      message: `${operational.length} fixture(s) are already published, live or played. Their results are kept as history and cannot be removed here.`,
    });
  }

  const doomedFixtures = new Set(fixtures.map((f) => f.id));
  const doomedTeams = new Set(teams.map((t) => t.id));
  const remainingFixtures = allFixtures.filter((f) => !doomedFixtures.has(f.id));
  const remainingTeams = allTeams.filter((t) => !doomedTeams.has(t.id));

  const seatedTeams = teams.filter((t) => isSeated(remainingFixtures, "teams", t.id)).length;
  const seatedParticipants = participants.filter((p) => isSeated(remainingFixtures, "participants", p.id)).length;
  if (seatedTeams + seatedParticipants > 0) {
    blockers.push({
      code: "ENTITY_REFERENCED_BY_FIXTURE",
      message: `${seatedTeams + seatedParticipants} entrant(s) are still seated in fixtures that would remain.`,
    });
  }
  const stillOnTeams = participants.filter((p) => isOnTeam(remainingTeams, p.id)).length;
  if (stillOnTeams > 0) {
    blockers.push({
      code: "ENTITY_REFERENCED_BY_TEAM",
      message: `${stillOnTeams} participant(s) are still on teams that would remain.`,
    });
  }

  return { competition, fixtures, teams, participants, blockers };
}

function backupOf(plan: PurgePlan) {
  const entrant = <T extends object>(data: T) => {
    const { status: _status, importBatchId: _batch, ...rest } = data as T & { status?: string; importBatchId?: string };
    return rest;
  };
  return {
    schemaVersion: "kshitij.canonical/1",
    participants: plan.participants.map((p) => entrant(p.data)),
    teams: plan.teams.map((t) => entrant(t.data)),
    fixtures: plan.fixtures.map(({ data: f }) => ({
      fixtureId: f.fixtureId,
      competitionId: f.competitionId,
      round: f.round,
      matchNumber: f.matchNumber,
      slotA: f.slotA,
      slotB: f.slotB,
      ...(f.scheduledDate && f.scheduledTime ? { scheduledDate: f.scheduledDate, scheduledTime: f.scheduledTime } : {}),
      ...(f.venue ? { venue: f.venue } : {}),
      status: f.status === "SCHEDULED" ? "SCHEDULED" : "DRAFT",
    })),
  };
}

const countsOf = (plan: PurgePlan) => ({
  fixtures: plan.fixtures.length,
  teams: plan.teams.length,
  participants: plan.participants.length,
});

export async function previewPurge(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { competitionId, importBatchId } = parseInput(purgeInput, input);
  const transaction = await ctx.db.beginTransaction();
  try {
    const plan = await buildPlan(ctx, competitionId, importBatchId, transaction);
    const counts = countsOf(plan);
    const total = counts.fixtures + counts.teams + counts.participants;
    return {
      competitionId,
      importBatchId: importBatchId ?? null,
      counts,
      blockers: plan.blockers,
      canPurge: plan.blockers.length === 0 && total > 0,
      backup: backupOf(plan),
    };
  } finally {
    await ctx.db.rollback(transaction);
  }
}

export async function purgeCompetition(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { competitionId, importBatchId, confirm } = parseInput(purgeInput, input);
  if (confirm !== competitionId) {
    throw new AppError(400, "CONFIRMATION_MISMATCH", "Type the competition ID exactly to confirm the purge");
  }
  const transaction = await ctx.db.beginTransaction();
  try {
    const plan = await buildPlan(ctx, competitionId, importBatchId, transaction);
    if (plan.blockers.length > 0) {
      throw new AppError(409, "PURGE_BLOCKED", plan.blockers.map((b) => b.message).join(" "));
    }
    const all: Array<{ collection: string; id: string }> = [
      ...plan.fixtures.map((f) => ({ collection: "fixtures", id: f.id })),
      ...plan.teams.map((t) => ({ collection: "teams", id: t.id })),
      ...plan.participants.map((p) => ({ collection: "participants", id: p.id })),
    ];
    if (all.length === 0) throw new AppError(400, "NOTHING_TO_PURGE", "There is nothing to remove for this selection");

    const limit = PURGE_CHUNKS_PER_CALL * COMMIT_CHUNK_SIZE;
    const targets = all.slice(0, limit);
    const writes: WriteOp[] = targets.map((t) => ({ collection: t.collection, id: t.id, delete: true }));
    const idsIn = (rows: typeof targets, collection: string) => rows.filter((r) => r.collection === collection).map((r) => r.id);

    await ctx.db.commitChunked(transaction, writes, {
      verifyQueries: true,
      trailer: (index) => {
        const slice = targets.slice(index * COMMIT_CHUNK_SIZE, (index + 1) * COMMIT_CHUNK_SIZE);
        return auditWrite({
          action: "purgeCompetition",
          actorEmail: ctx.email,
          actorRole: ctx.admin.role,
          targetType: "competition",
          targetId: competitionId,
          before: {
            importBatchId: importBatchId ?? null,
            fixtures: idsIn(slice, "fixtures"),
            teams: idsIn(slice, "teams"),
            participants: idsIn(slice, "participants"),
          },
        });
      },
    });

    return {
      deleted: {
        fixtures: idsIn(targets, "fixtures").length,
        teams: idsIn(targets, "teams").length,
        participants: idsIn(targets, "participants").length,
      },
      remaining: all.length - targets.length,
    };
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }
}

interface BulkOutcome {
  id: string;
  code: string;
  message: string;
}

export async function deleteEntities(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { collection, competitionId, ids } = parseInput(deleteEntitiesInput, input);
  const unique = [...new Set(ids)];
  const transaction = await ctx.db.beginTransaction();
  try {
    const [entities, fixtures, teams] = await Promise.all([
      ctx.db.runQuery<ParticipantDoc | TeamDoc>(collection, byCompetition(competitionId), transaction),
      ctx.db.runQuery<FixtureDoc>("fixtures", byCompetition(competitionId), transaction),
      collection === "participants"
        ? ctx.db.runQuery<TeamDoc>("teams", byCompetition(competitionId), transaction)
        : Promise.resolve([] as Array<Row<TeamDoc>>),
    ]);
    const known = new Set(entities.map((e) => e.id));
    const deletable: string[] = [];
    const blocked: BulkOutcome[] = [];
    for (const id of unique) {
      if (!known.has(id)) {
        blocked.push({ id, code: "ENTITY_NOT_FOUND", message: "Not found in this competition" });
      } else if (isSeated(fixtures, collection, id)) {
        blocked.push({ id, code: "ENTITY_REFERENCED_BY_FIXTURE", message: "Seated in a fixture" });
      } else if (collection === "participants" && isOnTeam(teams, id)) {
        blocked.push({ id, code: "ENTITY_REFERENCED_BY_TEAM", message: "On a team" });
      } else {
        deletable.push(id);
      }
    }
    if (deletable.length === 0) {
      await ctx.db.rollback(transaction);
      return { deleted: [] as string[], blocked };
    }

    await ctx.db.commitChunked(
      transaction,
      deletable.map((id) => ({ collection, id, delete: true })),
      {
        verifyQueries: true,
        trailer: (index) =>
          auditWrite({
            action: "deleteEntities",
            actorEmail: ctx.email,
            actorRole: ctx.admin.role,
            targetType: collection === "teams" ? "team" : "participant",
            targetId: competitionId,
            before: { ids: deletable.slice(index * COMMIT_CHUNK_SIZE, (index + 1) * COMMIT_CHUNK_SIZE) },
          }),
      }
    );
    return { deleted: deletable, blocked };
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }
}

export async function withdrawEntrants(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { collection, competitionId, ids, reason } = parseInput(withdrawEntrantsInput, input);
  const unique = [...new Set(ids)];
  const transaction = await ctx.db.beginTransaction();
  try {
    const [entities, fixtures] = await Promise.all([
      ctx.db.runQuery<ParticipantDoc | TeamDoc>(collection, byCompetition(competitionId), transaction),
      ctx.db.runQuery<FixtureDoc>("fixtures", byCompetition(competitionId), transaction),
    ]);
    const byId = new Map(entities.map((e) => [e.id, e.data]));
    const withdrawable: string[] = [];
    const skipped: BulkOutcome[] = [];
    for (const id of unique) {
      const entity = byId.get(id);
      if (!entity) skipped.push({ id, code: "ENTITY_NOT_FOUND", message: "Not found in this competition" });
      else if (entity.status === "WITHDRAWN") skipped.push({ id, code: "ALREADY_WITHDRAWN", message: "Already withdrawn" });
      else withdrawable.push(id);
    }
    if (withdrawable.length === 0) {
      await ctx.db.rollback(transaction);
      return { withdrawn: [] as string[], skipped, affectedFixtureIds: [] as string[] };
    }

    const open = fixtures.filter((f) => f.data.status !== "COMPLETED" && f.data.status !== "CANCELLED");
    const affectedFixtureIds = open
      .filter((f) => withdrawable.some((id) => seatsEntrant(f.data, collection === "teams" ? "TEAM" : "PARTICIPANT", id)))
      .map((f) => f.id);

    await ctx.db.commitChunked(
      transaction,
      withdrawable.map((id) => ({ collection, id, data: { status: "WITHDRAWN" }, mergeFields: ["status"] })),
      {
        trailer: (index) =>
          auditWrite({
            action: "withdrawEntrants",
            actorEmail: ctx.email,
            actorRole: ctx.admin.role,
            targetType: collection === "teams" ? "team" : "participant",
            targetId: competitionId,
            reason,
            before: { ids: withdrawable.slice(index * COMMIT_CHUNK_SIZE, (index + 1) * COMMIT_CHUNK_SIZE) },
            after: { status: "WITHDRAWN", affectedFixtureIds },
          }),
      }
    );
    return { withdrawn: withdrawable, skipped, affectedFixtureIds };
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }
}
