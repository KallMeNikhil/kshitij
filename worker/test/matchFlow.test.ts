import { describe, expect, it } from "vitest";
import { undoLiveState, updateLiveState } from "../src/operations/match";
import { reopenMatch } from "../src/operations/result";
import { reinstateFixture } from "../src/operations/lifecycle";
import { ctxFor, dbWith, fixture } from "./helpers";
import { defaultMatchConfigurations } from "../../shared/matchConfig";
import { emptyTennisState } from "../../shared/scoring/tennis-sets-games";

const FID = "basketball-mens-r1-m01";
const NEXT = "basketball-mens-r2-m01";
const coordinator = (db: unknown) => ctxFor(db, "SPORT_COORDINATOR", ["basketball"]);
const score = (a: number, b: number) => ({ scoreA: a, scoreB: b, period: 1, overtime: false });
const matchStateWrite = (db: ReturnType<typeof dbWith>) =>
  db.commit.mock.calls[0][1].find((w: { collection: string }) => w.collection === "matchStates");

describe("live score history and undo", () => {
  it("keeps the previous score in a bounded history on every update", async () => {
    const history = Array.from({ length: 50 }, (_, i) => ({ at: "t", by: "x", data: score(i, 0) }));
    const db = dbWith({
      fixtures: [fixture({ status: "LIVE" })],
      docs: { [`matchStates/${FID}`]: { fixtureId: FID, scoringModel: "BASKETBALL_POINTS", version: 7, data: score(50, 0), history } },
    });
    await updateLiveState(coordinator(db), { fixtureId: FID, expectedVersion: 7, data: score(52, 0) });
    const write = matchStateWrite(db);
    expect(write.data.history).toHaveLength(50);
    expect(write.data.history.at(-1)).toMatchObject({ by: "coord@example.com", data: score(50, 0) });
    expect(write.mergeFields).toContain("history");
  });

  it("restores the previous score on undo and refuses when there is nothing left", async () => {
    const db = dbWith({
      fixtures: [fixture({ status: "LIVE" })],
      docs: { [`matchStates/${FID}`]: { fixtureId: FID, scoringModel: "BASKETBALL_POINTS", version: 3, data: score(5, 2), history: [{ at: "t", by: "x", data: score(3, 2) }] } },
    });
    await expect(undoLiveState(coordinator(db), { fixtureId: FID, expectedVersion: 2 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await undoLiveState(coordinator(db), { fixtureId: FID, expectedVersion: 3 });
    expect(matchStateWrite(db).data).toMatchObject({ version: 4, data: score(3, 2), history: [] });

    const empty = dbWith({ fixtures: [fixture({ status: "LIVE" })], docs: { [`matchStates/${FID}`]: { fixtureId: FID, version: 1, data: score(1, 0) } } });
    await expect(undoLiveState(coordinator(empty), { fixtureId: FID, expectedVersion: 1 })).rejects.toMatchObject({ code: "NOTHING_TO_UNDO" });
  });

  it("refuses live state whose match length differs from the configured rules", async () => {
    const tennis = { ...defaultMatchConfigurations.tennis!, participantModel: { participantType: "TEAM" as const, teamSize: { min: 1, max: 2 } } };
    const db = dbWith({ fixtures: [fixture({ status: "LIVE", matchConfigurationSnapshot: tennis })] });
    await expect(updateLiveState(coordinator(db), { fixtureId: FID, expectedVersion: 0, data: { ...emptyTennisState(1) } })).rejects.toMatchObject({
      code: "INVALID_LIVE_STATE",
    });
    await expect(updateLiveState(coordinator(db), { fixtureId: FID, expectedVersion: 0, data: { ...emptyTennisState(3) } })).resolves.toMatchObject({ ok: true });
  });
});

describe("reopening a completed match", () => {
  const done = fixture({ status: "COMPLETED", nextFixtureId: NEXT, nextSlot: "A" });
  const next = (over = {}) =>
    fixture({ fixtureId: NEXT, round: 2, matchNumber: 1, slotA: { kind: "TEAM", teamId: "t1" }, slotB: { kind: "FIXTURE_WINNER", fromFixtureId: "basketball-mens-r1-m02" }, ...over });
  const sibling = fixture({ fixtureId: "basketball-mens-r1-m02", matchNumber: 2, nextFixtureId: NEXT, nextSlot: "B" });
  const played = { fixtureId: FID, scoringModel: "BASKETBALL_POINTS", version: 4, data: { ...score(60, 50), period: 4, ended: true }, result: { winnerSlot: "A", decidedBy: "BASKETBALL_POINTS", summary: "60-50" } };

  it("returns the match to LIVE, clears the result and the advanced slot, and audits it", async () => {
    const db = dbWith({ fixtures: [done, sibling, next()], docs: { [`matchStates/${FID}`]: played } });
    await expect(reopenMatch(coordinator(db), { fixtureId: FID, reason: "wrong final point" })).rejects.toMatchObject({ code: "SUPER_ADMIN_REQUIRED" });
    await reopenMatch(ctxFor(db), { fixtureId: FID, reason: "wrong final point" });
    const writes = db.commit.mock.calls[0][1];
    expect(writes.find((w: { id: string }) => w.id === FID)).toMatchObject({ data: { status: "LIVE" }, mergeFields: ["status"] });
    expect(writes.find((w: { id: string }) => w.id === NEXT).data.slotA).toEqual({ kind: "FIXTURE_WINNER", fromFixtureId: FID });
    const ms = matchStateWrite(db);
    expect(ms.data.data).not.toHaveProperty("ended");
    expect(ms.mergeFields).toEqual(expect.arrayContaining(["result", "penalties"]));
    expect(ms.data).not.toHaveProperty("result");
    expect(writes.at(-1).data).toMatchObject({ action: "reopenMatch", reason: "wrong final point" });
  });

  it("is blocked once the next match has started, or when there is no score to reopen", async () => {
    const started = dbWith({ fixtures: [done, sibling, next({ status: "LIVE" })], docs: { [`matchStates/${FID}`]: played } });
    await expect(reopenMatch(ctxFor(started), { fixtureId: FID, reason: "x" })).rejects.toMatchObject({ code: "REOPEN_BLOCKED_DOWNSTREAM_STARTED" });
    const walkover = dbWith({ fixtures: [done, sibling, next()], docs: { [`matchStates/${FID}`]: { fixtureId: FID, version: 1, result: played.result } } });
    await expect(reopenMatch(ctxFor(walkover), { fixtureId: FID, reason: "x" })).rejects.toMatchObject({ code: "NO_SCORE_TO_REOPEN" });
  });
});

describe("reinstating a cancelled match", () => {
  it("lets only the Super Admin move a cancelled match back to SCHEDULED, clearing the reason", async () => {
    const db = dbWith({ fixtures: [fixture({ status: "CANCELLED", statusReason: "flooded" })] });
    await expect(reinstateFixture(coordinator(db), { fixtureId: FID, reason: "cancelled by mistake" })).rejects.toMatchObject({ code: "SUPER_ADMIN_REQUIRED" });
    await reinstateFixture(ctxFor(db), { fixtureId: FID, reason: "cancelled by mistake", scheduledDate: "2026-11-10", scheduledTime: "09:00" });
    const write = db.commit.mock.calls[0][1][0];
    expect(write.data).toEqual({ status: "SCHEDULED", scheduledDate: "2026-11-10", scheduledTime: "09:00" });
    expect(write.mergeFields).toEqual(expect.arrayContaining(["statusReason", "resumeStatus"]));
  });

  it("refuses anything that is not cancelled", async () => {
    const db = dbWith({ fixtures: [fixture({ status: "SCHEDULED" })] });
    await expect(reinstateFixture(ctxFor(db), { fixtureId: FID, reason: "x" })).rejects.toMatchObject({ code: "INVALID_FIXTURE_TRANSITION" });
  });
});
