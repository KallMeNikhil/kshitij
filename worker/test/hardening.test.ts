import { describe, expect, it } from "vitest";
import { generateBracket, publishBracket } from "../src/operations/bracket";
import { withdrawEntrant } from "../src/operations/entrant";
import { manageAdmin, upsertEntity, deleteEntity, createAnnouncement, deleteAnnouncement } from "../src/operations/admin";
import { updateSportConfig, updateCompetitionConfig } from "../src/operations/config";
import { previewImport, commitImport } from "../src/operations/import";
import { startMatch, saveFixture, updateLiveState } from "../src/operations/match";
import { completeMatch, correctResult } from "../src/operations/result";
import { cancelFixture } from "../src/operations/lifecycle";
import { previewPurge, purgeCompetition, deleteEntities, withdrawEntrants } from "../src/operations/purge";
import { ctxFor, dbWith, fixture } from "./helpers";
import { defaultMatchConfigurations } from "../../shared/matchConfig";
import type { CompetitionDoc, TeamDoc } from "../../shared/types";

const competition: CompetitionDoc = {
  competitionId: "basketball-mens",
  sportId: "basketball",
  name: "Men's Basketball",
  categoryKey: "open",
  gender: null,
  participantType: "TEAM",
  format: "KNOCKOUT",
  teamSize: { min: 5, max: 8 },
  published: false,
  displayOrder: 0,
};
const team = (id: string, extra: Partial<TeamDoc> = {}): TeamDoc => ({
  teamId: id, sportId: "basketball", competitionId: "basketball-mens", college: id, captainParticipantId: "p1", memberIds: ["p1"], ...extra,
});
const teamRows = (...ts: TeamDoc[]) => ts.map((data) => ({ id: data.teamId, data }));

describe("authorization matrix: coordinators cannot reach Super Admin operations", () => {
  const superOnly: Array<[string, (ctx: ReturnType<typeof ctxFor>) => Promise<unknown>]> = [
    ["previewImport", (c) => previewImport(c, {})],
    ["commitImport", (c) => commitImport(c, {})],
    ["generateBracket", (c) => generateBracket(c, { competitionId: "basketball-mens" })],
    ["publishBracket", (c) => publishBracket(c, { competitionId: "basketball-mens" })],
    ["manageAdmin", (c) => manageAdmin(c, { email: "x@example.com", role: "SUPER_ADMIN", active: true })],
    ["upsertEntity", (c) => upsertEntity(c, { collection: "sports", id: "basketball", data: {} })],
    ["deleteEntity", (c) => deleteEntity(c, { collection: "sports", id: "basketball" })],
    ["createAnnouncement", (c) => createAnnouncement(c, { title: "t", body: "b" })],
    ["deleteAnnouncement", (c) => deleteAnnouncement(c, { id: "announcement-1" })],
    ["updateSportConfig", (c) => updateSportConfig(c, { sportId: "basketball", matchConfiguration: {} })],
    ["updateCompetitionConfig", (c) => updateCompetitionConfig(c, { competitionId: "basketball-mens", matchConfiguration: {} })],
    ["withdrawEntrant", (c) => withdrawEntrant(c, { collection: "teams", id: "t1", reason: "r" })],
    ["correctResult", (c) => correctResult(c, { fixtureId: "basketball-mens-r1-m01", winnerSlot: "A", reason: "r" })],
    ["cancelFixture", (c) => cancelFixture(c, { fixtureId: "basketball-mens-r1-m01", reason: "r" })],
    ["purgeCompetition", (c) => purgeCompetition(c, { competitionId: "basketball-mens" })],
    ["previewPurge", (c) => previewPurge(c, { competitionId: "basketball-mens" })],
    ["deleteEntities", (c) => deleteEntities(c, { collection: "teams", competitionId: "basketball-mens", ids: ["t1"] })],
    ["withdrawEntrants", (c) => withdrawEntrants(c, { collection: "teams", competitionId: "basketball-mens", ids: ["t1"], reason: "r" })],
  ];
  for (const [name, call] of superOnly) {
    it(`${name} -> SUPER_ADMIN_REQUIRED, with zero reads/writes`, async () => {
      const db = dbWith({});
      await expect(call(ctxFor(db, "SPORT_COORDINATOR", ["basketball"]))).rejects.toMatchObject({ code: "SUPER_ADMIN_REQUIRED" });
      expect(db.beginTransaction).not.toHaveBeenCalled();
      expect(db.commit).not.toHaveBeenCalled();
    });
  }

  const scoped: Array<[string, (ctx: ReturnType<typeof ctxFor>) => Promise<unknown>]> = [
    ["saveFixture", (c) => saveFixture(c, { fixtureId: "basketball-mens-r1-m01", venue: "Court" })],
    ["startMatch", (c) => startMatch(c, { fixtureId: "basketball-mens-r1-m01" })],
    ["updateLiveState", (c) => updateLiveState(c, { fixtureId: "basketball-mens-r1-m01", expectedVersion: 0, data: {} })],
    ["completeMatch", (c) => completeMatch(c, { fixtureId: "basketball-mens-r1-m01", winnerSlot: "A", decidedBy: "BASKETBALL_POINTS", resultSummary: "x" })],
  ];
  for (const [name, call] of scoped) {
    it(`${name} is rejected for a coordinator assigned to a different sport`, async () => {
      const db = dbWith({ fixtures: [fixture({ status: "LIVE" })] });
      await expect(call(ctxFor(db, "SPORT_COORDINATOR", ["cricket"]))).rejects.toMatchObject({ code: "SPORT_NOT_ASSIGNED" });
      expect(db.commit).not.toHaveBeenCalled();
    });
  }
});

