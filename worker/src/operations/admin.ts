import { AppError } from "../errors";
import { AuthContext, requireSuperAdmin } from "../auth/authorize";
import { auditWrite } from "../audit";
import { parseInput, manageAdminInput, upsertEntityInput, deleteEntityInput, createAnnouncementInput, deleteAnnouncementInput } from "../validation";
import type { AdminDoc, CompetitionDoc, ParticipantDoc, TeamDoc, SportDoc } from "../../../shared/types";
import { normalizePhone, slug } from "../../../shared/ids";
import { sportSchema, competitionSchema, participantSchema, teamSchema } from "../../../shared/schemas";
import { teamRosterSizeIssue } from "../../../shared/import-validator";
import type { z } from "zod";

export async function manageAdmin(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const body = parseInput(manageAdminInput, input);
  const email = body.email.toLowerCase();

  if (body.role === "SPORT_COORDINATOR" && (!body.sportIds || body.sportIds.length === 0)) {
    throw new AppError(400, "COORDINATOR_REQUIRES_SPORT_IDS", "Coordinator requires sportIds");
  }

  const transaction = await ctx.db.beginTransaction();
  try {

    if (body.role === "SPORT_COORDINATOR") {
      for (const sportId of new Set(body.sportIds ?? [])) {
        const sport = await ctx.db.getDocument<SportDoc>("sports", sportId, transaction);
        if (!sport) throw new AppError(400, "UNKNOWN_SPORT_ID", `Unknown sport: ${sportId}`);
      }
    }

    const before = await ctx.db.getDocument<AdminDoc>("admins", email, transaction);

    if (before?.role === "SUPER_ADMIN") {
      if (body.role !== "SUPER_ADMIN" || !body.active) {
        throw new AppError(400, "SUPER_ADMIN_PROTECTED", "The Super Admin account cannot be demoted or deactivated");
      }
    } else if (body.role === "SUPER_ADMIN") {
      throw new AppError(400, "SINGLE_SUPER_ADMIN", "There is exactly one Super Admin; no other account can be given that role");
    }

    const doc: AdminDoc = {
      email,
      displayName: body.displayName,
      role: body.role,
      sportIds: body.role === "SUPER_ADMIN" ? [] : [...new Set(body.sportIds ?? [])],
      active: body.active,
      createdAt: before ? before.createdAt : new Date().toISOString(),
      createdBy: before ? before.createdBy : ctx.email,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.email,
    };

    await ctx.db.commit(transaction, [
      { collection: "admins", id: email, data: doc, mergeFields: Object.keys(doc) },
      auditWrite({
        action: "manageAdmin",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "admin",
        targetId: email,
        before,
        after: doc,
      }),
    ]);
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { ok: true };
}

const UPSERTABLE_COLLECTIONS = ["sports", "competitions", "participants", "teams"] as const;
type UpsertableCollection = (typeof UPSERTABLE_COLLECTIONS)[number];

function assertUpsertableCollection(collection: string): asserts collection is UpsertableCollection {
  if (!(UPSERTABLE_COLLECTIONS as readonly string[]).includes(collection)) {
    throw new AppError(400, "INVALID_COLLECTION", "Not an upsertable collection");
  }
}

const ENTITY_SCHEMAS: Record<UpsertableCollection, { schema: z.ZodTypeAny; idField: string }> = {
  sports: { schema: sportSchema, idField: "sportId" },
  competitions: { schema: competitionSchema, idField: "competitionId" },
  participants: { schema: participantSchema, idField: "participantId" },
  teams: { schema: teamSchema, idField: "teamId" },
};

const CONFIG_GUARDED_FIELD = "matchConfiguration";

function validateTeamComposition(competition: CompetitionDoc, team: TeamDoc): void {
  if (competition.participantType === "INDIVIDUAL") {
    throw new AppError(400, "INVALID_COMPETITION_FOR_TEAM", "An individual competition does not take teams");
  }
  if (competition.participantType === "PAIR" && team.memberIds.length !== 2) {
    throw new AppError(400, "PAIR_REQUIRES_EXACTLY_TWO_MEMBERS", "A pair needs exactly two members");
  }
  const issue = teamRosterSizeIssue(competition, team.memberIds.length);
  if (issue) throw new AppError(400, issue.code, issue.message);
}

async function validateTeamMembers(ctx: AuthContext, team: TeamDoc, transaction: string): Promise<void> {
  for (const memberId of team.memberIds) {
    const member = await ctx.db.getDocument<ParticipantDoc>("participants", memberId, transaction);
    if (!member) throw new AppError(400, "UNKNOWN_PARTICIPANT", `Participant ${memberId} does not exist`);
    if (member.competitionId !== team.competitionId) {
      throw new AppError(400, "MEMBER_COMPETITION_MISMATCH", `${memberId} is registered in another competition`);
    }
  }
  const teams = await ctx.db.runQuery<TeamDoc>("teams", [{ field: "competitionId", op: "EQUAL", value: team.competitionId }], transaction);
  for (const other of teams) {
    if (other.id === team.teamId) continue;
    const shared = other.data.memberIds.find((id) => team.memberIds.includes(id));
    if (shared) throw new AppError(400, "PARTICIPANT_ALREADY_ON_TEAM", `${shared} is already on ${other.id}`);
  }
}

async function validateParticipant(ctx: AuthContext, participant: ParticipantDoc, transaction: string): Promise<void> {
  const competition = await ctx.db.getDocument<CompetitionDoc>("competitions", participant.competitionId, transaction);
  if (!competition) throw new AppError(400, "COMPETITION_NOT_FOUND", "Participant references an unknown competition");
  if (competition.sportId !== participant.sportId) {
    throw new AppError(400, "SPORT_COMPETITION_MISMATCH", "sportId does not match the competition's sport");
  }
  const others = await ctx.db.runQuery<ParticipantDoc>("participants", [{ field: "competitionId", op: "EQUAL", value: participant.competitionId }], transaction);
  const clash = others.find((o) => {
    if (o.id === participant.participantId) return false;
    try {
      return normalizePhone(o.data.phone) === participant.phone;
    } catch {
      return false;
    }
  });
  if (clash) throw new AppError(400, "DUPLICATE_PARTICIPANT", `${clash.id} is already registered with this phone number`);
}

function assertProtectedFieldsUnchanged(
  collection: UpsertableCollection,
  before: Record<string, unknown> | null,
  data: Record<string, unknown>
): void {
  if ((collection === "teams" || collection === "participants") && "status" in data) {
    const current = (before?.status as string | undefined) ?? "ACTIVE";
    if (data.status !== current) {
      throw new AppError(
        400,
        "USE_DEDICATED_WITHDRAWAL_OPERATION",
        "Entrant status cannot be changed via upsertEntity; use withdrawEntrant"
      );
    }
  }
  if (collection === "competitions" && "published" in data) {
    const current = (before?.published as boolean | undefined) ?? false;
    if (data.published !== current) {
      throw new AppError(
        400,
        "USE_DEDICATED_PUBLISH_OPERATION",
        "Competition published state cannot be changed via upsertEntity; use publishBracket"
      );
    }
  }
}

async function assertCompetitionStructureUnlocked(
  ctx: AuthContext,
  competitionId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  transaction: string
): Promise<void> {
  const changed = before.sportId !== after.sportId || before.participantType !== after.participantType;
  if (!changed) return;
  const fixtures = await ctx.db.runQuery("fixtures", [{ field: "competitionId", op: "EQUAL", value: competitionId }], transaction);
  if (fixtures.length > 0) {
    throw new AppError(
      400,
      "COMPETITION_STRUCTURE_LOCKED",
      "sportId and participantType cannot change once fixtures exist for this competition"
    );
  }
}

export async function upsertEntity(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { collection, id, data } = parseInput(upsertEntityInput, input);
  assertUpsertableCollection(collection);

  if ((collection === "sports" || collection === "competitions") && CONFIG_GUARDED_FIELD in data) {
    throw new AppError(
      400,
      "USE_DEDICATED_CONFIG_OPERATION",
      `matchConfiguration cannot be set via upsertEntity; use ${
        collection === "sports" ? "updateSportConfig" : "updateCompetitionConfig"
      } instead`
    );
  }

  const { schema, idField } = ENTITY_SCHEMAS[collection];

  const transaction = await ctx.db.beginTransaction();
  try {
    const before = await ctx.db.getDocument<Record<string, unknown>>(collection, id, transaction);

    assertProtectedFieldsUnchanged(collection, before, data);
    const merged = { ...(before ?? {}), ...data, [idField]: id };
    const parsed = schema.safeParse(merged);
    if (!parsed.success) {
      throw new AppError(
        400,
        "INVALID_ENTITY",
        parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
      );
    }
    const validated = parsed.data as Record<string, unknown>;
    if (collection === "participants") validated.phone = normalizePhone(String(validated.phone));
    if (collection === "teams" && typeof validated.captainPhone === "string") validated.captainPhone = normalizePhone(validated.captainPhone);
    if (collection === "sports") {
      validated.slug = typeof validated.slug === "string" && validated.slug.trim() ? slug(validated.slug) : slug(String(validated.name));
      const sameSlug = await ctx.db.runQuery("sports", [{ field: "slug", op: "EQUAL", value: validated.slug }], transaction);
      if (sameSlug.some((row) => row.id !== id)) throw new AppError(400, "DUPLICATE_SLUG", `Another sport already uses the address ${validated.slug}`);
    }
    if (collection === "competitions") {
      const sport = await ctx.db.getDocument<SportDoc>("sports", String(validated.sportId), transaction);
      if (!sport) throw new AppError(400, "UNKNOWN_SPORT", "Competition references an unknown sport");
    }
    if (collection === "participants") await validateParticipant(ctx, validated as unknown as ParticipantDoc, transaction);

    if (collection === "competitions" && before) {
      await assertCompetitionStructureUnlocked(ctx, id, before, validated, transaction);
    }
    if (collection === "sports" && before && before.scoringModel !== validated.scoringModel) {

      const fixtures = await ctx.db.runQuery("fixtures", [{ field: "sportId", op: "EQUAL", value: id }], transaction);
      if (fixtures.length > 0) {
        throw new AppError(400, "SCORING_MODEL_LOCKED", "A sport's scoring model cannot change once fixtures exist for it");
      }
    }

    if (collection === "teams") {
      const team = validated as unknown as TeamDoc;
      const competition = await ctx.db.getDocument<CompetitionDoc>("competitions", team.competitionId, transaction);
      if (!competition) throw new AppError(400, "COMPETITION_NOT_FOUND", "Team references an unknown competition");
      validateTeamComposition(competition, team);
      await validateTeamMembers(ctx, team, transaction);
    }

    await ctx.db.commit(transaction, [

      { collection, id, data: validated, mergeFields: Object.keys(validated).filter((k) => k !== CONFIG_GUARDED_FIELD) },
      auditWrite({
        action: "upsertEntity",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: collection,
        targetId: id,
        before,
        after: validated,
      }),
    ]);
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { ok: true };
}

export async function deleteEntity(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { collection, id } = parseInput(deleteEntityInput, input);
  assertUpsertableCollection(collection);

  const transaction = await ctx.db.beginTransaction();
  try {
    const before = await ctx.db.getDocument<Record<string, unknown>>(collection, id, transaction);
    if (!before) throw new AppError(404, "ENTITY_NOT_FOUND", "Entity not found");

    const dependents: Array<[string, string]> =
      collection === "competitions"
        ? [["fixtures", "competitionId"], ["teams", "competitionId"], ["participants", "competitionId"]]
        : collection === "sports"
          ? [["competitions", "sportId"]]
          : [];
    for (const [childCollection, field] of dependents) {
      const children = await ctx.db.runQuery(childCollection, [{ field, op: "EQUAL", value: id }], transaction);
      if (children.length > 0) {
        throw new AppError(
          400,
          "ENTITY_HAS_DEPENDENTS",
          `Cannot delete: ${children.length} ${childCollection} still reference this ${collection.slice(0, -1)}`
        );
      }
    }

    if (collection === "participants" || collection === "teams") {
      const idField = collection === "participants" ? "participantId" : "teamId";
      const [referencingA, referencingB] = await Promise.all([
        ctx.db.runQuery("fixtures", [{ field: `slotA.${idField}`, op: "EQUAL", value: id }], transaction),
        ctx.db.runQuery("fixtures", [{ field: `slotB.${idField}`, op: "EQUAL", value: id }], transaction),
      ]);
      if (referencingA.length > 0 || referencingB.length > 0) {
        throw new AppError(400, "ENTITY_REFERENCED_BY_FIXTURE", "Entity is referenced by a fixture");
      }
    }

    if (collection === "participants") {
      const teamsWithMember = await ctx.db.runQuery(
        "teams",
        [{ field: "memberIds", op: "ARRAY_CONTAINS", value: id }],
        transaction
      );
      if (teamsWithMember.length > 0) {
        throw new AppError(400, "ENTITY_REFERENCED_BY_TEAM", "Participant is on a team");
      }
    }

    await ctx.db.commit(
      transaction,
      [
        { collection, id, delete: true },
        auditWrite({
          action: "deleteEntity",
          actorEmail: ctx.email,
          actorRole: ctx.admin.role,
          targetType: collection,
          targetId: id,
          before,
        }),
      ],
      { verifyQueries: true }
    );
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { ok: true };
}

export async function createAnnouncement(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { title, body, sportId } = parseInput(createAnnouncementInput, input);
  if (!title?.trim() || !body?.trim()) {
    throw new AppError(400, "TITLE_AND_BODY_REQUIRED", "Title and body are required");
  }
  const id = crypto.randomUUID();

  const transaction = await ctx.db.beginTransaction();
  try {
    await ctx.db.commit(transaction, [
      {
        collection: "announcements",
        id,
        data: {
          title,
          body,
          sportId: sportId ?? null,
          createdAt: new Date().toISOString(),
          createdBy: ctx.email,
        },
      },
      auditWrite({
        action: "createAnnouncement",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "announcement",
        targetId: id,
      }),
    ]);
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { id };
}

export async function deleteAnnouncement(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { id } = parseInput(deleteAnnouncementInput, input);

  const transaction = await ctx.db.beginTransaction();
  try {
    const before = await ctx.db.getDocument<Record<string, unknown>>("announcements", id, transaction);
    if (!before) throw new AppError(404, "ANNOUNCEMENT_NOT_FOUND", "Announcement not found");

    await ctx.db.commit(transaction, [
      { collection: "announcements", id, delete: true },
      auditWrite({
        action: "deleteAnnouncement",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "announcement",
        targetId: id,
        before,
      }),
    ]);
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { id };
}
