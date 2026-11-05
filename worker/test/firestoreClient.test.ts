import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirestoreRestClient } from "../src/firestore/client";
import type { Env } from "../src/router";
import { AppError } from "../src/errors";

const PROJECT_ID = "kshitij-test";
const TOKEN_SECRET = "id-token-secret-value";

const sportWrites = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    collection: "sports",
    id: `sport-${i}`,
    data: { sportId: `sport-${i}`, name: `Sport ${i}` },
    mergeFields: ["sportId", "name"],
  }));

const denied = () =>
  new Response(JSON.stringify({ error: { code: 403, status: "PERMISSION_DENIED", message: "Missing or insufficient permissions." } }), {
    status: 403,
  });

describe("FirestoreRestClient", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("commits with documented resource names and the caller's token", async () => {
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const db = new FirestoreRestClient(PROJECT_ID, TOKEN_SECRET);
    await db.commit(await db.beginTransaction(), sportWrites(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`);
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN_SECRET}`);
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty("transaction");
    expect(body.writes[0].update.name).toBe(`projects/${PROJECT_ID}/databases/(default)/documents/sports/sport-0`);
    expect(body.writes[0].updateMask).toEqual({ fieldPaths: ["sportId", "name"] });
  });

  it("keeps the emulator host for the request URL but not in document names", async () => {
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const db = new FirestoreRestClient("demo-kshitij", TOKEN_SECRET, "127.0.0.1:8080");
    await db.commit(await db.beginTransaction(), sportWrites(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8080/v1/projects/demo-kshitij/databases/(default)/documents:commit");
    expect(JSON.parse(init.body).writes[0].update.name).toBe("projects/demo-kshitij/databases/(default)/documents/sports/sport-0");
  });

  it("maps a denied commit to FORBIDDEN and records phase, status and write counts without secrets", async () => {
    mockFetch.mockResolvedValueOnce(denied());
    const db = new FirestoreRestClient(PROJECT_ID, TOKEN_SECRET);
    const writes = [...sportWrites(9), { collection: "auditLogs", id: "a1", data: { action: "commitImport" } }];
    const err = (await db.commit(await db.beginTransaction(), writes).catch((e) => e)) as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("Firestore denied the request");
    expect(err.diagnostics).toEqual({
      phase: "commit",
      writeCounts: { sports: 9, auditLogs: 1 },
      httpStatus: 403,
      firestoreStatus: "PERMISSION_DENIED",
      firestoreMessage: "Missing or insufficient permissions.",
    });
    expect(JSON.stringify(err.diagnostics)).not.toContain(TOKEN_SECRET);
  });

  it("never calls Firestore's beginTransaction, which security-rules callers are denied", async () => {
    const db = new FirestoreRestClient(PROJECT_ID, TOKEN_SECRET);
    const transaction = await db.beginTransaction();
    expect(transaction).toEqual(expect.any(String));
    await db.rollback(transaction);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reads inside a transaction without sending a transaction id, and identifies a denied query", async () => {
    mockFetch.mockResolvedValueOnce(new Response("[]", { status: 200 })).mockResolvedValueOnce(denied());
    const db = new FirestoreRestClient(PROJECT_ID, TOKEN_SECRET);
    const transaction = await db.beginTransaction();
    await db.runQuery("sports", [], transaction);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).not.toHaveProperty("transaction");
    const err = (await db.runQuery("teams", [], transaction).catch((e) => e)) as AppError;
    expect(err.diagnostics).toMatchObject({ phase: "runQuery", collection: "teams", inTransaction: true });
  });

  it("commits atomically with preconditions taken from what the transaction read", async () => {
    const existing = {
      document: { name: `projects/${PROJECT_ID}/databases/(default)/documents/sports/old`, fields: {}, updateTime: "2026-10-10T00:00:00.000000Z" },
    };
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify([existing]), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const db = new FirestoreRestClient(PROJECT_ID, TOKEN_SECRET);
    const transaction = await db.beginTransaction();
    await db.runQuery("sports", [], transaction);
    await db.getDocument("admins", "gone", transaction);
    await db.commit(transaction, [
      { collection: "sports", id: "old", data: { name: "Old" }, mergeFields: ["name"] },
      { collection: "sports", id: "new", data: { name: "New" }, mergeFields: ["name"] },
      { collection: "admins", id: "gone", data: { email: "gone" } },
      { collection: "teams", id: "unread", data: { teamId: "unread" } },
      { collection: "admins", id: "gone", delete: true },
    ]);
    const body = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(body).not.toHaveProperty("transaction");
    expect(body.writes.map((w: Record<string, unknown>) => w.currentDocument)).toEqual([
      { updateTime: "2026-10-10T00:00:00.000000Z" },
      { exists: false },
      { exists: false },
      undefined,
      undefined,
    ]);
  });

  it("does not report a failed precondition outside a commit, such as a missing index, as a concurrent update", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { status: "FAILED_PRECONDITION", message: "The query requires an index." } }), { status: 400 })
    );
    const db = new FirestoreRestClient(PROJECT_ID, TOKEN_SECRET);
    const err = (await db.runQuery("fixtures", [{ field: "competitionId", op: "EQUAL", value: "c1" }]).catch((e) => e)) as AppError;
    expect(err).toMatchObject({ code: "INTERNAL", status: 500 });
    expect(err.diagnostics).toMatchObject({ phase: "runQuery", firestoreStatus: "FAILED_PRECONDITION", firestoreMessage: "The query requires an index." });
  });

  it("refuses to commit an unknown transaction and maps a failed precondition to ABORTED", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "FAILED_PRECONDITION", message: "x" } }), { status: 400 }));
    const db = new FirestoreRestClient(PROJECT_ID, TOKEN_SECRET);
    expect(await db.commit("missing", sportWrites(1)).catch((e) => e)).toMatchObject({ code: "INTERNAL" });
    expect(mockFetch).not.toHaveBeenCalled();
    const transaction = await db.beginTransaction();
    expect(await db.commit(transaction, sportWrites(1)).catch((e) => e)).toMatchObject({ code: "ABORTED", status: 409 });
  });

  it("still maps ABORTED and unknown failures to stable codes", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "ABORTED", message: "x" } }), { status: 409 }))
      .mockResolvedValueOnce(new Response("not json", { status: 500 }));
    const db = new FirestoreRestClient(PROJECT_ID, TOKEN_SECRET);
    expect(await db.commit(await db.beginTransaction(), sportWrites(1)).catch((e) => e)).toMatchObject({ code: "ABORTED", status: 409 });
    expect(await db.commit(await db.beginTransaction(), sportWrites(1)).catch((e) => e)).toMatchObject({ code: "INTERNAL", status: 500 });
  });
});

