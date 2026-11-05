import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleRequest, Env } from "../src/router";
import { deleteMediaUrls, storeUpload } from "../src/media";
import { sniffImageType } from "../../shared/media";

const PROJECT_ID = "demo-kshitij";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);

function fakeKv() {
  const store = new Map<string, { value: ArrayBuffer; metadata: unknown }>();
  const kv = {
    put: vi.fn(async (key: string, value: ArrayBuffer, options?: { metadata?: unknown }) => {
      store.set(key, { value, metadata: options?.metadata ?? null });
    }),
    getWithMetadata: vi.fn(async (key: string) => {
      const hit = store.get(key);
      return { value: hit ? hit.value : null, metadata: hit ? hit.metadata : null };
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
  return { store, kv, binding: kv as unknown as KVNamespace };
}

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fakeToken(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "none", typ: "JWT" });
  const body = b64url({
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: "user-1",
    email,
    email_verified: true,
    auth_time: now - 10,
    exp: now + 3600,
    iat: now - 10,
  });
  return `${header}.${body}.signature`;
}

function adminResponse(role: "SUPER_ADMIN" | "SPORT_COORDINATOR") {
  return new Response(
    JSON.stringify({
      fields: {
        email: { stringValue: "x@example.com" },
        role: { stringValue: role },
        active: { booleanValue: true },
        sportIds: { arrayValue: { values: [] } },
      },
    }),
    { status: 200 }
  );
}

function env(binding?: KVNamespace): Env {
  return {
    FIREBASE_PROJECT_ID: PROJECT_ID,
    ALLOWED_ORIGIN: "http://127.0.0.1:5173",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    MEDIA: binding,
  };
}

function upload(query: string, body: Uint8Array | null, token: string | null = fakeToken("root@example.com")) {
  return new Request(`https://worker.example/api/media/upload?${query}`, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "image/webp" },
    body: body as BodyInit | null,
  });
}

