import { describe, expect, it } from "vitest";
import { verifyFirebaseIdToken, extractBearerToken } from "../src/auth/verifyIdToken";
import { AppError } from "../src/errors";

const PROJECT_ID = "demo-kshitij";

function b64url(obj: unknown): string {
  const json = JSON.stringify(obj);
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fakeToken(payload: Record<string, unknown>): string {
  const header = b64url({ alg: "none", typ: "JWT" });
  const body = b64url(payload);
  return `${header}.${body}.signature`;
}

function validPayload(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: "user-123",
    email: "coordinator@example.com",
    email_verified: true,
    auth_time: now - 10,
    exp: now + 3600,
    iat: now - 10,
    ...overrides,
  };
}

describe("verifyFirebaseIdToken (emulator decode path)", () => {
  it("accepts a well-formed emulator token", async () => {
    const identity = await verifyFirebaseIdToken(
      fakeToken(validPayload()),
      PROJECT_ID,
      "127.0.0.1:9099"
    );
    expect(identity.email).toBe("coordinator@example.com");
    expect(identity.emailVerified).toBe(true);
  });

  it("rejects a malformed token", async () => {
    await expect(
      verifyFirebaseIdToken("not-a-jwt", PROJECT_ID, "127.0.0.1:9099")
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" } satisfies Partial<AppError>);
  });

  it("rejects a token with the wrong audience", async () => {
    await expect(
      verifyFirebaseIdToken(
        fakeToken(validPayload({ aud: "some-other-project" })),
        PROJECT_ID,
        "127.0.0.1:9099"
      )
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("rejects a token with the wrong issuer", async () => {
    await expect(
      verifyFirebaseIdToken(
        fakeToken(validPayload({ iss: "https://evil.example.com" })),
        PROJECT_ID,
        "127.0.0.1:9099"
      )
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("rejects an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(
      verifyFirebaseIdToken(fakeToken(validPayload({ exp: now - 10 })), PROJECT_ID, "127.0.0.1:9099")
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("rejects an unverified email", async () => {
    await expect(
      verifyFirebaseIdToken(
        fakeToken(validPayload({ email_verified: false })),
        PROJECT_ID,
        "127.0.0.1:9099"
      )
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("rejects a missing email", async () => {
    const payload = validPayload();
    delete (payload as Record<string, unknown>).email;
    await expect(
      verifyFirebaseIdToken(fakeToken(payload), PROJECT_ID, "127.0.0.1:9099")
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});

describe("extractBearerToken", () => {
  it("rejects a missing Authorization header", () => {
    expect(() => extractBearerToken(null)).toThrow(AppError);
  });

  it("rejects a non-Bearer scheme", () => {
    expect(() => extractBearerToken("Basic abc123")).toThrow(AppError);
  });

  it("extracts the token from a valid header", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  });
});
