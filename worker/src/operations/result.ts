import { AppError } from "../errors";
import { AuthContext, requireSportAccess, requireSuperAdmin } from "../auth/authorize";
import { auditWrite } from "../audit";
import { propagateWinner, isGenerationOnlyFixture } from "../../../shared/bracket";
import { crossCheckWinner } from "../../../shared/scoring/winnerCrossCheck";
import {
  LEGACY_RESULT_TYPES,
  RESULT_TYPE_LABELS,
  coordinatorMayRecord,
  isEarlyEnd,
  isResultType,
  resultTypeAllowedFrom,
} from "../../../shared/results";
import type { FixtureDoc, MatchStateDoc } from "../../../shared/types";
import type { FirestoreRestClient, WriteOp } from "../firestore/client";
import { resolveFixtureScoring } from "../scoring";
import { assertNoNewBracketIssues, loadFixtureEntrants } from "../entrants";
import { changedFixtureWrites, snapshotFixtures } from "../fixtureWrites";
import { parseInput, completeMatchInput, correctResultInput, reopenMatchInput } from "../validation";

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
  const { fixtureId, winnerSlot, decidedBy, resultSummary, reason, penalties } = parseInput(completeMatchInput, input);

  const transaction = await ctx.db.beginTransaction();
  try {
    const fixture = await ctx.db.getDocument<FixtureDoc>("fixtures", fixtureId, transaction);
    if (!fixture) throw new AppError(404, "FIXTURE_NOT_FOUND", "Fixture not found");
    requireSportAccess(ctx, fixture.sportId);
    if (!isEntrantSlot(fixture.slotA.kind) || !isEntrantSlot(fixture.slotB.kind)) {
      throw new AppError(400, "SLOT_NOT_YET_DECIDED", "Both entrants must be decided before completion");
    }

    const { scoringModel, matchConfiguration } = await resolveFixtureScoring(ctx.db, fixture, transaction);
    const isScore = decidedBy === scoringModel;
    const legacy = (LEGACY_RESULT_TYPES as readonly string[]).includes(decidedBy);
    if (!isScore && !isResultType(decidedBy) && !legacy) {
      throw new AppError(400, "INVALID_DECIDED_BY", `decidedBy must be "${scoringModel}" or a result type`);
    }

    if (isScore) {
      if (fixture.status !== "LIVE") throw new AppError(400, "FIXTURE_NOT_LIVE", "Only a live match can be completed on its score");
    } else {
      const type = legacy ? "ADMIN_DECISION" : decidedBy;
      if (!coordinatorMayRecord(type)) requireSuperAdmin(ctx);
      if (!isResultType(type) || !resultTypeAllowedFrom(type, fixture.status, fixture.resumeStatus)) {
        throw new AppError(400, "RESULT_TYPE_NOT_ALLOWED", `A ${fixture.status} match cannot be ended as ${decidedBy.toLowerCase().replace(/_/g, " ")}`);
      }
      if (reason.trim().length === 0 && resultSummary.trim().length === 0) {
        throw new AppError(400, "REASON_REQUIRED", "Ending a match this way needs a reason");
      }
    }

    if (decidedBy === "WALKOVER" && matchConfiguration?.walkoverBehavior === "BOTH_ELIMINATED") {
      throw new AppError(
        409,
        "WALKOVER_BEHAVIOR_NOT_SUPPORTED",
        "This competition is configured for BOTH_ELIMINATED walkovers, which bracket progression does not support yet; change walkoverBehavior to OPPONENT_WINS to record this walkover"
      );
    }

    const entrants = await loadFixtureEntrants(ctx.db, fixture, transaction);
    if (entrants[winnerSlot].withdrawn) {
      throw new AppError(409, "WINNER_WITHDRAWN", `${entrants[winnerSlot].label} has withdrawn and cannot be recorded as the winner`);
    }

    const allFixtures = await loadCompetitionFixtures(ctx.db, fixture.competitionId, transaction);
    const nextFixture = fixture.nextFixtureId ? allFixtures.find((f) => f.fixtureId === fixture.nextFixtureId) : undefined;
    if (nextFixture && !isGenerationOnlyFixture(nextFixture) && nextFixture.status !== "SCHEDULED") {
      throw new AppError(409, "NEXT_FIXTURE_NOT_OPEN", `The next-round match is already ${nextFixture.status.toLowerCase()}, so a winner cannot be added to it`);
    }
    const before = snapshotFixtures(allFixtures);
    const updated = propagateWinner(allFixtures, fixtureId, winnerSlot);
    const source = updated.find((f) => f.fixtureId === fixtureId);
    if (source && fixture.status === "POSTPONED") {
      source.statusReason = undefined;
      source.resumeStatus = undefined;
    }
    assertNoNewBracketIssues([...before.values()], updated);

    const current = await ctx.db.getDocument<MatchStateDoc>("matchStates", fixtureId, transaction);
    let summary = resultSummary.trim();
    if (isScore) {
      const crossCheck = crossCheckWinner(scoringModel, decidedBy, fixture.sportId, matchConfiguration, current?.data, winnerSlot, { penalties });
      if (!crossCheck.ok) throw new AppError(400, "WINNER_DOES_NOT_MATCH_RECORDED_SCORE", crossCheck.message);
      summary = summary || crossCheck.summary || "";
    } else {
      summary = RESULT_TYPE_LABELS[decidedBy as keyof typeof RESULT_TYPE_LABELS];
    }
    const note = (reason || (isScore ? "" : resultSummary)).trim();

    const writes: WriteOp[] = changedFixtureWrites(before, updated);
    const withPenaltyData = isScore && penalties && scoringModel === "FOOTBALL_EVENTS" && current?.data;
    const fields = ["fixtureId", "version", "result", ...(penalties ? ["penalties"] : []), ...(withPenaltyData ? ["data.penalties"] : [])];
    writes.push({
      collection: "matchStates",
      id: fixtureId,
      data: {
        fixtureId,
        version: (current?.version ?? 0) + 1,
        result: { winnerSlot, decidedBy, summary, ...(note ? { reason: note } : {}) },
        ...(penalties ? { penalties } : {}),
        ...(withPenaltyData ? { data: { penalties } } : {}),
      },
      mergeFields: fields,
    });
    writes.push(
      auditWrite({
        action: "completeMatch",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "fixture",
        targetId: fixtureId,
        ...(note ? { reason: note } : {}),
        before: { status: fixture.status },
        after: { status: "COMPLETED", winnerSlot, decidedBy, summary, finalScore: current?.data ?? null, earlyEnd: !isScore },
      })
    );

    await ctx.db.commit(transaction, writes);
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { ok: true };
}

