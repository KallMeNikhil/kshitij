import { describe, expect, it } from "vitest";
import { startMatch, saveFixture, updateLiveState } from "../src/operations/match";
import { completeMatch, correctResult } from "../src/operations/result";
import { resolveFixtureScoring } from "../src/scoring";
import { ctxFor, dbWith, fixture } from "./helpers";
import { defaultMatchConfigurations } from "../../shared/matchConfig";

const coordinator = (db: unknown, sports = ["basketball"]) => ctxFor(db, "SPORT_COORDINATOR", sports);

describe("startMatch lifecycle", () => {
  for (const status of ["COMPLETED", "LIVE", "DRAFT", "POSTPONED", "CANCELLED"] as const) {
    it(`refuses to start a ${status} fixture`, async () => {
      const db = dbWith({ fixtures: [fixture({ status })] });
      await expect(startMatch(coordinator(db), { fixtureId: "basketball-mens-r1-m01" })).rejects.toMatchObject({
        code: "INVALID_FIXTURE_TRANSITION",
      });
      expect(db.commit).not.toHaveBeenCalled();
    });
  }

  it("starts a SCHEDULED fixture and audits actor, role and before/after", async () => {
    const db = dbWith({ fixtures: [fixture()] });
    await startMatch(coordinator(db), { fixtureId: "basketball-mens-r1-m01" });
    const writes = db.commit.mock.calls[0][1];
    expect(writes[0]).toMatchObject({ collection: "fixtures", data: { status: "LIVE" }, mergeFields: ["status"] });
    expect(writes[1].data).toMatchObject({
      action: "startMatch",
      actorEmail: "coord@example.com",
      actorRole: "SPORT_COORDINATOR",
      before: { status: "SCHEDULED" },
      after: { status: "LIVE" },
    });
  });

  it("refuses a fixture with an undecided or BYE slot", async () => {
    const tbd = dbWith({ fixtures: [fixture({ slotA: { kind: "FIXTURE_WINNER", fromFixtureId: "x-r1-m01" } })] });
    await expect(startMatch(coordinator(tbd), { fixtureId: "basketball-mens-r1-m01" })).rejects.toMatchObject({ code: "SLOT_NOT_YET_DECIDED" });
    const bye = dbWith({ fixtures: [fixture({ slotB: { kind: "BYE" } })] });
    await expect(startMatch(coordinator(bye), { fixtureId: "basketball-mens-r1-m01" })).rejects.toMatchObject({ code: "CANNOT_START_BYE_FIXTURE" });
  });

  it("rejects a coordinator who is not assigned to the fixture's sport", async () => {
    const db = dbWith({ fixtures: [fixture()] });
    await expect(startMatch(coordinator(db, ["cricket"]), { fixtureId: "basketball-mens-r1-m01" })).rejects.toMatchObject({ code: "SPORT_NOT_ASSIGNED" });
  });

  it("rejects path-like or malformed ids before touching Firestore", async () => {
    const db = dbWith({});
    await expect(startMatch(coordinator(db), { fixtureId: "../admins/root" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(db.beginTransaction).not.toHaveBeenCalled();
  });
});

describe("saveFixture lifecycle", () => {
  for (const status of ["LIVE", "COMPLETED", "CANCELLED"] as const) {
    it(`does not let a ${status} fixture be rescheduled`, async () => {
      const db = dbWith({ fixtures: [fixture({ status })] });
      await expect(
        saveFixture(coordinator(db), { fixtureId: "basketball-mens-r1-m01", scheduledDate: "2026-10-01", scheduledTime: "10:00" })
      ).rejects.toMatchObject({ code: "FIXTURE_NOT_EDITABLE" });
    });
  }

  it("saving a schedule never publishes a DRAFT fixture, for any role (publishBracket is the only publisher)", async () => {
    const input = { fixtureId: "basketball-mens-r1-m01", scheduledDate: "2026-10-01", scheduledTime: "10:00" };
    for (const make of [(db: unknown) => coordinator(db), (db: unknown) => ctxFor(db)]) {
      const db = dbWith({ fixtures: [fixture({ status: "DRAFT" })] });
      await saveFixture(make(db), input);
      const write = db.commit.mock.calls[0][1][0];
      expect(write.data).not.toHaveProperty("status");
      expect(write.mergeFields).not.toContain("status");
    }
  });

  it("rejects malformed dates/times and empty updates", async () => {
    const db = dbWith({ fixtures: [fixture()] });
    await expect(saveFixture(coordinator(db), { fixtureId: "basketball-mens-r1-m01", scheduledDate: "tomorrow" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(saveFixture(coordinator(db), { fixtureId: "basketball-mens-r1-m01" })).rejects.toMatchObject({ code: "NOTHING_TO_UPDATE" });
  });
});

const liveR1 = (n: number, over: Partial<ReturnType<typeof fixture>> = {}) =>
  fixture({
    fixtureId: `basketball-mens-r1-m0${n}`,
    matchNumber: n,
    status: "LIVE",
    nextFixtureId: "basketball-mens-r2-m01",
    nextSlot: n === 1 ? "A" : "B",
    slotA: { kind: "TEAM", teamId: `a${n}` },
    slotB: { kind: "TEAM", teamId: `b${n}` },
    ...over,
  });
const final = () =>
  fixture({
    fixtureId: "basketball-mens-r2-m01",
    round: 2,
    matchNumber: 1,
    status: "SCHEDULED",
    slotA: { kind: "FIXTURE_WINNER", fromFixtureId: "basketball-mens-r1-m01" },
    slotB: { kind: "FIXTURE_WINNER", fromFixtureId: "basketball-mens-r1-m02" },
  });

const finished = (winner: "A" | "B") => ({
  fixtureId: "x",
  scoringModel: "BASKETBALL_POINTS",
  version: 2,
  data: winner === "A" ? { scoreA: 50, scoreB: 40, period: 4, overtime: false, ended: true } : { scoreA: 40, scoreB: 50, period: 4, overtime: false, ended: true },
});

describe("completeMatch integrity", () => {
  it("blocks duplicate completion and completing a non-live fixture", async () => {
    const db = dbWith({ fixtures: [liveR1(1, { status: "COMPLETED" })] });
    await expect(
      completeMatch(coordinator(db), { fixtureId: "basketball-mens-r1-m01", winnerSlot: "A", decidedBy: "BASKETBALL_POINTS", resultSummary: "x" })
    ).rejects.toMatchObject({ code: "FIXTURE_NOT_LIVE" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("rejects an unknown winnerSlot instead of silently treating it as B", async () => {
    const db = dbWith({ fixtures: [liveR1(1)] });
    await expect(
      completeMatch(coordinator(db), { fixtureId: "basketball-mens-r1-m01", winnerSlot: "C", decidedBy: "BASKETBALL_POINTS", resultSummary: "x" })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("does not let a coordinator use a free-form decidedBy to skip the winner cross-check", async () => {
    const db = dbWith({ fixtures: [liveR1(1)] });
    const base = { fixtureId: "basketball-mens-r1-m01", winnerSlot: "A", resultSummary: "x" };
    await expect(completeMatch(coordinator(db), { ...base, decidedBy: "whatever" })).rejects.toMatchObject({ code: "INVALID_DECIDED_BY" });

    await expect(completeMatch(coordinator(db), { ...base, decidedBy: "FOOTBALL_EVENTS" })).rejects.toMatchObject({ code: "INVALID_DECIDED_BY" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("lets coordinators record walkovers and retirements only, and every early end needs a reason", async () => {
    const db = dbWith({ fixtures: [liveR1(1)] });
    const base = { fixtureId: "basketball-mens-r1-m01", winnerSlot: "A", decidedBy: "ADMIN_DECISION", resultSummary: "", reason: "coin toss" };
    await expect(completeMatch(coordinator(db), base)).rejects.toMatchObject({ code: "SUPER_ADMIN_REQUIRED" });
    await expect(completeMatch(coordinator(db), { ...base, decidedBy: "DISQUALIFIED" })).rejects.toMatchObject({ code: "SUPER_ADMIN_REQUIRED" });
    await expect(completeMatch(ctxFor(db), { ...base, reason: "  " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await completeMatch(coordinator(db), { ...base, decidedBy: "RETIRED", reason: "ankle injury" });
    const writes = db.commit.mock.calls[0][1];
    const ms = writes.find((w: { collection: string }) => w.collection === "matchStates");
    expect(ms.data.result).toEqual({ winnerSlot: "A", decidedBy: "RETIRED", summary: "Opponent retired", reason: "ankle injury" });
    expect(writes.at(-1).data).toMatchObject({ action: "completeMatch", actorRole: "SPORT_COORDINATOR", reason: "ankle injury", after: { earlyEnd: true, decidedBy: "RETIRED" } });
  });

  it("propagates the winner into slotA of the next round and touches nothing else", async () => {
    const history = liveR1(2, { status: "COMPLETED" });
    const db = dbWith({ fixtures: [liveR1(1), history, final()], docs: { "matchStates/basketball-mens-r1-m01": finished("B") } });
    await completeMatch(coordinator(db), { fixtureId: "basketball-mens-r1-m01", winnerSlot: "B", decidedBy: "BASKETBALL_POINTS", resultSummary: "x" });
    const writes = db.commit.mock.calls[0][1];
    const ids = writes.map((w: { id: string }) => w.id);
    expect(ids).not.toContain("basketball-mens-r1-m02");
    const next = writes.find((w: { id: string }) => w.id === "basketball-mens-r2-m01");
    expect(next.mergeFields).toEqual(["slotA"]);
    expect(next.data.slotA).toEqual({ kind: "TEAM", teamId: "b1" });
    const src = writes.find((w: { id: string }) => w.id === "basketball-mens-r1-m01");
    expect(src.mergeFields).toEqual(["status"]);
  });

  it("propagates the winner into slotB of the next round", async () => {
    const db = dbWith({ fixtures: [liveR1(1, { status: "COMPLETED" }), liveR1(2), final()], docs: { "matchStates/basketball-mens-r1-m02": finished("A") } });
    await completeMatch(coordinator(db), { fixtureId: "basketball-mens-r1-m02", winnerSlot: "A", decidedBy: "BASKETBALL_POINTS", resultSummary: "x" });
    const next = db.commit.mock.calls[0][1].find((w: { id: string }) => w.id === "basketball-mens-r2-m01");
    expect(next.mergeFields).toEqual(["slotB"]);
    expect(next.data.slotB).toEqual({ kind: "TEAM", teamId: "a2" });
  });
});

describe("correctResult authorization and integrity", () => {
  const done = (over = {}) => liveR1(1, { status: "COMPLETED", ...over });
  const stateDoc = (decidedBy: string, winnerSlot: "A" | "B" = "A") => ({
    fixtureId: "basketball-mens-r1-m01",
    version: 4,
    result: { winnerSlot, decidedBy, summary: "s" },
  });
  const args = { fixtureId: "basketball-mens-r1-m01", winnerSlot: "B", reason: "scorer typo" };

  it("requires a reason and an actual change", async () => {
    const db = dbWith({ fixtures: [done(), liveR1(2), final()], docs: { "matchStates/basketball-mens-r1-m01": stateDoc("BASKETBALL_POINTS", "B") } });
    await expect(correctResult(ctxFor(db), { ...args, reason: "  " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(correctResult(ctxFor(db), args)).rejects.toMatchObject({ code: "RESULT_UNCHANGED" });
  });

  it("lets only the Super Admin correct a normal result nobody has built on, bumping the version and auditing", async () => {
    const db = dbWith({ fixtures: [done(), liveR1(2, { status: "SCHEDULED" }), final()], docs: { "matchStates/basketball-mens-r1-m01": stateDoc("BASKETBALL_POINTS") } });
    await expect(correctResult(coordinator(db), args)).rejects.toMatchObject({ code: "SUPER_ADMIN_REQUIRED" });
    expect(db.commit).not.toHaveBeenCalled();
    await correctResult(ctxFor(db), args);
    const writes = db.commit.mock.calls[0][1];
    const ms = writes.find((w: { collection: string }) => w.collection === "matchStates");
    expect(ms.data.version).toBe(5);
    expect(ms.mergeFields).toEqual(["fixtureId", "version", "result"]);
    expect(ms.data.result).toEqual({ winnerSlot: "B", decidedBy: "ADMIN_DECISION", summary: "Decided by organisers", reason: "scorer typo" });
    expect(writes.at(-1).data).toMatchObject({ action: "correctResult", reason: "scorer typo", actorRole: "SUPER_ADMIN", before: { winnerSlot: "A" }, after: { winnerSlot: "B" } });
  });

  it("requires Super Admin to correct a WALKOVER/override result", async () => {
    const db = dbWith({ fixtures: [done(), liveR1(2), final()], docs: { "matchStates/basketball-mens-r1-m01": stateDoc("WALKOVER") } });
    await expect(correctResult(coordinator(db), args)).rejects.toMatchObject({ code: "SUPER_ADMIN_REQUIRED" });
    await expect(correctResult(ctxFor(db), args)).resolves.toMatchObject({ ok: true });
  });

  it("refuses to correct a result once the downstream fixture has started, even for the Super Admin (it would rewrite who played a recorded match)", async () => {
    for (const status of ["LIVE", "COMPLETED"] as const) {
      const started = final();
      started.status = status;
      started.slotA = { kind: "TEAM", teamId: "a1" };
      started.slotB = { kind: "TEAM", teamId: "a2" };
      const mk = () => dbWith({ fixtures: [done(), liveR1(2, { status: "COMPLETED" }), started], docs: { "matchStates/basketball-mens-r1-m01": stateDoc("BASKETBALL_POINTS") } });
      const db = mk();
      await expect(correctResult(coordinator(db), args)).rejects.toMatchObject({ code: "SUPER_ADMIN_REQUIRED" });
      await expect(correctResult(ctxFor(mk()), args)).rejects.toMatchObject({ code: "CORRECTION_BLOCKED_DOWNSTREAM_STARTED" });
      expect(db.commit).not.toHaveBeenCalled();
    }
  });

  it("refuses to 'correct' an auto-completed BYE fixture", async () => {
    const db = dbWith({ fixtures: [done({ slotB: { kind: "BYE" } })] });
    await expect(correctResult(ctxFor(db), args)).rejects.toMatchObject({ code: "CANNOT_CORRECT_BYE_FIXTURE" });
  });
});

describe("Worker scoring resolution matches the shared hierarchy", () => {
  it("prefers the fixture snapshot, then the sport configuration, then the legacy map", async () => {
    const tennis = defaultMatchConfigurations.tennis!;
    const basketball = defaultMatchConfigurations.basketball!;
    const legacyFixture = fixture();
    const sportDoc = { sportId: "basketball", matchConfiguration: tennis };

    const withSport = dbWith({ docs: { "sports/basketball": sportDoc } });
    expect((await resolveFixtureScoring(withSport as never, legacyFixture, "t")).scoringModel).toBe("TENNIS_SETS_GAMES");

    const withSnapshot = dbWith({ docs: { "sports/basketball": sportDoc } });
    const snap = fixture({ matchConfigurationSnapshot: basketball });
    expect((await resolveFixtureScoring(withSnapshot as never, snap, "t")).scoringModel).toBe("BASKETBALL_POINTS");
    expect(withSnapshot.getDocument).not.toHaveBeenCalled();

    const legacyOnly = dbWith({});
    expect((await resolveFixtureScoring(legacyOnly as never, legacyFixture, "t")).scoringModel).toBe("BASKETBALL_POINTS");
  });

  it("validates live state under the resolved model, so client and server agree", async () => {

    const sets = defaultMatchConfigurations["table-tennis"]!;
    const db = dbWith({
      fixtures: [fixture({ status: "LIVE" })],
      docs: { "sports/basketball": { sportId: "basketball", matchConfiguration: sets } },
    });
    await expect(
      updateLiveState(coordinator(db), { fixtureId: "basketball-mens-r1-m01", expectedVersion: 0, data: { scoreA: 1, scoreB: 0, period: 1, overtime: false } })
    ).rejects.toMatchObject({ code: "INVALID_LIVE_STATE" });
  });

  it("rejects malformed live-state requests", async () => {
    const db = dbWith({ fixtures: [fixture({ status: "LIVE" })] });
    await expect(updateLiveState(coordinator(db), { fixtureId: "basketball-mens-r1-m01", expectedVersion: -1, data: {} })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(updateLiveState(coordinator(db), { fixtureId: "basketball-mens-r1-m01", expectedVersion: 0, data: "nope" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
