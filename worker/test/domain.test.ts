import { describe, expect, it } from "vitest";
import { startMatch, saveFixture } from "../src/operations/match";
import { completeMatch, correctResult } from "../src/operations/result";
import { updateSportConfig, updateCompetitionConfig } from "../src/operations/config";
import { upsertEntity } from "../src/operations/admin";
import { ctxFor, dbWith, entrantStub, fixture } from "./helpers";
import { defaultMatchConfigurations } from "../../shared/matchConfig";
import type { FixtureDoc } from "../../shared/types";

const FID = "basketball-mens-r1-m01";
const coordinator = (db: unknown) => ctxFor(db, "SPORT_COORDINATOR", ["basketball"]);
const withdrawn = (id: string) => entrantStub("teams", id, { status: "WITHDRAWN" });

describe("startMatch: entrant scope and withdrawn entrants", () => {
  it("refuses to start a fixture with a withdrawn entrant and points to the walkover workflow", async () => {
    const db = dbWith({ fixtures: [fixture()], docs: { "teams/t1": withdrawn("t1") } });
    await expect(startMatch(coordinator(db), { fixtureId: FID })).rejects.toMatchObject({ code: "ENTRANT_WITHDRAWN", message: expect.stringMatching(/walkover/i) });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("refuses an entrant that belongs to another competition or sport", async () => {
    const foreignComp = dbWith({ fixtures: [fixture()], docs: { "teams/t2": entrantStub("teams", "t2", { competitionId: "basketball-womens" }) } });
    await expect(startMatch(coordinator(foreignComp), { fixtureId: FID })).rejects.toMatchObject({ code: "ENTRANT_OUT_OF_SCOPE" });
    const foreignSport = dbWith({ fixtures: [fixture()], docs: { "teams/t2": entrantStub("teams", "t2", { sportId: "cricket" }) } });
    await expect(startMatch(coordinator(foreignSport), { fixtureId: FID })).rejects.toMatchObject({ code: "ENTRANT_OUT_OF_SCOPE" });
  });

  it("refuses a dangling slot reference and the same entrant on both sides", async () => {
    const dangling = dbWith({ fixtures: [fixture()], docs: { "teams/t1": null } });
    await expect(startMatch(coordinator(dangling), { fixtureId: FID })).rejects.toMatchObject({ code: "ENTRANT_NOT_FOUND" });
    const dup = dbWith({ fixtures: [fixture({ slotB: { kind: "TEAM", teamId: "t1" } })] });
    await expect(startMatch(coordinator(dup), { fixtureId: FID })).rejects.toMatchObject({ code: "DUPLICATE_ENTRANT" });
  });
});

describe("completeMatch: walkover, withdrawn entrants, configured behavior", () => {
  const complete = (ctx: ReturnType<typeof ctxFor>, over: Record<string, unknown> = {}) =>
    completeMatch(ctx, { fixtureId: FID, winnerSlot: "B", decidedBy: "WALKOVER", resultSummary: "T1 withdrew", ...over });

  it("lets a Super Admin record a walkover on a SCHEDULED fixture whose entrant withdrew, creating version 1 and auditing from SCHEDULED", async () => {
    const db = dbWith({ fixtures: [fixture()], docs: { "teams/t1": withdrawn("t1") } });
    await complete(ctxFor(db));
    const writes = db.commit.mock.calls[0][1];
    const ms = writes.find((w: { collection: string }) => w.collection === "matchStates");
    expect(ms.data).toMatchObject({ version: 1, result: { winnerSlot: "B", decidedBy: "WALKOVER" } });
    expect(writes.at(-1).data).toMatchObject({ action: "completeMatch", actorRole: "SUPER_ADMIN", before: { status: "SCHEDULED" }, after: { status: "COMPLETED", earlyEnd: true } });
  });

  it("lets a coordinator record a no-show walkover, but not score results, retirements or decisions before play", async () => {
    const mk = () => dbWith({ fixtures: [fixture()] });
    await expect(complete(coordinator(mk()))).resolves.toMatchObject({ ok: true });
    await expect(complete(ctxFor(mk()), { decidedBy: "BASKETBALL_POINTS" })).rejects.toMatchObject({ code: "FIXTURE_NOT_LIVE" });
    await expect(complete(coordinator(mk()), { decidedBy: "RETIRED" })).rejects.toMatchObject({ code: "RESULT_TYPE_NOT_ALLOWED" });
    await expect(complete(coordinator(mk()), { decidedBy: "ADMIN_DECISION" })).rejects.toMatchObject({ code: "SUPER_ADMIN_REQUIRED" });
    await expect(complete(ctxFor(mk()), { decidedBy: "ADMIN_OVERRIDE" })).resolves.toMatchObject({ ok: true });
  });

  it("records a walkover on a postponed match and clears its postponement fields", async () => {
    const db = dbWith({ fixtures: [fixture({ status: "POSTPONED", statusReason: "rain", resumeStatus: "SCHEDULED" })] });
    await complete(ctxFor(db));
    const src = db.commit.mock.calls[0][1].find((w: { id: string }) => w.id === FID);
    expect(src.mergeFields).toEqual(expect.arrayContaining(["status", "statusReason", "resumeStatus"]));
    expect(src.data).toMatchObject({ status: "COMPLETED" });
  });

  it("never advances a withdrawn entrant: rejected as winner of a walkover and of a normal completion", async () => {
    const db = () => dbWith({ fixtures: [fixture({ status: "LIVE" })], docs: { "teams/t2": withdrawn("t2") } });
    await expect(complete(ctxFor(db()), { winnerSlot: "B" })).rejects.toMatchObject({ code: "WINNER_WITHDRAWN" });
    await expect(complete(coordinator(db()), { winnerSlot: "B", decidedBy: "BASKETBALL_POINTS" })).rejects.toMatchObject({ code: "WINNER_WITHDRAWN" });

    await expect(complete(ctxFor(db()), { winnerSlot: "A" })).resolves.toMatchObject({ ok: true });
  });

  it("refuses a walkover when both entrants withdrew (no valid winner exists)", async () => {
    const db = dbWith({ fixtures: [fixture()], docs: { "teams/t1": withdrawn("t1"), "teams/t2": withdrawn("t2") } });
    await expect(complete(ctxFor(db))).rejects.toMatchObject({ code: "WINNER_WITHDRAWN" });
  });

  it("honors walkoverBehavior: BOTH_ELIMINATED is refused instead of silently applied as OPPONENT_WINS", async () => {
    const snapshot = { ...defaultMatchConfigurations.basketball!, walkoverBehavior: "BOTH_ELIMINATED" as const };
    const db = dbWith({ fixtures: [fixture({ matchConfigurationSnapshot: snapshot })] });
    await expect(complete(ctxFor(db), { winnerSlot: "A" })).rejects.toMatchObject({ code: "WALKOVER_BEHAVIOR_NOT_SUPPORTED" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("refuses to complete with an entrant from another competition", async () => {
    const db = dbWith({ fixtures: [fixture({ status: "LIVE" })], docs: { "teams/t1": entrantStub("teams", "t1", { competitionId: "elsewhere" }) } });
    await expect(complete(ctxFor(db), { decidedBy: "BASKETBALL_POINTS", winnerSlot: "B" })).rejects.toMatchObject({ code: "ENTRANT_OUT_OF_SCOPE" });
  });
});

describe("bracket integrity guard on propagation", () => {
  const r1 = (n: number, over: Partial<FixtureDoc> = {}): FixtureDoc =>
    fixture({
      fixtureId: `basketball-mens-r1-m0${n}`, matchNumber: n, status: n === 1 ? "LIVE" : "SCHEDULED",
      nextFixtureId: "basketball-mens-r2-m01", nextSlot: n === 1 ? "A" : "B",
      slotA: { kind: "TEAM", teamId: `a${n}` }, slotB: { kind: "TEAM", teamId: `b${n}` }, ...over,
    });
  const r2 = (over: Partial<FixtureDoc> = {}): FixtureDoc =>
    fixture({
      fixtureId: "basketball-mens-r2-m01", round: 2, matchNumber: 1, status: "SCHEDULED",
      slotA: { kind: "FIXTURE_WINNER", fromFixtureId: "basketball-mens-r1-m01" },
      slotB: { kind: "FIXTURE_WINNER", fromFixtureId: "basketball-mens-r1-m02" }, ...over,
    });

  it("blocks a completion that would seat one entrant twice in the same round", async () => {

    const db = dbWith({ fixtures: [r1(1), r1(2), r2({ slotB: { kind: "TEAM", teamId: "a1" } })] });
    await expect(
      completeMatch(coordinator(db), { fixtureId: "basketball-mens-r1-m01", winnerSlot: "A", decidedBy: "BASKETBALL_POINTS", resultSummary: "x" })
    ).rejects.toMatchObject({ code: "BRACKET_INVARIANT_VIOLATION" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("does not let a PRE-EXISTING inconsistency block unrelated scoring (only newly introduced violations fail)", async () => {
    const miswired = r1(2, { nextSlot: "A" });
    const db = dbWith({
      fixtures: [r1(1), miswired, r2()],
      docs: { "matchStates/basketball-mens-r1-m01": { fixtureId: "x", scoringModel: "BASKETBALL_POINTS", version: 1, data: { scoreA: 9, scoreB: 2, period: 4, overtime: false, ended: true } } },
    });
    await expect(
      completeMatch(coordinator(db), { fixtureId: "basketball-mens-r1-m01", winnerSlot: "A", decidedBy: "BASKETBALL_POINTS", resultSummary: "x" })
    ).resolves.toMatchObject({ ok: true });
  });

  it("a played fixture with a bye-scaffold downstream does not count as 'downstream started'", async () => {
    const done = r1(1, { status: "COMPLETED" });
    const scaffold = r2({ status: "COMPLETED", slotB: { kind: "BYE" }, slotA: { kind: "TEAM", teamId: "a1" } });
    const db = dbWith({ fixtures: [done, r1(2, { status: "SCHEDULED" }), scaffold], docs: { "matchStates/basketball-mens-r1-m01": { fixtureId: "x", version: 1, result: { winnerSlot: "A", decidedBy: "BASKETBALL_POINTS", summary: "s" } } } });
    await expect(correctResult(ctxFor(db), { fixtureId: "basketball-mens-r1-m01", winnerSlot: "B", reason: "typo" })).resolves.toMatchObject({ ok: true });
  });

  it("refuses to correct a result in favour of a withdrawn entrant", async () => {
    const db = dbWith({
      fixtures: [r1(1, { status: "COMPLETED" }), r1(2), r2()],
      docs: { "teams/b1": withdrawn("b1"), "matchStates/basketball-mens-r1-m01": { fixtureId: "x", version: 1, result: { winnerSlot: "A", decidedBy: "BASKETBALL_POINTS", summary: "s" } } },
    });
    await expect(correctResult(ctxFor(db), { fixtureId: "basketball-mens-r1-m01", winnerSlot: "B", reason: "typo" })).rejects.toMatchObject({ code: "WINNER_WITHDRAWN" });
  });
});

describe("saveFixture scheduling rules", () => {
  const ok = { fixtureId: FID, scheduledDate: "2026-10-12", scheduledTime: "16:30" };

  it("only DRAFT and SCHEDULED fixtures are editable (POSTPONED is no longer, matching the rules)", async () => {
    for (const status of ["POSTPONED", "LIVE", "COMPLETED", "CANCELLED"] as const) {
      await expect(saveFixture(coordinator(dbWith({ fixtures: [fixture({ status })] })), ok)).rejects.toMatchObject({ code: "FIXTURE_NOT_EDITABLE" });
    }
    for (const status of ["DRAFT", "SCHEDULED"] as const) {
      await expect(saveFixture(coordinator(dbWith({ fixtures: [fixture({ status })] })), ok)).resolves.toMatchObject({ ok: true });
    }
  });

  it("rejects dates and times that match the format but are not real", async () => {
    const db = dbWith({ fixtures: [fixture()] });
    for (const bad of [{ scheduledDate: "2026-02-30" }, { scheduledDate: "2026-13-01" }, { scheduledTime: "25:00" }, { scheduledTime: "12:75" }]) {
      await expect(saveFixture(coordinator(db), { ...ok, ...bad })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("never persists half a schedule, but completes an existing one", async () => {
    await expect(saveFixture(coordinator(dbWith({ fixtures: [fixture()] })), { fixtureId: FID, scheduledTime: "10:00" })).rejects.toMatchObject({ code: "SCHEDULE_DATE_AND_TIME_MUST_BE_TOGETHER" });
    const db = dbWith({ fixtures: [fixture({ scheduledDate: "2026-10-12", scheduledTime: "09:00" })] });
    await saveFixture(coordinator(db), { fixtureId: FID, scheduledTime: "10:00" });
    expect(db.commit.mock.calls[0][1][0].data).toEqual({ scheduledTime: "10:00" });
  });

  it("only writes schedule fields: never status, slots, topology, snapshot or identity", async () => {
    const db = dbWith({ fixtures: [fixture({ status: "DRAFT" })] });
    await saveFixture(ctxFor(db), { ...ok, venue: " Court 1 ", slotA: { kind: "TEAM", teamId: "x" }, nextFixtureId: "evil", matchConfigurationSnapshot: {} });
    const w = db.commit.mock.calls[0][1][0];
    expect(Object.keys(w.data).sort()).toEqual(["scheduledDate", "scheduledTime", "venue"]);
    expect(w.data.venue).toBe("Court 1");
    expect(w.mergeFields.sort()).toEqual(["scheduledDate", "scheduledTime", "venue"]);
  });
});

describe("configuration consistency", () => {
  const tt = defaultMatchConfigurations["table-tennis"]!;
  const bb = defaultMatchConfigurations.basketball!;

  it("rejects a sport configuration whose scoring model differs from the sport's registration", async () => {
    const db = dbWith({ docs: { "sports/table-tennis": { sportId: "table-tennis", scoringModel: "SETS_POINTS" } } });
    await expect(updateSportConfig(ctxFor(db), { sportId: "table-tennis", matchConfiguration: bb })).rejects.toMatchObject({ code: "SCORING_MODEL_MISMATCH" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("rejects a competition override that changes the sport's scoring model", async () => {
    const db = dbWith({
      docs: {
        "competitions/tt-mens": { competitionId: "tt-mens", sportId: "table-tennis", participantType: "INDIVIDUAL" },
        "sports/table-tennis": { sportId: "table-tennis", scoringModel: "SETS_POINTS", matchConfiguration: tt },
      },
    });
    const wrong = { ...bb, participantModel: { participantType: "INDIVIDUAL" as const } };
    await expect(updateCompetitionConfig(ctxFor(db), { competitionId: "tt-mens", matchConfiguration: wrong })).rejects.toMatchObject({ code: "SCORING_MODEL_MISMATCH" });
  });

  it("rejects non-id values for sportId / competitionId before touching Firestore", async () => {
    const db = dbWith({});
    await expect(updateSportConfig(ctxFor(db), { sportId: "../admins/x", matchConfiguration: tt })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(updateCompetitionConfig(ctxFor(db), { competitionId: 5, matchConfiguration: tt })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(db.beginTransaction).not.toHaveBeenCalled();
  });

  it("locks a sport's scoringModel once fixtures exist, but allows unrelated edits", async () => {
    const sport = { sportId: "basketball", name: "Basketball", scoringModel: "BASKETBALL_POINTS", displayOrder: 0, active: true };
    const db = dbWith({ docs: { "sports/basketball": sport }, queries: (c) => (c === "fixtures" ? [{ id: FID, data: fixture() }] : undefined) });
    await expect(upsertEntity(ctxFor(db), { collection: "sports", id: "basketball", data: { scoringModel: "SETS_POINTS" } })).rejects.toMatchObject({ code: "SCORING_MODEL_LOCKED" });
    await expect(upsertEntity(ctxFor(db), { collection: "sports", id: "basketball", data: { name: "Hoops" } })).resolves.toMatchObject({ ok: true });
  });
});
