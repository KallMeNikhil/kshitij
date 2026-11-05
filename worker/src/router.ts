import { AppError, errorResponse, jsonResponse } from "./errors";
import { requireAdmin, requireSuperAdmin } from "./auth/authorize";
import { resolveOperation } from "./operations/registry";
import { UPLOAD_PATH, serveMedia, storeUpload } from "./media";
import { MEDIA_PATH_PREFIX } from "../../shared/media";

export interface Env {
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGIN?: string;
  FIRESTORE_EMULATOR_HOST?: string;
  FIREBASE_AUTH_EMULATOR_HOST?: string;
  MEDIA?: KVNamespace;
}

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGIN ?? "*")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const allowed = allowedOrigins(env);
  const requestOrigin = request.headers.get("Origin");
  const origin =
    allowed.includes("*") ? "*" : requestOrigin && allowed.includes(requestOrigin) ? requestOrigin : (allowed[0] ?? "*");
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    Vary: "Origin",
  };
}

function withCors(res: Response, request: Request, env: Env): Response {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) {
    headers.set(key, value);
  }
  return new Response(res.body, { status: res.status, headers });
}

function failureResponse(err: unknown, operationName: string): Response {
  if (err instanceof AppError) {
    if (err.diagnostics) {
      console.error(
        JSON.stringify({ operation: operationName, code: err.code, status: err.status, ...err.diagnostics })
      );
    }
    return errorResponse(err);
  }

  console.error(`Unhandled error in operation "${operationName}"`, err);
  return errorResponse(err);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }), request, env);
  }

  if (url.pathname.startsWith(MEDIA_PATH_PREFIX)) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return withCors(
        jsonResponse(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET" } }), request, env);
    }
    return withCors(await serveMedia(request, url, env.MEDIA), request, env);
  }

  if (url.pathname === UPLOAD_PATH) {
    if (request.method !== "POST") {
      return withCors(
        jsonResponse(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } }), request, env);
    }
    try {
      const ctx = await requireAdmin(request, env);
      requireSuperAdmin(ctx);
      const result = await storeUpload(request, url, env.MEDIA);
      return withCors(jsonResponse(200, { result }), request, env);
    } catch (err) {
      return withCors(failureResponse(err, "mediaUpload"), request, env);
    }
  }

  if (!url.pathname.startsWith("/api/")) {
    return withCors(jsonResponse(404, { error: { code: "NOT_FOUND", message: "Unknown route" } }), request, env);
  }

  const operationName = url.pathname.slice("/api/".length);

  if (request.method !== "POST") {
    return withCors(
      jsonResponse(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } }), request, env);
  }

  const handler = resolveOperation(operationName);
  if (!handler) {
    return withCors(jsonResponse(404, { error: { code: "NOT_FOUND", message: "Unknown operation" } }), request, env);
  }

  let body: unknown;
  try {
    const raw = await request.text();
    body = raw.length > 0 ? JSON.parse(raw) : {};
  } catch {
    return withCors(
      jsonResponse(400, { error: { code: "BAD_REQUEST_BODY", message: "Malformed JSON" } }), request, env);
  }

  const input =
    body && typeof body === "object" && "data" in (body as Record<string, unknown>)
      ? (body as Record<string, unknown>).data
      : body;

  try {
    const ctx = await requireAdmin(request, env);
    const result = await handler(ctx, input);
    return withCors(jsonResponse(200, { result }), request, env);
  } catch (err) {
    return withCors(failureResponse(err, operationName), request, env);
  }
}
