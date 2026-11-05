import { createRemoteJWKSet, jwtVerify, decodeJwt, JWTPayload } from "jose";
import { AppError } from "../errors";

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!cachedJwks) {
    cachedJwks = createRemoteJWKSet(new URL(JWKS_URL));
  }
  return cachedJwks;
}

export interface VerifiedIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
  payload: JWTPayload;
}

function assertClaims(payload: JWTPayload): VerifiedIdentity {
  const now = Math.floor(Date.now() / 1000);
  const authTime = typeof payload.auth_time === "number" ? payload.auth_time : null;
  if (authTime !== null && authTime > now) {
    throw new AppError(401, "AUTH_REQUIRED", "Invalid token auth_time");
  }
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new AppError(401, "AUTH_REQUIRED", "Missing subject claim");
  }
  const email = typeof payload.email === "string" ? payload.email : "";
  const emailVerified = payload.email_verified === true;
  if (!email || !emailVerified) {
    throw new AppError(401, "AUTH_REQUIRED", "Email not present or not verified");
  }
  return { uid: payload.sub, email, emailVerified, payload };
}

export async function verifyFirebaseIdToken(
  idToken: string,
  projectId: string,
  authEmulatorHost?: string
): Promise<VerifiedIdentity> {
  if (authEmulatorHost) {
    if (!projectId.startsWith("demo-")) {
      throw new AppError(500, "INTERNAL", "The auth emulator can only be used with a demo- project");
    }
    let payload: JWTPayload;
    try {
      payload = decodeJwt(idToken);
    } catch {
      throw new AppError(401, "AUTH_REQUIRED", "Invalid token");
    }
    if (payload.aud !== projectId) {
      throw new AppError(401, "AUTH_REQUIRED", "Invalid token audience");
    }
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
      throw new AppError(401, "AUTH_REQUIRED", "Invalid token issuer");
    }
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new AppError(401, "AUTH_REQUIRED", "Token expired");
    }
    return assertClaims(payload);
  }

  let result;
  try {
    result = await jwtVerify(idToken, getJwks(), {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
    });
  } catch {
    throw new AppError(401, "AUTH_REQUIRED", "Invalid or expired token");
  }
  return assertClaims(result.payload);
}

export function extractBearerToken(authHeader: string | null): string {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing bearer token");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing bearer token");
  }
  return token;
}
