import { describe, expect, it } from "vitest";
import { previewPurge, purgeCompetition, deleteEntities, withdrawEntrants } from "../src/operations/purge";
import { ctxFor, dbWith, fixture } from "./helpers";

const CID = "basketball-mens";
const team = (id: string, extra: Record<string, unknown> = {}) => ({
  teamId: id, teamName: id, sportId: "basketball", competitionId: CID, college: id, captainParticipantId: "p1", memberIds: ["p1"], ...extra,
});
const person = (id: string, extra: Record<string, unknown> = {}) => ({
  participantId: id, name: id, phone: "", college: id, sportId: "basketball", competitionId: CID, ...extra,
});
const rows = <T extends object>(idKey: string, items: T[]) => items.map((data) => ({ id: (data as Record<string, string>)[idKey], data }));
const competitionDoc = { competitionId: CID, sportId: "basketball", name: "Men", categoryKey: "mens", gender: "MALE", participantType: "TEAM", format: "KNOCKOUT", published: false, displayOrder: 0 };

function world(opts: { fixtures?: ReturnType<typeof fixture>[]; teams?: ReturnType<typeof team>[]; participants?: ReturnType<typeof person>[] }) {
  return dbWith({
    docs: { [`competitions/${CID}`]: competitionDoc },
    fixtures: opts.fixtures ?? [],
    queries: (collection) => {
      if (collection === "teams") return rows("teamId", opts.teams ?? []);
      if (collection === "participants") return rows("participantId", opts.participants ?? []);
      return undefined;
    },
  });
}

const draft = (n: number, a: string, b: string) =>
  fixture({ fixtureId: `${CID}-r1-m0${n}`, matchNumber: n, status: "DRAFT", slotA: { kind: "TEAM", teamId: a }, slotB: { kind: "TEAM", teamId: b } });

describe("previewPurge", () => {
  it("counts what would go, offers a backup in the import format, and never commits", async () => {
    const db = world({ fixtures: [draft(1, "t1", "t2")], teams: [team("t1"), team("t2")], participants: [person("p1")] });
    const out = await previewPurge(ctxFor(db), { competitionId: CID });
    expect(out.counts).toEqual({ fixtures: 1, teams: 2, participants: 1 });
    expect(out.canPurge).toBe(true);
    expect(out.blockers).toEqual([]);
    expect(out.backup.schemaVersion).toBe("kshitij.canonical/1");
    expect(out.backup.teams).toHaveLength(2);
    expect(db.commit).not.toHaveBeenCalled();
    expect(db.commitChunked).not.toHaveBeenCalled();
    expect(db.rollback).toHaveBeenCalled();
  });

  it("blocks when fixtures are already published or played", async () => {
    const played = fixture({ fixtureId: `${CID}-r1-m01`, status: "COMPLETED" });
    const db = world({ fixtures: [played], teams: [team("t1"), team("t2")] });
    const out = await previewPurge(ctxFor(db), { competitionId: CID });
    expect(out.canPurge).toBe(false);
    expect(out.blockers.map((b) => b.code)).toContain("FIXTURES_PUBLISHED_OR_PLAYED");
  });

  it("scopes to one import batch and blocks when remaining fixtures still seat those entrants", async () => {
    const db = world({
      fixtures: [draft(1, "t1", "t2")],
      teams: [team("t1", { importBatchId: "import-1" }), team("t2")],
    });
    const out = await previewPurge(ctxFor(db), { competitionId: CID, importBatchId: "import-1" });
    expect(out.counts.teams).toBe(1);
    expect(out.blockers.map((b) => b.code)).toContain("ENTITY_REFERENCED_BY_FIXTURE");
  });

  it("is Super Admin only", async () => {
    const db = world({});
    await expect(previewPurge(ctxFor(db, "SPORT_COORDINATOR", ["basketball"]), { competitionId: CID })).rejects.toMatchObject({ code: "SUPER_ADMIN_REQUIRED" });
  });
});

