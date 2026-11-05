import { AppError } from "../errors";
import { AuthContext, requireSuperAdmin } from "../auth/authorize";
import { auditWrite } from "../audit";
import { generateBracket as buildBracket, isGenerationOnlyFixture, Entrant } from "../../../shared/bracket";
import { parseInput, generateBracketInput, publishBracketInput } from "../validation";
import { validateBracketInvariants } from "../../../shared/bracketInvariants";
import { seededRandom, separateColleges, shuffleWith } from "../../../shared/draw";
import type { CompetitionDoc, ParticipantDoc, TeamDoc, FixtureDoc, SportDoc } from "../../../shared/types";

function orderEntrants<T>(rows: T[], idOf: (row: T) => string, entrantIds?: string[]): T[] {
  const sorted = [...rows].sort((a, b) => idOf(a).localeCompare(idOf(b)));
  if (!entrantIds || entrantIds.length === 0) return sorted;
  const byId = new Map(rows.map((r) => [idOf(r), r]));
  const listed = entrantIds.map((id) => byId.get(id)).filter((r): r is T => r !== undefined);
  const seen = new Set(listed.map(idOf));
  return [...listed, ...sorted.filter((r) => !seen.has(idOf(r)))];
}

interface Seeded<T> {
  rows: T[];
  drawSeed?: number;
}

function applySeedingStrategy<T extends { college?: string }>(
  rows: T[],
  idOf: (row: T) => string,
  competition: CompetitionDoc,
  entrantIds: string[] | undefined,
  withdrawnIds: Set<string>,
  drawSeed: number
): Seeded<T> {
  const seeding = competition.tournamentConfiguration?.seeding ?? "MANUAL";
  if (seeding === "RANDOM") {
    const shuffled = shuffleWith(orderEntrants(rows, idOf), seededRandom(drawSeed));
    const separate = competition.tournamentConfiguration?.separateColleges ?? true;
    return { rows: separate ? separateColleges(shuffled, (r) => r.college ?? "") : shuffled, drawSeed };
  }
  if (seeding === "RANKING") {
    throw new AppError(
      400,
      "SEEDING_STRATEGY_NOT_YET_SUPPORTED",
      "RANKING seeding is modeled but not yet implemented (no ranking/rating data source exists for entrants). Use MANUAL (with entrantIds) or RANDOM."
    );
  }
  const usable = entrantIds?.filter((id) => !withdrawnIds.has(id));
  assertEntrantIdsUsable(rows, idOf, usable);
  return { rows: orderEntrants(rows, idOf, usable) };
}

function assertEntrantIdsUsable<T>(rows: T[], idOf: (row: T) => string, entrantIds?: string[]): void {
  if (!entrantIds || entrantIds.length === 0) return;
  if (new Set(entrantIds).size !== entrantIds.length) {
    throw new AppError(400, "DUPLICATE_ENTRANT_IDS", "entrantIds contains the same entrant more than once");
  }
  const known = new Set(rows.map(idOf));
  const unusable = entrantIds.filter((id) => !known.has(id));
  if (unusable.length > 0) {
    throw new AppError(
      400,
      "UNKNOWN_ENTRANT_IDS",
      `Not active entrants of this competition: ${unusable.join(", ")}`
    );
  }
}

function isActiveEntrant(e: { status?: string }): boolean {
  return e.status !== "WITHDRAWN";
}

const SCHEDULE_FIELDS = ["scheduledDate", "scheduledTime", "venue"] as const;

async function regenerationBlocker(ctx: AuthContext, fixtures: FixtureDoc[], transaction: string): Promise<string | null> {
  for (const f of fixtures) {
    if (isGenerationOnlyFixture(f)) continue;
    if (f.status !== "SCHEDULED") return `${f.fixtureId} is ${f.status.toLowerCase()}`;
    const state = await ctx.db.getDocument<Record<string, unknown>>("matchStates", f.fixtureId, transaction);
    if (state) return `${f.fixtureId} already has a recorded score or result`;
  }
  return null;
}