describe("sniffImageType", () => {
  it("recognises JPEG, PNG and WebP by magic bytes and nothing else", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(WEBP)).toBe("image/webp");
    expect(sniffImageType(GIF)).toBeNull();
    expect(sniffImageType(new Uint8Array([1, 2]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBeNull();
  });
});

describe("storeUpload", () => {
  const url = (query: string) => new URL(`https://worker.example/api/media/upload?${query}`);
  const req = (body: Uint8Array, headers: Record<string, string> = {}) =>
    new Request("https://worker.example/api/media/upload", { method: "POST", body: body as BodyInit, headers });

  it("stores the bytes under a unique key and returns the public url", async () => {
    const { kv, binding } = fakeKv();
    const first = await storeUpload(req(WEBP), url("kind=gallery&variant=full"), binding);
    const second = await storeUpload(req(WEBP), url("kind=gallery&variant=full"), binding);
    expect(first.key).toMatch(/^gallery\/[0-9a-f-]{36}-full\.webp$/);
    expect(first.key).not.toBe(second.key);
    expect(first.url).toBe(`https://worker.example/media/${first.key}`);
    expect(first.contentType).toBe("image/webp");
    expect(kv.put).toHaveBeenCalledTimes(2);
  });

  it("derives the type from the bytes, not from the declared content type", async () => {
    const { binding } = fakeKv();
    const result = await storeUpload(req(PNG, { "Content-Type": "image/webp" }), url("kind=committee&variant=photo"), binding);
    expect(result.contentType).toBe("image/png");
    expect(result.key.endsWith(".png")).toBe(true);
  });

  it("rejects unsupported bytes, empty bodies and bad targets", async () => {
    const { kv, binding } = fakeKv();
    await expect(storeUpload(req(GIF), url("kind=gallery&variant=full"), binding)).rejects.toMatchObject({ status: 415, code: "UNSUPPORTED_IMAGE_TYPE" });
    await expect(storeUpload(req(new Uint8Array()), url("kind=gallery&variant=full"), binding)).rejects.toMatchObject({ code: "EMPTY_BODY" });
    await expect(storeUpload(req(WEBP), url("kind=other&variant=full"), binding)).rejects.toMatchObject({ code: "INVALID_MEDIA_KIND" });
    await expect(storeUpload(req(WEBP), url("kind=gallery&variant=photo"), binding)).rejects.toMatchObject({ code: "INVALID_MEDIA_VARIANT" });
    await expect(storeUpload(req(WEBP), url("kind=committee&variant=thumb"), binding)).rejects.toMatchObject({ code: "INVALID_MEDIA_VARIANT" });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("enforces the per-variant size limit from the header and from the body", async () => {
    const { kv, binding } = fakeKv();
    await expect(
      storeUpload(req(WEBP, { "Content-Length": String(600 * 1024) }), url("kind=gallery&variant=thumb"), binding)
    ).rejects.toMatchObject({ status: 413, code: "IMAGE_TOO_LARGE" });
    const big = new Uint8Array(600 * 1024);
    big.set(WEBP);
    await expect(storeUpload(req(big), url("kind=gallery&variant=thumb"), binding)).rejects.toMatchObject({ status: 413 });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("fails clearly when the namespace is not bound", async () => {
    await expect(storeUpload(req(WEBP), url("kind=gallery&variant=full"), undefined)).rejects.toMatchObject({ code: "MEDIA_NOT_CONFIGURED" });
  });
});

describe("deleteMediaUrls", () => {
  it("deletes each distinct media key once and ignores foreign urls", async () => {
    const store = { delete: vi.fn().mockResolvedValue(undefined) };
    const key = "gallery/00000000-0000-4000-8000-000000000001-full.webp";
    await deleteMediaUrls(store, [`https://a.example/media/${key}`, `https://b.example/media/${key}`, "https://a.example/other.png", undefined, null]);
    expect(store.delete).toHaveBeenCalledTimes(1);
    expect(store.delete).toHaveBeenCalledWith(key);
  });

  it("does nothing when there is nothing to delete, even without a store", async () => {
    await expect(deleteMediaUrls(undefined, [undefined, "https://a.example/x.png"])).resolves.toBeUndefined();
  });
});

describe("media routes", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves stored bytes publicly with the right type and a one-day cache", async () => {
    const { store, binding } = fakeKv();
    const key = "gallery/00000000-0000-4000-8000-000000000001-full.webp";
    store.set(key, { value: WEBP.buffer.slice(0) as ArrayBuffer, metadata: { contentType: "image/webp" } });
    const res = await handleRequest(new Request(`https://worker.example/media/${key}`), env(binding));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(WEBP);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown keys, malformed keys and a missing binding", async () => {
    const { binding } = fakeKv();
    const missing = "gallery/00000000-0000-4000-8000-000000000009-full.webp";
    expect((await handleRequest(new Request(`https://worker.example/media/${missing}`), env(binding))).status).toBe(404);
    expect((await handleRequest(new Request("https://worker.example/media/../secret"), env(binding))).status).toBe(404);
    expect((await handleRequest(new Request("https://worker.example/media/gallery/not-a-key.webp"), env(binding))).status).toBe(404);
    expect((await handleRequest(new Request(`https://worker.example/media/${missing}`), env())).status).toBe(404);
  });

  it("rejects writes to the media path", async () => {
    const res = await handleRequest(new Request("https://worker.example/media/x", { method: "POST" }), env());
    expect(res.status).toBe(405);
  });

  it("requires authentication to upload", async () => {
    const { kv, binding } = fakeKv();
    const res = await handleRequest(upload("kind=gallery&variant=full", WEBP, null), env(binding));
    expect(res.status).toBe(401);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("refuses uploads from a coordinator", async () => {
    const { kv, binding } = fakeKv();
    mockFetch.mockResolvedValueOnce(adminResponse("SPORT_COORDINATOR"));
    const res = await handleRequest(upload("kind=gallery&variant=full", WEBP), env(binding));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SUPER_ADMIN_REQUIRED");
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("accepts an upload from the Super Admin and returns the public url", async () => {
    const { kv, binding } = fakeKv();
    mockFetch.mockResolvedValueOnce(adminResponse("SUPER_ADMIN"));
    const res = await handleRequest(upload("kind=gallery&variant=thumb", WEBP), env(binding));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { key: string; url: string; contentType: string } };
    expect(body.result.url).toBe(`https://worker.example/media/${body.result.key}`);
    expect(body.result.contentType).toBe("image/webp");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:5173");
    expect(kv.put).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-image body from the Super Admin", async () => {
    const { kv, binding } = fakeKv();
    mockFetch.mockResolvedValueOnce(adminResponse("SUPER_ADMIN"));
    const res = await handleRequest(upload("kind=gallery&variant=full", GIF), env(binding));
    expect(res.status).toBe(415);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("only allows POST on the upload route", async () => {
    const res = await handleRequest(new Request("https://worker.example/api/media/upload"), env());
    expect(res.status).toBe(405);
  });
});
