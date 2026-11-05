import { AppError } from "../errors";
import { AuthContext, requireSportAccess } from "../auth/authorize";
import { auditWrite } from "../audit";
import type { FixtureDoc, MatchStateDoc } from "../../../shared/types";
import { validateLiveState } from "../../../shared/scoring/stateSchemas";
import { isSchedulable, findVenueConflict } from "../../../shared/schedule";
import { resolveFixtureScoring } from "../scoring";
import { loadFixtureEntrants } from "../entrants";
import { parseInput, saveFixtureInput, fixtureIdInput, updateLiveStateInput, undoLiveStateInput } from "../validation";
import type { MatchConfiguration } from "../../../shared/matchConfig";
import { cricketOversFrom, tennisBestOfSetsFrom } from "../../../shared/scoring/fromMatchConfiguration";

export async function saveFixture(ctx: AuthContext, input: unknown) {
  const { fixtureId, scheduledDate, scheduledTime, venue } = parseInput(saveFixtureInput, input);

  const transaction = await ctx.db.beginTransaction();
  try {
    const fixture = await ctx.db.getDocument<FixtureDoc>("fixtures", fixtureId, transaction);
    if (!fixture) throw new AppError(404, "FIXTURE_NOT_FOUND", "Fixture not found");
    requireSportAccess(ctx, fixture.sportId);
    if (!isSchedulable(fixture.status)) {
      throw new AppError(
        400,
        "FIXTURE_NOT_EDITABLE",
        `A ${fixture.status} fixture cannot be rescheduled`
      );
    }

    const update: Partial<FixtureDoc> = {};
    if (scheduledDate) update.scheduledDate = scheduledDate;
    if (scheduledTime) update.scheduledTime = scheduledTime;
    if (venue !== undefined) update.venue = venue;

    const finalDate = scheduledDate ?? fixture.scheduledDate;
    const finalTime = scheduledTime ?? fixture.scheduledTime;
    if (Boolean(finalDate) !== Boolean(finalTime)) {
      throw new AppError(400, "SCHEDULE_DATE_AND_TIME_MUST_BE_TOGETHER", "Provide both a date and a time");
    }

    if (Object.keys(update).length === 0) {
      throw new AppError(400, "NOTHING_TO_UPDATE", "No schedule fields were provided");
    }

    const finalVenue = venue !== undefined ? venue : fixture.venue;
    if (finalDate && finalTime && finalVenue) {
      const sameDay = await ctx.db.runQuery<FixtureDoc>(
        "fixtures",
        [{ field: "scheduledDate", op: "EQUAL", value: finalDate }],
        transaction
      );
      const clash = findVenueConflict(
        sameDay.map((r) => r.data),
        { fixtureId, scheduledDate: finalDate, scheduledTime: finalTime, venue: finalVenue }
      );
      if (clash) {
        throw new AppError(409, "SCHEDULE_CONFLICT", `${finalVenue} is already booked at ${finalTime} on ${finalDate} by ${clash}`);
      }
    }

    await ctx.db.commit(transaction, [
      { collection: "fixtures", id: fixtureId, data: update, mergeFields: Object.keys(update) },
      auditWrite({
        action: "saveFixture",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "fixture",
        targetId: fixtureId,
        before: {
          scheduledDate: fixture.scheduledDate,
          scheduledTime: fixture.scheduledTime,
          venue: fixture.venue,
          status: fixture.status,
        },
        after: update,
      }),
    ], { verifyQueries: true });
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { ok: true };
}

export async function startMatch(ctx: AuthContext, input: unknown) {
  const { fixtureId } = parseInput(fixtureIdInput, input);

  const transaction = await ctx.db.beginTransaction();
  try {
    const fixture = await ctx.db.getDocument<FixtureDoc>("fixtures", fixtureId, transaction);
    if (!fixture) throw new AppError(404, "FIXTURE_NOT_FOUND", "Fixture not found");
    requireSportAccess(ctx, fixture.sportId);
    if (fixture.slotA.kind === "BYE" || fixture.slotB.kind === "BYE") {
      throw new AppError(400, "CANNOT_START_BYE_FIXTURE", "Cannot start a bye fixture");
    }
    const undecided = (k: string) => k === "FIXTURE_WINNER" || k === "TBD";
    if (undecided(fixture.slotA.kind) || undecided(fixture.slotB.kind)) {
      throw new AppError(400, "SLOT_NOT_YET_DECIDED", "A slot is not yet decided");
    }

    if (fixture.status !== "SCHEDULED") {
      throw new AppError(
        400,
        "INVALID_FIXTURE_TRANSITION",
        `Only a SCHEDULED fixture can be started (this one is ${fixture.status})`
      );
    }

    const entrants = await loadFixtureEntrants(ctx.db, fixture, transaction);
    const withdrawn = [entrants.A, entrants.B].find((e) => e.withdrawn);
    if (withdrawn) {
      throw new AppError(
        409,
        "ENTRANT_WITHDRAWN",
        `${withdrawn.label} has withdrawn; a Super Admin must record a walkover for this fixture`
      );
    }

    await ctx.db.commit(transaction, [
      { collection: "fixtures", id: fixtureId, data: { status: "LIVE" }, mergeFields: ["status"] },
      auditWrite({
        action: "startMatch",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "fixture",
        targetId: fixtureId,
        before: { status: fixture.status },
        after: { status: "LIVE" },
      }),
    ]);
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { ok: true };
}

const HISTORY_LIMIT = 50;

interface HistoryEntry {
  at: string;
  by: string;
  data: Record<string, unknown>;
}

function enforceConfiguredLength(
  scoringModel: string,
  data: Record<string, unknown>,
  matchConfiguration: MatchConfiguration | null
): Record<string, unknown> {
  if (!matchConfiguration) return data;
  if (scoringModel === "TENNIS_SETS_GAMES" && data.bestOfSets !== tennisBestOfSetsFrom(matchConfiguration)) {
    throw new AppError(400, "INVALID_LIVE_STATE", "bestOfSets does not match the rules for this match");
  }
  if (scoringModel === "CRICKET_INNINGS" && data.oversPerInnings !== cricketOversFrom(matchConfiguration)) {
    throw new AppError(400, "INVALID_LIVE_STATE", "oversPerInnings does not match the rules for this match");
  }
  return data;
}

async function loadLiveFixture(ctx: AuthContext, fixtureId: string, transaction: string): Promise<FixtureDoc> {
  const fixture = await ctx.db.getDocument<FixtureDoc>("fixtures", fixtureId, transaction);
  if (!fixture) throw new AppError(404, "FIXTURE_NOT_FOUND", "Fixture not found");
  requireSportAccess(ctx, fixture.sportId);
  if (fixture.status !== "LIVE") {
    throw new AppError(400, "FIXTURE_NOT_LIVE", "Fixture is not live");
  }
  return fixture;
}

export async function updateLiveState(ctx: AuthContext, input: unknown) {
  const { fixtureId, expectedVersion, data } = parseInput(updateLiveStateInput, input);

  const transaction = await ctx.db.beginTransaction();
  try {
    const fixture = await loadLiveFixture(ctx, fixtureId, transaction);
    const { scoringModel, matchConfiguration } = await resolveFixtureScoring(ctx.db, fixture, transaction);
    const validation = validateLiveState(scoringModel, data);
    if (!validation.ok) {
      throw new AppError(400, "INVALID_LIVE_STATE", validation.message);
    }
    enforceConfiguredLength(scoringModel, data, matchConfiguration);

    const current = await ctx.db.getDocument<MatchStateDoc & { history?: HistoryEntry[] }>("matchStates", fixtureId, transaction);
    if (current && current.version !== expectedVersion) {
      throw new AppError(409, "VERSION_CONFLICT", "Match state was updated concurrently");
    }
    const nextVersion = (current?.version ?? 0) + 1;
    const history = current?.data
      ? [...(current.history ?? []), { at: new Date().toISOString(), by: ctx.email, data: current.data }].slice(-HISTORY_LIMIT)
      : current?.history ?? [];

    await ctx.db.commit(transaction, [
      {
        collection: "matchStates",
        id: fixtureId,
        data: { fixtureId, scoringModel, version: nextVersion, data, history },
        mergeFields: ["fixtureId", "scoringModel", "version", "data", "history"],
      },
    ]);
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { ok: true };
}

export async function undoLiveState(ctx: AuthContext, input: unknown) {
  const { fixtureId, expectedVersion } = parseInput(undoLiveStateInput, input);

  const transaction = await ctx.db.beginTransaction();
  try {
    await loadLiveFixture(ctx, fixtureId, transaction);
    const current = await ctx.db.getDocument<MatchStateDoc & { history?: HistoryEntry[] }>("matchStates", fixtureId, transaction);
    if (!current) throw new AppError(404, "NOTHING_TO_UNDO", "No score has been recorded yet");
    if (current.version !== expectedVersion) {
      throw new AppError(409, "VERSION_CONFLICT", "Match state was updated concurrently");
    }
    const history = current.history ?? [];
    const previous = history[history.length - 1];
    if (!previous) throw new AppError(400, "NOTHING_TO_UNDO", "There is nothing left to undo");

    await ctx.db.commit(transaction, [
      {
        collection: "matchStates",
        id: fixtureId,
        data: { fixtureId, version: current.version + 1, data: previous.data, history: history.slice(0, -1) },
        mergeFields: ["fixtureId", "version", "data", "history"],
      },
      auditWrite({
        action: "undoLiveState",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "fixture",
        targetId: fixtureId,
        before: current.data,
        after: previous.data,
      }),
    ]);
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { ok: true };
}