export async function generateBracket(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { competitionId, entrantIds } = parseInput(generateBracketInput, input);
  const drawSeed = Math.floor(Math.random() * 2 ** 31);

  const transaction = await ctx.db.beginTransaction();
  try {
    const competition = await ctx.db.getDocument<CompetitionDoc>(
      "competitions",
      competitionId,
      transaction
    );
    if (!competition) throw new AppError(404, "COMPETITION_NOT_FOUND", "Competition not found");

    const existingFixtures = await ctx.db.runQuery<FixtureDoc>(
      "fixtures",
      [{ field: "competitionId", op: "EQUAL", value: competitionId }],
      transaction
    );

    const blocker = await regenerationBlocker(ctx, existingFixtures.map((d) => d.data), transaction);
    if (blocker) {
      throw new AppError(400, "COMPETITION_HAS_NON_DRAFT_FIXTURES", `The bracket can no longer be regenerated: ${blocker}`);
    }

    let entrants: Entrant[];
    let drawSeedUsed: number | undefined;
    if (competition.participantType === "INDIVIDUAL") {
      const rows = await ctx.db.runQuery<ParticipantDoc>(
        "participants",
        [{ field: "competitionId", op: "EQUAL", value: competitionId }],
        transaction
      );
      const withdrawn = new Set(rows.filter((d) => !isActiveEntrant(d.data)).map((d) => d.data.participantId));
      const seeded = applySeedingStrategy(rows.map((d) => d.data).filter(isActiveEntrant), (p) => p.participantId, competition, entrantIds, withdrawn, drawSeed);
      drawSeedUsed = seeded.drawSeed;
      entrants = seeded.rows.map((p) => ({ id: p.participantId, kind: "PARTICIPANT" as const }));
    } else {
      const rows = await ctx.db.runQuery<TeamDoc>(
        "teams",
        [{ field: "competitionId", op: "EQUAL", value: competitionId }],
        transaction
      );
      const withdrawn = new Set(rows.filter((d) => !isActiveEntrant(d.data)).map((d) => d.data.teamId));
      const seeded = applySeedingStrategy(rows.map((d) => d.data).filter(isActiveEntrant), (t) => t.teamId, competition, entrantIds, withdrawn, drawSeed);
      drawSeedUsed = seeded.drawSeed;
      entrants = seeded.rows.map((t) => ({ id: t.teamId, kind: "TEAM" as const }));
    }

    if (entrants.length < 2) {
      throw new AppError(400, "NOT_ENOUGH_ENTRANTS", "Not enough entrants");
    }

    const sport = competition.matchConfiguration
      ? null
      : await ctx.db.getDocument<SportDoc>("sports", competition.sportId, transaction);
    const effectiveConfiguration = competition.matchConfiguration ?? sport?.matchConfiguration;

    const { fixtures } = buildBracket(competitionId, competition.sportId, entrants, effectiveConfiguration);
    const structural = validateBracketInvariants(fixtures);
    if (structural.length > 0) {

      throw new AppError(500, "BRACKET_GENERATION_INVARIANT", `Generated bracket is inconsistent: ${structural[0].message}`);
    }

    const previous = new Map(existingFixtures.map((d) => [d.id, d.data]));
    for (const f of fixtures) {
      if (competition.published && f.status === "DRAFT") f.status = "SCHEDULED";
      const old = previous.get(f.fixtureId);
      if (!old) continue;
      for (const key of SCHEDULE_FIELDS) if (old[key] !== undefined) f[key] = old[key];
    }

    const writes = [];
    const newFixtureIds = new Set(fixtures.map((f) => f.fixtureId));
    for (const old of existingFixtures) {
      if (newFixtureIds.has(old.id)) continue;
      writes.push({ collection: "fixtures", id: old.id, delete: true as const });
    }
    for (const f of fixtures) {
      writes.push({ collection: "fixtures", id: f.fixtureId, data: f });
    }
    writes.push(
      auditWrite({
        action: "generateBracket",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "competition",
        targetId: competitionId,
        before: { replacedFixtureCount: existingFixtures.length },
        after: {
          fixtureCount: fixtures.length,
          seeding: competition.tournamentConfiguration?.seeding ?? "MANUAL",
          ...(drawSeedUsed !== undefined ? { drawSeed: drawSeedUsed } : {}),
          order: entrants.map((e) => e.id),
        },
      })
    );
    await ctx.db.commit(transaction, writes, { verifyQueries: true });
    return { fixtureCount: fixtures.length, ...(drawSeedUsed !== undefined ? { drawSeed: drawSeedUsed } : {}) };
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }
}

export async function publishBracket(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { competitionId } = parseInput(publishBracketInput, input);

  const transaction = await ctx.db.beginTransaction();
  try {
    const competition = await ctx.db.getDocument<CompetitionDoc>(
      "competitions",
      competitionId,
      transaction
    );
    if (!competition) throw new AppError(404, "COMPETITION_NOT_FOUND", "Competition not found");

    const allFixtures = await ctx.db.runQuery<FixtureDoc>(
      "fixtures",
      [{ field: "competitionId", op: "EQUAL", value: competitionId }],
      transaction
    );
    if (allFixtures.length === 0) {
      throw new AppError(400, "NO_FIXTURES_TO_PUBLISH", "Generate a bracket before publishing");
    }

    const draftFixtures = await ctx.db.runQuery<FixtureDoc>(
      "fixtures",
      [
        { field: "competitionId", op: "EQUAL", value: competitionId },
        { field: "status", op: "EQUAL", value: "DRAFT" },
      ],
      transaction
    );

    const writes = [
      { collection: "competitions", id: competitionId, data: { published: true }, mergeFields: ["published"] },
      ...draftFixtures.map((d) => ({
        collection: "fixtures",
        id: d.id,
        data: { status: "SCHEDULED" },
        mergeFields: ["status"],
      })),
      auditWrite({
        action: "publishBracket",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "competition",
        targetId: competitionId,
        after: { published: true, scheduledFixtureCount: draftFixtures.length },
      }),
    ];
    await ctx.db.commit(transaction, writes);
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { published: true };
}
