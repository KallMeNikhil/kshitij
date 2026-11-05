import { AppError } from "../errors";
import { AuthContext, requireSportAccess, requireSuperAdmin } from "../auth/authorize";
import { auditWrite } from "../audit";
import { propagateWinner, isGenerationOnlyFixture } from "../../../shared/bracket";
import { crossCheckWinner, COMPLETION_OVERRIDE_KINDS } from "../../../shared/scoring/winnerCrossCheck";
import type { FixtureDoc, MatchStateDoc } from "../../../shared/types";
import type { FirestoreRestClient, WriteOp } from "../firestore/client";
import { resolveFixtureScoring } from "../scoring";
import { assertNoNewBracketIssues, loadFixtureEntrants } from "../entrants";
import { changedFixtureWrites, snapshotFixtures } from "../fixtureWrites";
import { parseInput, completeMatchInput, correctResultInput } from "../validation";

async function loadCompetitionFixtures(
  db: FirestoreRestClient,
  competitionId: string,
  transaction: string
): Promise<FixtureDoc[]> {
  const rows = await db.runQuery<FixtureDoc>(
    "fixtures",
    [{ field: "competitionId", op: "EQUAL", value: competitionId }],
    transaction
  );
  return rows.map((r) => r.data);
}

const isEntrantSlot = (kind: string) => kind === "PARTICIPANT" || kind === "TEAM";