describe("purgeCompetition", () => {
  it("requires the competition id as confirmation before reading anything", async () => {
    const db = world({ teams: [team("t1")] });
    await expect(purgeCompetition(ctxFor(db), { competitionId: CID, confirm: "nope" })).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });
    expect(db.beginTransaction).not.toHaveBeenCalled();
  });

  it("deletes fixtures, teams and participants in one verified chunked commit with an audit trailer", async () => {
    const db = world({ fixtures: [draft(1, "t1", "t2")], teams: [team("t1"), team("t2")], participants: [person("p1")] });
    const out = await purgeCompetition(ctxFor(db), { competitionId: CID, confirm: CID });
    expect(out).toEqual({ deleted: { fixtures: 1, teams: 2, participants: 1 }, remaining: 0 });
    const [, writes, options] = db.commitChunked.mock.calls[0];
    expect(writes).toHaveLength(4);
    expect(writes.every((w: { delete?: boolean }) => w.delete === true)).toBe(true);
    expect(options.verifyQueries).toBe(true);
    expect(options.trailer(0, 1).data).toMatchObject({ action: "purgeCompetition", targetId: CID, actorRole: "SUPER_ADMIN" });
  });

  it("refuses when blockers exist and writes nothing", async () => {
    const played = fixture({ fixtureId: `${CID}-r1-m01`, status: "LIVE" });
    const db = world({ fixtures: [played], teams: [team("t1")] });
    await expect(purgeCompetition(ctxFor(db), { competitionId: CID, confirm: CID })).rejects.toMatchObject({ code: "PURGE_BLOCKED" });
    expect(db.commitChunked).not.toHaveBeenCalled();
    expect(db.rollback).toHaveBeenCalled();
  });

  it("reports nothing to purge for an empty competition", async () => {
    const db = world({});
    await expect(purgeCompetition(ctxFor(db), { competitionId: CID, confirm: CID })).rejects.toMatchObject({ code: "NOTHING_TO_PURGE" });
  });

  it("caps one call and reports how much remains", async () => {
    const many = Array.from({ length: 8100 }, (_, i) => person(`p${i}`));
    const db = world({ participants: many });
    const out = await purgeCompetition(ctxFor(db), { competitionId: CID, confirm: CID });
    expect(out.deleted.participants).toBe(8000);
    expect(out.remaining).toBe(100);
  });
});

describe("deleteEntities", () => {
  it("deletes the free ones and reports the seated, team-bound and unknown ones as blocked", async () => {
    const db = world({
      fixtures: [draft(1, "t1", "t2")],
      teams: [team("t1"), team("t2"), team("t3")],
    });
    const out = await deleteEntities(ctxFor(db), { collection: "teams", competitionId: CID, ids: ["t1", "t3", "ghost", "t3"] });
    expect(out.deleted).toEqual(["t3"]);
    expect(out.blocked).toEqual([
      expect.objectContaining({ id: "t1", code: "ENTITY_REFERENCED_BY_FIXTURE" }),
      expect.objectContaining({ id: "ghost", code: "ENTITY_NOT_FOUND" }),
    ]);
    const [, writes, options] = db.commitChunked.mock.calls[0];
    expect(writes).toEqual([{ collection: "teams", id: "t3", delete: true }]);
    expect(options.verifyQueries).toBe(true);
  });

  it("blocks participants who are still on a team", async () => {
    const db = world({ teams: [team("t1", { memberIds: ["p1", "p2"] })], participants: [person("p1"), person("p2"), person("p3")] });
    const out = await deleteEntities(ctxFor(db), { collection: "participants", competitionId: CID, ids: ["p1", "p3"] });
    expect(out.deleted).toEqual(["p3"]);
    expect(out.blocked[0]).toMatchObject({ id: "p1", code: "ENTITY_REFERENCED_BY_TEAM" });
  });

  it("commits nothing when nothing is deletable", async () => {
    const db = world({ fixtures: [draft(1, "t1", "t2")], teams: [team("t1"), team("t2")] });
    const out = await deleteEntities(ctxFor(db), { collection: "teams", competitionId: CID, ids: ["t1"] });
    expect(out.deleted).toEqual([]);
    expect(db.commitChunked).not.toHaveBeenCalled();
  });

  it("is Super Admin only", async () => {
    await expect(deleteEntities(ctxFor(world({}), "SPORT_COORDINATOR", ["basketball"]), { collection: "teams", competitionId: CID, ids: ["t1"] })).rejects.toMatchObject({ code: "SUPER_ADMIN_REQUIRED" });
  });
});

describe("withdrawEntrants", () => {
  it("withdraws active entrants, skips unknown and already withdrawn ones, and lists open affected fixtures", async () => {
    const db = world({
      fixtures: [draft(1, "t1", "t2"), fixture({ fixtureId: `${CID}-r1-m02`, matchNumber: 2, status: "COMPLETED", slotA: { kind: "TEAM", teamId: "t1" }, slotB: { kind: "TEAM", teamId: "t3" } })],
      teams: [team("t1"), team("t2", { status: "WITHDRAWN" }), team("t3")],
    });
    const out = await withdrawEntrants(ctxFor(db), { collection: "teams", competitionId: CID, ids: ["t1", "t2", "ghost"], reason: "forfeit" });
    expect(out.withdrawn).toEqual(["t1"]);
    expect(out.skipped.map((s) => s.code).sort()).toEqual(["ALREADY_WITHDRAWN", "ENTITY_NOT_FOUND"]);
    expect(out.affectedFixtureIds).toEqual([`${CID}-r1-m01`]);
    const [, writes, options] = db.commitChunked.mock.calls[0];
    expect(writes).toEqual([{ collection: "teams", id: "t1", data: { status: "WITHDRAWN" }, mergeFields: ["status"] }]);
    expect(options.trailer(0, 1).data).toMatchObject({ action: "withdrawEntrants", reason: "forfeit" });
  });

  it("requires a reason", async () => {
    await expect(withdrawEntrants(ctxFor(world({})), { collection: "teams", competitionId: CID, ids: ["t1"], reason: "  " })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
