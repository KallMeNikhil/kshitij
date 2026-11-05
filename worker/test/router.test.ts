import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { handleRequest, Env } from "../src/router";

const PROJECT_ID = "demo-kshitij";

const ENV: Env = {
  FIREBASE_PROJECT_ID: PROJECT_ID,
  ALLOWED_ORIGIN: "http://127.0.0.1:5173",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
};

function b64url(obj: unknown): string {
  const json = JSON.stringify(obj);
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fakeToken(payload: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "none", typ: "JWT" });
  const body = b64url({
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: "user-123",
    email: "coordinator@example.com",
    email_verified: true,
    auth_time: now - 10,
    exp: now + 3600,
    iat: now - 10,
    ...payload,
  });
  return `${header}.${body}.signature`;
}

function firestoreDocResponse(fields: Record<string, unknown>) {
  const encode = (v: unknown): unknown => {
    if (typeof v === "string") return { stringValue: v };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") return { integerValue: String(v) };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
    return { nullValue: null };
  };
  const encoded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) encoded[k] = encode(v);
  return { fields: encoded };
}

describe("router", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects non-POST requests to known operations", async () => {
    const req = new Request("https://worker.example/api/startMatch", { method: "GET" });
    const res = await handleRequest(req, ENV);
    expect(res.status).toBe(405);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("returns 404 for an unknown operation", async () => {
    const req = new Request("https://worker.example/api/notARealOperation", {
      method: "POST",
      body: "{}",
    });
    const res = await handleRequest(req, ENV);
    expect(res.status).toBe(404);
  });

  it("returns 400 for malformed JSON", async () => {
    const req = new Request("https://worker.example/api/startMatch", {
      method: "POST",
      headers: { Authorization: `Bearer ${fakeToken({})}` },
      body: "{not json",
    });
    const res = await handleRequest(req, ENV);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BAD_REQUEST_BODY");
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const req = new Request("https://worker.example/api/startMatch", {
      method: "POST",
      body: JSON.stringify({ data: { fixtureId: "f1" } }),
    });
    const res = await handleRequest(req, ENV);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it("returns 401 for an invalid token", async () => {
    const req = new Request("https://worker.example/api/startMatch", {
      method: "POST",
      headers: { Authorization: "Bearer not-a-jwt" },
      body: JSON.stringify({ data: {} }),
    });
    const res = await handleRequest(req, ENV);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no admin record", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("not found", { status: 404 })
    );
    const req = new Request("https://worker.example/api/startMatch", {
      method: "POST",
      headers: { Authorization: `Bearer ${fakeToken({})}` },
      body: JSON.stringify({ data: {} }),
    });
    const res = await handleRequest(req, ENV);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_AN_ADMIN");
  });

  it("returns 403 when the admin is inactive", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          firestoreDocResponse({
            email: "coordinator@example.com",
            role: "SPORT_COORDINATOR",
            active: false,
            sportIds: ["FOOTBALL"],
          })
        ),
        { status: 200 }
      )
    );
    const req = new Request("https://worker.example/api/startMatch", {
      method: "POST",
      headers: { Authorization: `Bearer ${fakeToken({})}` },
      body: JSON.stringify({ data: {} }),
    });
    const res = await handleRequest(req, ENV);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ADMIN_INACTIVE");
  });

  it("returns 403 when a coordinator is not assigned to the fixture's sport", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          firestoreDocResponse({
            email: "coordinator@example.com",
            role: "SPORT_COORDINATOR",
            active: true,
            sportIds: ["CRICKET"],
          })
        ),
        { status: 200 }
      )
    );
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          firestoreDocResponse({
            fixtureId: "f1",
            sportId: "FOOTBALL",
            status: "SCHEDULED",
            slotA: {},
            slotB: {},
          })
        ),
        { status: 200 }
      )
    );

    const req = new Request("https://worker.example/api/startMatch", {
      method: "POST",
      headers: { Authorization: `Bearer ${fakeToken({})}` },
      body: JSON.stringify({ data: { fixtureId: "f1" } }),
    });
    const res = await handleRequest(req, ENV);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SPORT_NOT_ASSIGNED");
  });

  it("responds to CORS preflight requests", async () => {
    const req = new Request("https://worker.example/api/startMatch", { method: "OPTIONS" });
    const res = await handleRequest(req, ENV);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ENV.ALLOWED_ORIGIN);
  });
});

describe("CORS allowlist", () => {
  const MULTI: Env = { ...ENV, ALLOWED_ORIGIN: "https://a.example, https://b.example" };
  const preflight = (origin?: string, env: Env = MULTI) =>
    handleRequest(
      new Request("https://worker.example/api/saveFixture", { method: "OPTIONS", headers: origin ? { Origin: origin } : {} }),
      env
    );

  it("echoes the request origin when it is in the allowlist", async () => {
    for (const origin of ["https://a.example", "https://b.example"]) {
      const res = await preflight(origin);
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(res.headers.get("Vary")).toBe("Origin");
    }
  });

  it("never echoes an origin that is not listed", async () => {
    const res = await preflight("https://evil.example");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://a.example");
  });

  it("falls back to the first listed origin when no Origin header is sent", async () => {
    const res = await preflight();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://a.example");
  });

  it("applies the same headers to error responses", async () => {
    const res = await handleRequest(
      new Request("https://worker.example/api/unknownOp", { method: "POST", headers: { Origin: "https://b.example" } }),
      MULTI
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://b.example");
  });

  it("allows any origin only when explicitly configured with *", async () => {
    const res = await preflight("https://anything.example", { ...ENV, ALLOWED_ORIGIN: "*" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