export async function completeMatch(ctx: AuthContext, input: unknown) {
  const { fixtureId, winnerSlot, decidedBy, resultSummary, penalties } = parseInput(completeMatchInput, input);

  const transaction = await ctx.db.beginTransaction();
  try {
    const fixture = await ctx.db.getDocument<FixtureDoc>("fixtures", fixtureId, transaction);
    if (!fixture) throw new AppError(404, "FIXTURE_NOT_FOUND", "Fixture not found");
    requireSportAccess(ctx, fixture.sportId);

    const isWalkover = decidedBy === "WALKOVER";
    if (!(fixture.status === "LIVE" || (isWalkover && fixture.status === "SCHEDULED"))) {
      throw new AppError(400, "FIXTURE_NOT_LIVE", "Fixture is not live");
    }
    if (!isEntrantSlot(fixture.slotA.kind) || !isEntrantSlot(fixture.slotB.kind)) {
      throw new AppError(400, "SLOT_NOT_YET_DECIDED", "Both entrants must be decided before completion");
    }

    const { scoringModel, matchConfiguration } = await resolveFixtureScoring(ctx.db, fixture, transaction);

    const isOverride = decidedBy !== scoringModel;
    if (isOverride) {
      if (!(COMPLETION_OVERRIDE_KINDS as readonly string[]).includes(decidedBy)) {
        throw new AppError(
          400,
          "INVALID_DECIDED_BY",
          `decidedBy must be "${scoringModel}" or one of: ${COMPLETION_OVERRIDE_KINDS.join(", ")}`
        );
      }
      requireSuperAdmin(ctx);
      if (resultSummary.trim().length === 0) {
        throw new AppError(400, "OVERRIDE_REASON_REQUIRED", "An override completion needs an explanation");
      }
    }

    if (isWalkover && matchConfiguration?.walkoverBehavior === "BOTH_ELIMINATED") {
      throw new AppError(
        409,
        "WALKOVER_BEHAVIOR_NOT_SUPPORTED",
        "This competition is configured for BOTH_ELIMINATED walkovers, which bracket progression does not support yet; change walkoverBehavior to OPPONENT_WINS to record this walkover"
      );
    }

    const entrants = await loadFixtureEntrants(ctx.db, fixture, transaction);
    if (entrants[winnerSlot].withdrawn) {
      throw new AppError(
        409,
        "WINNER_WITHDRAWN",
        `${entrants[winnerSlot].label} has withdrawn and cannot be recorded as the winner`
      );
    }

    const allFixtures = await loadCompetitionFixtures(ctx.db, fixture.competitionId, transaction);
    const before = snapshotFixtures(allFixtures);
    const updated = propagateWinner(allFixtures, fixtureId, winnerSlot);
    assertNoNewBracketIssues([...before.values()], updated);

    const current = await ctx.db.getDocument<MatchStateDoc>("matchStates", fixtureId, transaction);
    const currentVersion = current?.version ?? 0;

    if (current?.data) {
      const crossCheck = crossCheckWinner(
        scoringModel,
        decidedBy,
        fixture.sportId,
        matchConfiguration,
        current.data,
        winnerSlot,
        { penalties }
      );
      if (!crossCheck.ok) {
        throw new AppError(400, "WINNER_DOES_NOT_MATCH_RECORDED_SCORE", crossCheck.message);
      }
    }

    const writes: WriteOp[] = changedFixtureWrites(before, updated);
    writes.push({
      collection: "matchStates",
      id: fixtureId,
      data: {
        fixtureId,
        version: currentVersion + 1,
        result: { winnerSlot, decidedBy, summary: resultSummary },
        ...(penalties ? { penalties } : {}),
      },
      mergeFields: ["fixtureId", "version", "result", ...(penalties ? ["penalties"] : [])],
    });
    writes.push(
      auditWrite({
        action: "completeMatch",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "fixture",
        targetId: fixtureId,
        before: { status: fixture.status },
        after: { status: "COMPLETED", winnerSlot, decidedBy, resultSummary, override: isOverride },
      })
    );

    await ctx.db.commit(transaction, writes);
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { ok: true };
}

function downstreamHasStarted(fixtures: FixtureDoc[], fromFixtureId: string): boolean {
  const byId = new Map(fixtures.map((f) => [f.fixtureId, f]));
  const source = byId.get(fromFixtureId);
  if (!source?.nextFixtureId) return false;
  const next = byId.get(source.nextFixtureId);
  if (!next) return false;

  if (next.status === "LIVE" || (next.status === "COMPLETED" && !isGenerationOnlyFixture(next))) return true;
  return downstreamHasStarted(fixtures, next.fixtureId);
}

export async function correctResult(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { fixtureId, winnerSlot, reason } = parseInput(correctResultInput, input);
  if (reason.trim().length === 0) {
    throw new AppError(400, "REASON_REQUIRED", "A reason is required");
  }

  const transaction = await ctx.db.beginTransaction();
  try {
    const fixture = await ctx.db.getDocument<FixtureDoc>("fixtures", fixtureId, transaction);
    if (!fixture) throw new AppError(404, "FIXTURE_NOT_FOUND", "Fixture not found");
    requireSportAccess(ctx, fixture.sportId);
    if (fixture.status !== "COMPLETED") {
      throw new AppError(400, "FIXTURE_NOT_COMPLETED", "Fixture is not completed");
    }
    if (fixture.slotA.kind === "BYE" || fixture.slotB.kind === "BYE") {
      throw new AppError(400, "CANNOT_CORRECT_BYE_FIXTURE", "A bye fixture has no result to correct");
    }

    const current = await ctx.db.getDocument<MatchStateDoc>("matchStates", fixtureId, transaction);
    const before = current?.result ?? null;
    if (before?.winnerSlot === winnerSlot) {
      throw new AppError(400, "RESULT_UNCHANGED", "That is already the recorded winner");
    }

    const allFixtures = await loadCompetitionFixtures(ctx.db, fixture.competitionId, transaction);

    if (downstreamHasStarted(allFixtures, fixtureId)) {
      throw new AppError(
        409,
        "CORRECTION_BLOCKED_DOWNSTREAM_STARTED",
        "A later-round fixture that depends on this result has already started or finished, so the result can no longer be corrected"
      );
    }

    const entrants = await loadFixtureEntrants(ctx.db, fixture, transaction);
    if (entrants[winnerSlot].withdrawn) {
      throw new AppError(
        409,
        "WINNER_WITHDRAWN",
        `${entrants[winnerSlot].label} has withdrawn and cannot be recorded as the winner`
      );
    }

    const snapshot = snapshotFixtures(allFixtures);
    const updated = propagateWinner(allFixtures, fixtureId, winnerSlot);
    assertNoNewBracketIssues([...snapshot.values()], updated);
    const writes: WriteOp[] = changedFixtureWrites(snapshot, updated);
    writes.push({
      collection: "matchStates",
      id: fixtureId,
      data: { version: (current?.version ?? 0) + 1, result: { ...(current?.result ?? {}), winnerSlot } },
      mergeFields: ["version", "result.winnerSlot"],
    });
    writes.push(
      auditWrite({
        action: "correctResult",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "fixture",
        targetId: fixtureId,
        reason,
        before,
        after: { winnerSlot },
      })
    );

    await ctx.db.commit(transaction, writes);
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { ok: true };
}