describe("generateBracket hardening", () => {
  const gen = (db: unknown, input: Record<string, unknown> = {}) =>
    generateBracket(ctxFor(db), { competitionId: "basketball-mens", ...input });

  it("regenerates over a bracket whose only non-DRAFT fixtures are auto-completed BYEs", async () => {
    const byeDone = fixture({ status: "COMPLETED", slotB: { kind: "BYE" } });
    const draft = fixture({ fixtureId: "basketball-mens-r1-m02", matchNumber: 2, status: "DRAFT" });
    const db = dbWith({
      docs: { "competitions/basketball-mens": competition },
      fixtures: [byeDone, draft],
      queries: (c) => (c === "teams" ? teamRows(team("ta"), team("tb"), team("tc"), team("td")) : undefined),
    });
    await expect(gen(db)).resolves.toMatchObject({ fixtureCount: 3 });
  });

  it("allows regeneration of an unstarted published bracket but blocks it once any match has a score or result", async () => {
    const scheduled = dbWith({
      docs: { "competitions/basketball-mens": { ...competition, published: true } },
      fixtures: [fixture({ status: "SCHEDULED", scheduledDate: "2026-11-10", scheduledTime: "09:00", venue: "Court 1" })],
      queries: (c) => (c === "teams" ? teamRows(team("ta"), team("tb")) : undefined),
    });
    await expect(gen(scheduled)).resolves.toMatchObject({ fixtureCount: 1 });
    const written = scheduled.commit.mock.calls[0][1].find((w: { id: string }) => w.id === "basketball-mens-r1-m01");
    expect(written.data).toMatchObject({ status: "SCHEDULED", scheduledDate: "2026-11-10", scheduledTime: "09:00", venue: "Court 1" });
    const scored = dbWith({
      docs: { "competitions/basketball-mens": competition, "matchStates/basketball-mens-r1-m01": { fixtureId: "x", version: 1 } },
      fixtures: [fixture({ status: "SCHEDULED" })],
      queries: (c) => (c === "teams" ? teamRows(team("ta"), team("tb")) : undefined),
    });
    await expect(gen(scored)).rejects.toMatchObject({ code: "COMPETITION_HAS_NON_DRAFT_FIXTURES" });
    for (const status of ["LIVE", "COMPLETED", "CANCELLED", "POSTPONED"] as const) {
      const db = dbWith({
        docs: { "competitions/basketball-mens": competition },
        fixtures: [fixture({ status })],
        queries: (c) => (c === "teams" ? teamRows(team("ta"), team("tb")) : undefined),
      });
      await expect(gen(db)).rejects.toMatchObject({ code: "COMPETITION_HAS_NON_DRAFT_FIXTURES" });
    }
  });

  it("rejects duplicate and unknown entrantIds instead of double-seating or silently dropping", async () => {
    const db = dbWith({
      docs: { "competitions/basketball-mens": competition },
      queries: (c) => (c === "teams" ? teamRows(team("ta"), team("tb"), team("tc")) : undefined),
    });
    await expect(gen(db, { entrantIds: ["ta", "ta", "tb"] })).rejects.toMatchObject({ code: "DUPLICATE_ENTRANT_IDS" });
    await expect(gen(db, { entrantIds: ["ta", "tb", "tzz"] })).rejects.toMatchObject({ code: "UNKNOWN_ENTRANT_IDS" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("never seeds a withdrawn entrant, even when the seed order still lists them", async () => {
    const rows = teamRows(team("ta"), team("tb"), team("tc", { status: "WITHDRAWN" }), team("td"));
    const db = dbWith({
      docs: { "competitions/basketball-mens": competition },
      queries: (c) => (c === "teams" ? rows : undefined),
    });
    await gen(db);
    const seeded = db.commit.mock.calls[0][1]
      .filter((w: { collection: string; data?: unknown }) => w.collection === "fixtures" && w.data)
      .flatMap((w: { data: { slotA: { teamId?: string }; slotB: { teamId?: string } } }) => [w.data.slotA.teamId, w.data.slotB.teamId]);
    expect(seeded).not.toContain("tc");
    db.commit.mockClear();
    await gen(db, { entrantIds: ["tc", "td", "ta", "tb"] });
    const ordered = db.commit.mock.calls[0][1].find((w: { id: string }) => w.id === "basketball-mens-r1-m01");
    expect(ordered.data.slotA.teamId).toBe("td");
    await expect(gen(db, { entrantIds: ["ta", "zz"] })).rejects.toMatchObject({ code: "UNKNOWN_ENTRANT_IDS" });
  });

  it("regeneration never writes the same fixture document twice in one commit", async () => {
    const existing = [
      fixture({ fixtureId: "basketball-mens-r1-m01", status: "DRAFT" }),
      fixture({ fixtureId: "basketball-mens-r1-m02", matchNumber: 2, status: "DRAFT" }),
      fixture({ fixtureId: "basketball-mens-r2-m01", round: 2, matchNumber: 1, status: "DRAFT" }),
      fixture({ fixtureId: "basketball-mens-r1-m09", matchNumber: 9, status: "DRAFT" }),
    ];
    const db = dbWith({
      docs: { "competitions/basketball-mens": competition },
      fixtures: existing,
      queries: (c) => (c === "teams" ? teamRows(team("ta"), team("tb"), team("tc"), team("td")) : undefined),
    });
    await gen(db);
    const writes = db.commit.mock.calls[0][1].filter((w: { collection: string }) => w.collection === "fixtures");
    const ids = writes.map((w: { id: string }) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    const deleted = writes.filter((w: { delete?: boolean }) => w.delete).map((w: { id: string }) => w.id);
    expect(deleted).toEqual(["basketball-mens-r1-m09"]);
    const overwritten = writes.filter((w: { delete?: boolean }) => !w.delete).map((w: { id: string }) => w.id).sort();
    expect(overwritten).toEqual(["basketball-mens-r1-m01", "basketball-mens-r1-m02", "basketball-mens-r2-m01"]);
  });

  it("freezes the EFFECTIVE configuration: inherits the sport's when the competition has none", async () => {
    const sportConfig = defaultMatchConfigurations.basketball!;
    const db = dbWith({
      docs: { "competitions/basketball-mens": competition, "sports/basketball": { sportId: "basketball", matchConfiguration: sportConfig } },
      queries: (c) => (c === "teams" ? teamRows(team("ta"), team("tb")) : undefined),
    });
    await gen(db);
    const f = db.commit.mock.calls[0][1].find((w: { collection: string; data?: unknown }) => w.collection === "fixtures" && w.data) as { data: { matchConfigurationSnapshot: unknown } };
    expect(f.data.matchConfigurationSnapshot).toEqual(sportConfig);
  });

  it("records who/what in the audit entry", async () => {
    const db = dbWith({
      docs: { "competitions/basketball-mens": competition },
      queries: (c) => (c === "teams" ? teamRows(team("ta"), team("tb")) : undefined),
    });
    await gen(db);
    expect(db.commit.mock.calls[0][1].at(-1).data).toMatchObject({ action: "generateBracket", actorRole: "SUPER_ADMIN", targetId: "basketball-mens" });
  });
});

describe("publishBracket", () => {
  it("refuses to publish a competition that has no fixtures", async () => {
    const db = dbWith({ docs: { "competitions/basketball-mens": competition } });
    await expect(publishBracket(ctxFor(db), { competitionId: "basketball-mens" })).rejects.toMatchObject({ code: "NO_FIXTURES_TO_PUBLISH" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("schedules only DRAFT fixtures and audits the count", async () => {
    const db = dbWith({
      docs: { "competitions/basketball-mens": competition },
      fixtures: [fixture({ status: "DRAFT" })],
      queries: (c, filters) => (c === "fixtures" && filters.some((f) => f.field === "status") ? [{ id: "basketball-mens-r1-m01", data: fixture({ status: "DRAFT" }) }] : undefined),
    });
    await publishBracket(ctxFor(db), { competitionId: "basketball-mens" });
    const writes = db.commit.mock.calls[0][1];
    expect(writes[0]).toMatchObject({ collection: "competitions", data: { published: true } });
    expect(writes[1]).toMatchObject({ collection: "fixtures", data: { status: "SCHEDULED" } });
    expect(writes.at(-1).data.after).toMatchObject({ published: true, scheduledFixtureCount: 1 });
  });
});

describe("withdrawEntrant end to end", () => {
  const withdrawn = (over = {}) => ({ ...team("t1"), ...over });
  const run = (db: unknown, over: Record<string, unknown> = {}, role: "SUPER_ADMIN" | "SPORT_COORDINATOR" = "SUPER_ADMIN") =>
    withdrawEntrant(ctxFor(db, role, ["basketball"]), { collection: "teams", id: "t1", reason: "injury", ...over });

  it("requires a reason and a real entrant", async () => {
    const db = dbWith({ docs: { "teams/t1": withdrawn() } });
    await expect(run(db, { reason: "   " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    const missing = dbWith({ docs: { "teams/nope-team": null } });
    await expect(run(missing, { id: "nope-team" })).rejects.toMatchObject({ code: "ENTRANT_NOT_FOUND" });
    await expect(run(db, { collection: "sports" })).rejects.toMatchObject({ code: "INVALID_COLLECTION" });
  });

  it("cannot be withdrawn twice", async () => {
    const db = dbWith({ docs: { "teams/t1": withdrawn({ status: "WITHDRAWN" }) } });
    await expect(run(db)).rejects.toMatchObject({ code: "ALREADY_WITHDRAWN" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("reports affected non-terminal fixtures (slotA and slotB), ignores history, and rebrackets nothing", async () => {
    const fixtures = [
      fixture({ fixtureId: "basketball-mens-r1-m01", slotA: { kind: "TEAM", teamId: "t1" } }),
      fixture({ fixtureId: "basketball-mens-r1-m02", slotA: { kind: "TEAM", teamId: "x1" }, slotB: { kind: "TEAM", teamId: "t1" } }),
      fixture({ fixtureId: "basketball-mens-r1-m03", status: "COMPLETED", slotA: { kind: "TEAM", teamId: "t1" } }),
      fixture({ fixtureId: "basketball-mens-r1-m04", slotA: { kind: "TEAM", teamId: "x2" }, slotB: { kind: "TEAM", teamId: "x3" } }),
    ];
    const db = dbWith({ docs: { "teams/t1": withdrawn() }, fixtures });
    const out = (await run(db)) as { affectedFixtureIds: string[] };
    expect(out.affectedFixtureIds.sort()).toEqual(["basketball-mens-r1-m01", "basketball-mens-r1-m02"]);

    const writes = db.commit.mock.calls[0][1];
    expect(writes.map((w: { collection: string }) => w.collection)).toEqual(["teams", "auditLogs"]);
    expect(writes[0]).toMatchObject({ data: { status: "WITHDRAWN" }, mergeFields: ["status"] });
    expect(writes[1].data).toMatchObject({
      action: "withdrawEntrant", actorRole: "SUPER_ADMIN", reason: "injury",
      before: { status: "ACTIVE" }, after: { status: "WITHDRAWN", affectedFixtureIds: expect.any(Array) },
    });
  });

  it("is Super Admin only", async () => {
    const db = dbWith({ docs: { "teams/t1": withdrawn() } });
    await expect(run(db, {}, "SPORT_COORDINATOR")).rejects.toMatchObject({ code: "SUPER_ADMIN_REQUIRED" });
  });
});

describe("generic CRUD cannot bypass dedicated operations", () => {
  it("cannot withdraw or un-withdraw an entrant through upsertEntity", async () => {
    const existing = { ...team("t1"), status: "WITHDRAWN" };
    const db = dbWith({ docs: { "teams/t1": existing, "competitions/basketball-mens": competition } });
    await expect(upsertEntity(ctxFor(db), { collection: "teams", id: "t1", data: { status: "ACTIVE" } })).rejects.toMatchObject({ code: "USE_DEDICATED_WITHDRAWAL_OPERATION" });
    const fresh = dbWith({ docs: { "competitions/basketball-mens": competition } });
    await expect(
      upsertEntity(ctxFor(fresh), { collection: "teams", id: "t2", data: { ...team("t2"), memberIds: ["p1", "p2", "p3", "p4", "p5"], status: "WITHDRAWN" } })
    ).rejects.toMatchObject({ code: "USE_DEDICATED_WITHDRAWAL_OPERATION" });
  });

  it("still allows editing other fields of a withdrawn entrant without changing status", async () => {
    const existing = { ...team("t1", { memberIds: ["p1", "p2", "p3", "p4", "p5"] }), status: "WITHDRAWN" };
    const db = dbWith({ docs: { "teams/t1": existing, "competitions/basketball-mens": competition } });
    await expect(upsertEntity(ctxFor(db), { collection: "teams", id: "t1", data: { college: "New College" } })).resolves.toMatchObject({ ok: true });
    expect(db.commit.mock.calls[0][1][0].data.status).toBe("WITHDRAWN");
  });

  it("cannot flip a competition's published flag (publishBracket is authoritative)", async () => {
    const db = dbWith({ docs: { "competitions/basketball-mens": competition } });
    await expect(upsertEntity(ctxFor(db), { collection: "competitions", id: "basketball-mens", data: { published: true } })).rejects.toMatchObject({ code: "USE_DEDICATED_PUBLISH_OPERATION" });
  });

  it("locks sportId/participantType once fixtures exist, but allows the seeding-strategy edit the UI performs", async () => {
    const db = dbWith({ docs: { "competitions/basketball-mens": competition }, fixtures: [fixture({ status: "DRAFT" })] });
    await expect(upsertEntity(ctxFor(db), { collection: "competitions", id: "basketball-mens", data: { participantType: "INDIVIDUAL", teamSize: undefined } })).rejects.toBeTruthy();
    await expect(
      upsertEntity(ctxFor(db), { collection: "competitions", id: "basketball-mens", data: { tournamentConfiguration: { seeding: "RANDOM", byePolicy: "TOP_SEEDS" } } })
    ).resolves.toMatchObject({ ok: true });
  });

  it("refuses to delete a competition or sport that still has dependents", async () => {
    const withChildren = (collection: string) => dbWith({ docs: { "competitions/basketball-mens": competition, "sports/basketball": { sportId: "basketball" } }, queries: (c) => (c === collection ? [{ id: "x", data: {} }] : undefined) });
    await expect(deleteEntity(ctxFor(withChildren("fixtures")), { collection: "competitions", id: "basketball-mens" })).rejects.toMatchObject({ code: "ENTITY_HAS_DEPENDENTS" });
    await expect(deleteEntity(ctxFor(withChildren("teams")), { collection: "competitions", id: "basketball-mens" })).rejects.toMatchObject({ code: "ENTITY_HAS_DEPENDENTS" });
    await expect(deleteEntity(ctxFor(withChildren("competitions")), { collection: "sports", id: "basketball" })).rejects.toMatchObject({ code: "ENTITY_HAS_DEPENDENTS" });
  });

  it("reads the dependents inside the transaction, so a concurrently created child cannot slip past the check", async () => {
    const db = dbWith({ docs: { "competitions/basketball-mens": competition } });
    await deleteEntity(ctxFor(db), { collection: "competitions", id: "basketball-mens" });
    expect(db.runQuery.mock.calls.length).toBe(3);
    for (const call of db.runQuery.mock.calls) expect(call[2]).toBe("txn-1");
  });
});

describe("manageAdmin hardening", () => {
  const sport = { sportId: "basketball", name: "Basketball", scoringModel: "BASKETBALL_POINTS" };

  it("rejects a malformed email or unknown role as INVALID_INPUT, not a 500", async () => {
    const db = dbWith({});
    await expect(manageAdmin(ctxFor(db), { email: 42, role: "SUPER_ADMIN", active: true })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(manageAdmin(ctxFor(db), { email: "not-an-email", role: "SUPER_ADMIN", active: true })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(manageAdmin(ctxFor(db), { email: "a@example.com", role: "GOD", active: true })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects a coordinator assigned to a sport that does not exist", async () => {
    const db = dbWith({ docs: { "sports/basketball": sport } });
    await expect(manageAdmin(ctxFor(db), { email: "c@example.com", role: "SPORT_COORDINATOR", sportIds: ["basketbal"], active: true })).rejects.toMatchObject({ code: "UNKNOWN_SPORT_ID" });
    await expect(manageAdmin(ctxFor(db), { email: "c@example.com", role: "SPORT_COORDINATOR", sportIds: ["basketball", "basketball"], active: true })).resolves.toMatchObject({ ok: true });
    expect(db.commit.mock.calls[0][1][0].data.sportIds).toEqual(["basketball"]);
  });

  it("protects the single Super Admin from demotion or deactivation", async () => {
    const db = dbWith({
      docs: { "admins/root@example.com": { email: "root@example.com", role: "SUPER_ADMIN", active: true, sportIds: [], createdAt: "", createdBy: "" }, "sports/basketball": sport },
    });
    await expect(manageAdmin(ctxFor(db), { email: "root@example.com", role: "SPORT_COORDINATOR", sportIds: ["basketball"], active: true })).rejects.toMatchObject({ code: "SUPER_ADMIN_PROTECTED" });
    await expect(manageAdmin(ctxFor(db), { email: "root@example.com", role: "SUPER_ADMIN", active: false })).rejects.toMatchObject({ code: "SUPER_ADMIN_PROTECTED" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("refuses to create or promote a second Super Admin", async () => {
    const db = dbWith({ docs: { "admins/coord@example.com": { email: "coord@example.com", role: "SPORT_COORDINATOR", active: true, sportIds: ["basketball"], createdAt: "", createdBy: "" } } });
    await expect(manageAdmin(ctxFor(db), { email: "new@example.com", role: "SUPER_ADMIN", active: true })).rejects.toMatchObject({ code: "SINGLE_SUPER_ADMIN" });
    await expect(manageAdmin(ctxFor(db), { email: "coord@example.com", role: "SUPER_ADMIN", active: true })).rejects.toMatchObject({ code: "SINGLE_SUPER_ADMIN" });
    expect(db.commit).not.toHaveBeenCalled();
  });
});

describe("configuration lock treats auto-completed BYE fixtures as scaffolding", () => {
  it("allows a config change (with acknowledgement) when only DRAFT + BYE-completed fixtures exist", async () => {
    const byeDone = fixture({ status: "COMPLETED", slotB: { kind: "BYE" } });
    const draft = fixture({ fixtureId: "basketball-mens-r1-m02", matchNumber: 2, status: "DRAFT" });
    const db = dbWith({ docs: { "competitions/basketball-mens": competition }, fixtures: [byeDone, draft] });
    const cfg = defaultMatchConfigurations.basketball!;
    await expect(updateCompetitionConfig(ctxFor(db), { competitionId: "basketball-mens", matchConfiguration: cfg })).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED_EXISTING_DRAFT_FIXTURES" });
    await expect(updateCompetitionConfig(ctxFor(db), { competitionId: "basketball-mens", matchConfiguration: cfg, acknowledgeExistingFixtures: true })).resolves.toMatchObject({ ok: true });
  });

  it("stays locked when a genuinely played fixture exists", async () => {
    const played = fixture({ status: "COMPLETED" });
    const db = dbWith({ docs: { "competitions/basketball-mens": competition }, fixtures: [played] });
    await expect(
      updateCompetitionConfig(ctxFor(db), { competitionId: "basketball-mens", matchConfiguration: defaultMatchConfigurations.basketball!, acknowledgeExistingFixtures: true })
    ).rejects.toMatchObject({ code: "CONFIGURATION_LOCKED_OPERATIONAL_FIXTURES_EXIST" });
  });
});