function downstreamBlock(fixtures: FixtureDoc[], fromFixtureId: string): string | null {
  const byId = new Map(fixtures.map((f) => [f.fixtureId, f]));
  let cursor = byId.get(fromFixtureId);
  const seen = new Set<string>();
  while (cursor?.nextFixtureId && !seen.has(cursor.nextFixtureId)) {
    seen.add(cursor.nextFixtureId);
    const next = byId.get(cursor.nextFixtureId);
    if (!next) return null;
    if (next.status === "LIVE" || (next.status === "COMPLETED" && !isGenerationOnlyFixture(next))) {
      return "A later-round match that depends on this result has already started or finished";
    }
    if (next.status === "POSTPONED" || next.status === "CANCELLED") {
      return `The next-round match is ${next.status.toLowerCase()}; resume or reinstate it first`;
    }
    cursor = next;
  }
  return null;
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
    const blocked = downstreamBlock(allFixtures, fixtureId);
    if (blocked) throw new AppError(409, "CORRECTION_BLOCKED_DOWNSTREAM_STARTED", `${blocked}, so the result can no longer be corrected`);

    const entrants = await loadFixtureEntrants(ctx.db, fixture, transaction);
    if (entrants[winnerSlot].withdrawn) {
      throw new AppError(409, "WINNER_WITHDRAWN", `${entrants[winnerSlot].label} has withdrawn and cannot be recorded as the winner`);
    }

    const snapshot = snapshotFixtures(allFixtures);
    const updated = propagateWinner(allFixtures, fixtureId, winnerSlot);
    assertNoNewBracketIssues([...snapshot.values()], updated);
    const keepType = before?.decidedBy && isEarlyEnd(before.decidedBy) ? before.decidedBy : "ADMIN_DECISION";
    const corrected = {
      winnerSlot,
      decidedBy: keepType,
      summary: RESULT_TYPE_LABELS[keepType as keyof typeof RESULT_TYPE_LABELS] ?? RESULT_TYPE_LABELS.ADMIN_DECISION,
      reason: reason.trim(),
    };
    const writes: WriteOp[] = changedFixtureWrites(snapshot, updated);
    writes.push({
      collection: "matchStates",
      id: fixtureId,
      data: { fixtureId, version: (current?.version ?? 0) + 1, result: corrected },
      mergeFields: ["fixtureId", "version", "result"],
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
        after: corrected,
      })
    );

    await ctx.db.commit(transaction, writes);
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { ok: true };
}