describe("POST /api/commitImport against a denying Firestore", () => {
  const ENV: Env = { FIREBASE_PROJECT_ID: PROJECT_ID, ALLOWED_ORIGIN: "http://127.0.0.1:5173" };
  let mockFetch: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const adminDoc = (over: Record<string, unknown> = {}) => {
    const base = { email: "root@example.com", role: "SUPER_ADMIN", active: true, sportIds: [] as string[], ...over };
    return {
      fields: {
        email: { stringValue: base.email as string },
        role: { stringValue: base.role as string },
        active: { booleanValue: base.active as boolean },
        sportIds: { arrayValue: { values: [] } },
      },
    };
  };

  const importBody = () => ({
    data: {
      schemaVersion: "kshitij.canonical/1",
      sports: Array.from({ length: 9 }, (_, i) => ({ sportId: `sport${i}`, name: `Sport ${i}`, scoringModel: "RESULT_ONLY" })),
    },
  });

  const request = () =>
    new Request("https://worker.example/api/commitImport", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN_SECRET}` },
      body: JSON.stringify(importBody()),
    });

  beforeEach(async () => {
    vi.resetModules();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns FORBIDDEN without a result, never begins a Firestore transaction, and logs safe diagnostics", async () => {
    vi.doMock("../src/auth/verifyIdToken", () => ({
      extractBearerToken: () => TOKEN_SECRET,
      verifyFirebaseIdToken: async () => ({ email: "Root@Example.com" }),
    }));
    const { handleRequest: handle } = await import("../src/router");
    const calls: string[] = [];
    mockFetch.mockImplementation(async (url: string) => {
      calls.push(url.replace(/^.*\/documents/, ""));
      if (url.includes("/admins/")) return new Response(JSON.stringify(adminDoc()), { status: 200 });
      if (url.endsWith(":beginTransaction")) return denied();
      if (url.endsWith(":runQuery")) return new Response("[{}]", { status: 200 });
      if (url.endsWith(":commit")) return denied();
      return new Response("{}", { status: 200 });
    });

    const res = await handle(request(), ENV);
    const body = (await res.json()) as { result?: unknown; error?: { code: string; message: string } };

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: { code: "FORBIDDEN", message: "Firestore denied the request" } });
    expect(body.result).toBeUndefined();
    expect(calls).toContain(":commit");
    expect(calls).not.toContain(":beginTransaction");
    expect(calls).not.toContain(":rollback");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(JSON.parse(logged)).toMatchObject({
      operation: "commitImport",
      code: "FORBIDDEN",
      phase: "commitChunked",
      httpStatus: 403,
      firestoreStatus: "PERMISSION_DENIED",
      writeCounts: { sports: 9, auditLogs: 1 },
    });
    expect(logged).not.toContain(TOKEN_SECRET);
    expect(logged).not.toContain("Bearer");
  });

  it("reports success only when Firestore confirmed the commit", async () => {
    vi.doMock("../src/auth/verifyIdToken", () => ({
      extractBearerToken: () => TOKEN_SECRET,
      verifyFirebaseIdToken: async () => ({ email: "root@example.com" }),
    }));
    const { handleRequest: handle } = await import("../src/router");
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/admins/")) return new Response(JSON.stringify(adminDoc()), { status: 200 });
      if (url.endsWith(":beginTransaction")) return denied();
      if (url.endsWith(":runQuery")) return new Response("[{}]", { status: 200 });
      if (url.endsWith(":commit")) return new Response("{}", { status: 200 });
      return new Response("{}", { status: 200 });
    });
    const res = await handle(request(), ENV);
    const body = (await res.json()) as { result?: { ok: boolean; counts: { sports: unknown } } };
    expect(res.status).toBe(200);
    expect(body.result?.ok).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
