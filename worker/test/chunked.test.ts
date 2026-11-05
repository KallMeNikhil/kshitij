import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirestoreRestClient, COMMIT_CHUNK_SIZE, chunk } from "../src/firestore/client";
import { commitImport } from "../src/operations/import";
import { saveFixture } from "../src/operations/match";
import { resumeFixture } from "../src/operations/lifecycle";
import { ctxFor, dbWith, fixture } from "./helpers";

const PROJECT_ID = "kshitij-test";
const TOKEN = "id-token-secret-value";

const writes = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ collection: "sports", id: `s${i}`, data: { sportId: `s${i}` }, mergeFields: ["sportId"] }));

const ok = () => new Response("{}", { status: 200 });
const denied = () =>
  new Response(JSON.stringify({ error: { code: 403, status: "PERMISSION_DENIED", message: "no" } }), { status: 403 });

describe("chunk", () => {
  it("splits into groups of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("FirestoreRestClient.commitChunked", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  const bodies = () => mockFetch.mock.calls.map((c) => JSON.parse(c[1].body).writes);
  const trailer = (i: number) => ({ collection: "auditLogs", id: `a${i}`, data: { action: "x", n: i } });

  it("splits writes into commits of at most the chunk size, each with its own audit trailer", async () => {
    mockFetch.mockResolvedValue(ok());
    const db = new FirestoreRestClient(PROJECT_ID, TOKEN);
    const batches = await db.commitChunked(await db.beginTransaction(), writes(COMMIT_CHUNK_SIZE * 2 + 1), { trailer });
    expect(batches).toBe(3);
    const sent = bodies();
    expect(sent.map((w: unknown[]) => w.length)).toEqual([COMMIT_CHUNK_SIZE + 1, COMMIT_CHUNK_SIZE + 1, 2]);
    for (const w of sent) expect(w.every((x: { update?: { name: string } }) => x.update)).toBe(true);
    expect(sent.every((w: Array<{ update: { name: string } }>) => w.at(-1)!.update.name.includes("/auditLogs/"))).toBe(true);
  });

  it("rejects work that needs more than the allowed number of commits before sending anything", async () => {
    const db = new FirestoreRestClient(PROJECT_ID, TOKEN);
    await expect(db.commitChunked(await db.beginTransaction(), writes(10), { chunkSize: 1, maxChunks: 3 })).rejects.toMatchObject({ code: "OPERATION_TOO_LARGE" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reports PARTIAL_COMMIT when a later batch fails after earlier ones were saved", async () => {
    mockFetch.mockResolvedValueOnce(ok()).mockResolvedValueOnce(denied());
    const db = new FirestoreRestClient(PROJECT_ID, TOKEN);
    const err = await db.commitChunked(await db.beginTransaction(), writes(6), { chunkSize: 3 }).catch((e) => e);
    expect(err.code).toBe("PARTIAL_COMMIT");
    expect(err.message).toContain("1 of 2");
  });

  it("surfaces the original error when the first batch fails", async () => {
    mockFetch.mockResolvedValueOnce(denied());
    const db = new FirestoreRestClient(PROJECT_ID, TOKEN);
    const err = await db.commitChunked(await db.beginTransaction(), writes(6), { chunkSize: 3 }).catch((e) => e);
    expect(err.code).toBe("FORBIDDEN");
  });

  it("sends exists:false for mustNotExist writes", async () => {
    mockFetch.mockResolvedValue(ok());
    const db = new FirestoreRestClient(PROJECT_ID, TOKEN);
    await db.commitChunked(await db.beginTransaction(), [{ collection: "teams", id: "t1", data: { teamId: "t1" }, mustNotExist: true }]);
    expect(bodies()[0][0].currentDocument).toEqual({ exists: false });
  });

  it("re-runs tracked filtered queries and aborts when the result changed", async () => {
    const row = (id: string) => JSON.stringify([{ document: { name: `projects/p/databases/(default)/documents/teams/${id}`, fields: {}, updateTime: "2026-01-01T00:00:00Z" } }]);
    mockFetch.mockResolvedValueOnce(new Response(row("t1"))).mockResolvedValueOnce(new Response(row("t2")));
    const db = new FirestoreRestClient(PROJECT_ID, TOKEN);
    const txn = await db.beginTransaction();
    await db.runQuery("teams", [{ field: "competitionId", op: "EQUAL", value: "c" }], txn);
    await expect(db.commitChunked(txn, writes(1), { verifyQueries: true })).rejects.toMatchObject({ code: "ABORTED" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("encodes IN filters as arrays", async () => {
    mockFetch.mockResolvedValue(new Response("[]"));
    const db = new FirestoreRestClient(PROJECT_ID, TOKEN);
    await db.runQuery("teams", [{ field: "competitionId", op: "IN", value: ["a", "b"] }]);
    const where = JSON.parse(mockFetch.mock.calls[0][1].body).structuredQuery.where.fieldFilter;
    expect(where.op).toBe("IN");
    expect(where.value.arrayValue.values).toEqual([{ stringValue: "a" }, { stringValue: "b" }]);
  });
});

describe("commitImport data layer", () => {
  const payload = {
    schemaVersion: "kshitij.canonical/1",
    sports: [{ sportId: "chess", name: "Chess", scoringModel: "RESULT_ONLY" }],
    competitions: [{ competitionId: "chess-open", sportId: "chess", name: "Open", categoryKey: "open", gender: null, participantType: "INDIVIDUAL", format: "KNOCKOUT" }],
    participants: [{ participantId: "chess-open-arjun-1234", name: "Arjun", phone: "9876543210", college: "JIIT", sportId: "chess", competitionId: "chess-open" }],
  };

  it("scopes entrant reads to the competitions in the file instead of scanning whole collections", async () => {
    const db = dbWith({});
    await commitImport(ctxFor(db), payload);
    const scoped = db.runQuery.mock.calls.filter((c) => c[0] === "participants" || c[0] === "teams" || c[0] === "fixtures");
    expect(scoped).toHaveLength(3);
    for (const call of scoped) expect(call[1]).toEqual([{ field: "competitionId", op: "IN", value: ["chess-open"] }]);
  });

  it("stamps new entrants with the batch id, requires them not to exist, and returns the batch id", async () => {
    const db = dbWith({});
    const result = (await commitImport(ctxFor(db), payload)) as { importBatchId: string };
    expect(result.importBatchId).toMatch(/^import-\d+$/);
    const [, written] = db.commit.mock.calls[0];
    const p = written.find((w: { collection: string }) => w.collection === "participants");
    expect(p.data.importBatchId).toBe(result.importBatchId);
    expect(p.mustNotExist).toBe(true);
    expect(written.at(-1).data).toMatchObject({ action: "commitImport", targetId: result.importBatchId });
  });

  it("does not restamp entrants that already exist", async () => {
    const existing = { ...payload.participants[0], importBatchId: "import-1" };
    const db = dbWith({
      queries: (c) =>
        c === "participants"
          ? [{ id: existing.participantId, data: existing }]
          : c === "sports"
            ? [{ id: "chess", data: payload.sports[0] }]
            : c === "competitions"
              ? [{ id: "chess-open", data: { ...payload.competitions[0], published: false, displayOrder: 0 } }]
              : undefined,
    });
    await commitImport(ctxFor(db), { schemaVersion: payload.schemaVersion, participants: payload.participants });
    const p = db.commit.mock.calls[0][1].find((w: { collection: string }) => w.collection === "participants");
    expect(p.data).not.toHaveProperty("importBatchId");
    expect(p.mustNotExist).toBe(false);
  });

  it("turns a concurrent-write abort into IMPORT_CONFLICT and rolls back", async () => {
    const { AppError } = await import("../src/errors");
    const db = dbWith({});
    db.commitChunked.mockRejectedValueOnce(new AppError(409, "ABORTED", "x"));
    await expect(commitImport(ctxFor(db), payload)).rejects.toMatchObject({ code: "IMPORT_CONFLICT" });
    expect(db.rollback).toHaveBeenCalled();
  });
});

describe("venue conflicts in operations", () => {
  const other = fixture({ fixtureId: "basketball-mens-r1-m02", matchNumber: 2, status: "SCHEDULED", scheduledDate: "2026-10-12", scheduledTime: "10:00", venue: "Court 1" });
  const target = fixture({ status: "SCHEDULED" });

  it("saveFixture rejects a venue already booked at that time", async () => {
    const db = dbWith({ fixtures: [target, other], queries: (c) => (c === "fixtures" ? [{ id: other.fixtureId, data: other }] : undefined) });
    await expect(
      saveFixture(ctxFor(db, "SPORT_COORDINATOR", ["basketball"]), { fixtureId: target.fixtureId, scheduledDate: "2026-10-12", scheduledTime: "10:00", venue: "court 1" })
    ).rejects.toMatchObject({ code: "SCHEDULE_CONFLICT" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("saveFixture allows the same venue at a different time", async () => {
    const db = dbWith({ fixtures: [target, other], queries: (c) => (c === "fixtures" ? [{ id: other.fixtureId, data: other }] : undefined) });
    await expect(
      saveFixture(ctxFor(db, "SPORT_COORDINATOR", ["basketball"]), { fixtureId: target.fixtureId, scheduledDate: "2026-10-12", scheduledTime: "11:00", venue: "Court 1" })
    ).resolves.toBeDefined();
  });

  it("resumeFixture rejects a reschedule into a booked slot", async () => {
    const postponed = fixture({ status: "POSTPONED", resumeStatus: "SCHEDULED" });
    const db = dbWith({ fixtures: [postponed, other], queries: (c) => (c === "fixtures" ? [{ id: other.fixtureId, data: other }] : undefined) });
    await expect(
      resumeFixture(ctxFor(db, "SPORT_COORDINATOR", ["basketball"]), { fixtureId: postponed.fixtureId, scheduledDate: "2026-10-12", scheduledTime: "10:00", venue: "Court 1" })
    ).rejects.toMatchObject({ code: "SCHEDULE_CONFLICT" });
  });
});
