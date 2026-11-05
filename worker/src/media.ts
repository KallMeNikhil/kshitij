import { AppError, jsonResponse } from "./errors";
import {
  MEDIA_MAX_BYTES,
  MEDIA_PATH_PREFIX,
  MEDIA_VARIANTS,
  MEDIA_VARIANTS_BY_KIND,
  MEDIA_KINDS,
  buildMediaKey,
  contentTypeForKey,
  isMediaKey,
  mediaKeyFromUrl,
  sniffImageType,
  type MediaKind,
  type MediaVariant,
} from "../../shared/media";

export interface MediaStore {
  delete(key: string): Promise<void>;
}

export const UPLOAD_PATH = "/api/media/upload";
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

function isKind(value: string | null): value is MediaKind {
  return value !== null && (MEDIA_KINDS as readonly string[]).includes(value);
}

function isVariant(value: string | null): value is MediaVariant {
  return value !== null && (MEDIA_VARIANTS as readonly string[]).includes(value);
}

export function parseUploadTarget(url: URL): { kind: MediaKind; variant: MediaVariant } {
  const kind = url.searchParams.get("kind");
  const variant = url.searchParams.get("variant");
  if (!isKind(kind)) throw new AppError(400, "INVALID_MEDIA_KIND", "kind must be gallery or committee");
  if (!isVariant(variant) || !MEDIA_VARIANTS_BY_KIND[kind].includes(variant)) {
    throw new AppError(400, "INVALID_MEDIA_VARIANT", "variant is not allowed for this kind");
  }
  return { kind, variant };
}

export async function storeUpload(
  request: Request,
  url: URL,
  store: KVNamespace | undefined
): Promise<{ key: string; url: string; contentType: string; size: number }> {
  if (!store) throw new AppError(500, "MEDIA_NOT_CONFIGURED", "The MEDIA KV namespace is not bound to this Worker");
  const { kind, variant } = parseUploadTarget(url);
  const limit = MEDIA_MAX_BYTES[variant];

  const declared = Number(request.headers.get("Content-Length") ?? "");
  if (Number.isFinite(declared) && declared > limit) {
    throw new AppError(413, "IMAGE_TOO_LARGE", `Image exceeds the ${Math.floor(limit / 1024)} KB limit for this upload`);
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) throw new AppError(400, "EMPTY_BODY", "No image data received");
  if (buffer.byteLength > limit) {
    throw new AppError(413, "IMAGE_TOO_LARGE", `Image exceeds the ${Math.floor(limit / 1024)} KB limit for this upload`);
  }

  const type = sniffImageType(new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength)));
  if (!type) throw new AppError(415, "UNSUPPORTED_IMAGE_TYPE", "Only JPEG, PNG and WebP images are accepted");

  const key = buildMediaKey(kind, variant, crypto.randomUUID(), type);
  await store.put(key, buffer, { metadata: { contentType: type, size: buffer.byteLength } });

  return { key, url: `${url.origin}${MEDIA_PATH_PREFIX}${key}`, contentType: type, size: buffer.byteLength };
}

export async function serveMedia(
  request: Request,
  url: URL,
  store: KVNamespace | undefined
): Promise<Response> {
  const notFound = () => jsonResponse(404, { error: { code: "NOT_FOUND", message: "Unknown media" } });
  if (!store) return notFound();

  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice(MEDIA_PATH_PREFIX.length));
  } catch {
    return notFound();
  }
  if (!isMediaKey(key)) return notFound();

  const edge = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
  if (edge) {
    const hit = await edge.match(cacheKey);
    if (hit) return request.method === "HEAD" ? new Response(null, { status: hit.status, headers: hit.headers }) : hit;
  }

  const stored = await store.getWithMetadata<{ contentType?: string }>(key, "arrayBuffer");
  if (!stored.value) return notFound();

  const contentType = stored.metadata?.contentType ?? contentTypeForKey(key) ?? "application/octet-stream";
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": IMMUTABLE_CACHE,
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };

  if (edge) await edge.put(cacheKey, new Response(stored.value.slice(0), { status: 200, headers }));
  return new Response(request.method === "HEAD" ? null : stored.value, { status: 200, headers });
}

export async function deleteMediaUrls(store: MediaStore | undefined, urls: Array<string | undefined | null>): Promise<void> {
  const keys = new Set<string>();
  for (const url of urls) {
    if (!url) continue;
    const key = mediaKeyFromUrl(url);
    if (key) keys.add(key);
  }
  if (keys.size === 0) return;
  if (!store) throw new AppError(500, "MEDIA_NOT_CONFIGURED", "The MEDIA KV namespace is not bound to this Worker");
  await Promise.all([...keys].map((key) => store.delete(key)));
}