const LIVE_FLAGS: Record<string, string[]> = {
  FOOTBALL_EVENTS: ["ended"],
  BASKETBALL_POINTS: ["ended"],
};

export async function reopenMatch(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { fixtureId, reason } = parseInput(reopenMatchInput, input);

  const transaction = await ctx.db.beginTransaction();
  try {
    const fixture = await ctx.db.getDocument<FixtureDoc>("fixtures", fixtureId, transaction);
    if (!fixture) throw new AppError(404, "FIXTURE_NOT_FOUND", "Fixture not found");
    if (fixture.status !== "COMPLETED") throw new AppError(400, "FIXTURE_NOT_COMPLETED", "Only a completed match can be reopened");
    if (fixture.slotA.kind === "BYE" || fixture.slotB.kind === "BYE") {
      throw new AppError(400, "CANNOT_REOPEN_BYE_FIXTURE", "A bye has no score to reopen");
    }
    const current = await ctx.db.getDocument<MatchStateDoc>("matchStates", fixtureId, transaction);
    if (!current?.data) {
      throw new AppError(400, "NO_SCORE_TO_REOPEN", "This match has no recorded score; use Correct result instead");
    }

    const allFixtures = await loadCompetitionFixtures(ctx.db, fixture.competitionId, transaction);
    const blocked = downstreamBlock(allFixtures, fixtureId);
    if (blocked) throw new AppError(409, "REOPEN_BLOCKED_DOWNSTREAM_STARTED", `${blocked}, so this match can no longer be reopened`);

    const snapshot = snapshotFixtures(allFixtures);
    const byId = new Map(allFixtures.map((f) => [f.fixtureId, f]));
    const source = byId.get(fixtureId)!;
    source.status = "LIVE";
    const next = source.nextFixtureId ? byId.get(source.nextFixtureId) : undefined;
    if (next && source.nextSlot) {
      const key = source.nextSlot === "A" ? "slotA" : "slotB";
      next[key] = { kind: "FIXTURE_WINNER", fromFixtureId: fixtureId };
    }
    assertNoNewBracketIssues([...snapshot.values()], [...byId.values()]);

    const flags = LIVE_FLAGS[current.scoringModel] ?? [];
    const data: Record<string, unknown> = { ...current.data };
    for (const flag of flags) delete data[flag];
    const writes: WriteOp[] = changedFixtureWrites(snapshot, [...byId.values()]);
    writes.push({
      collection: "matchStates",
      id: fixtureId,
      data: { fixtureId, version: current.version + 1, data },
      mergeFields: ["fixtureId", "version", "data", "result", "penalties"],
    });
    writes.push(
      auditWrite({
        action: "reopenMatch",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "fixture",
        targetId: fixtureId,
        reason,
        before: { status: "COMPLETED", result: current.result ?? null, finalScore: current.data },
        after: { status: "LIVE" },
      })
    );

    await ctx.db.commit(transaction, writes);
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { ok: true };
}
