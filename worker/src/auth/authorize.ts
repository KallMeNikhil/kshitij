import { AppError } from "../errors";
import { FirestoreRestClient } from "../firestore/client";
import { extractBearerToken, verifyFirebaseIdToken } from "./verifyIdToken";
import type { Env } from "../router";
import type { MediaStore } from "../media";
import type { AdminDoc } from "../../../shared/types";

export interface AuthContext {
  email: string;
  admin: AdminDoc;
  db: FirestoreRestClient;
  media?: MediaStore;
}

export async function requireAdmin(request: Request, env: Env): Promise<AuthContext> {
  const idToken = extractBearerToken(request.headers.get("Authorization"));
  const identity = await verifyFirebaseIdToken(
    idToken,
    env.FIREBASE_PROJECT_ID,
    env.FIREBASE_AUTH_EMULATOR_HOST
  );
  const email = identity.email.toLowerCase();
  const db = new FirestoreRestClient(env.FIREBASE_PROJECT_ID, idToken, env.FIRESTORE_EMULATOR_HOST);

  const admin = await db.getDocument<AdminDoc>("admins", email);
  if (!admin) {
    throw new AppError(403, "NOT_AN_ADMIN", "No admin record for this account");
  }
  if (!admin.active) {
    throw new AppError(403, "ADMIN_INACTIVE", "Admin account is inactive");
  }

  return { email, admin, db, media: env.MEDIA };
}

export function requireSuperAdmin(ctx: AuthContext): void {
  if (ctx.admin.role !== "SUPER_ADMIN") {
    throw new AppError(403, "SUPER_ADMIN_REQUIRED", "Super Admin role required");
  }
}

export function requireSportAccess(ctx: AuthContext, sportId: string): void {
  if (ctx.admin.role === "SUPER_ADMIN") return;
  if (!ctx.admin.sportIds?.includes(sportId)) {
    throw new AppError(403, "SPORT_NOT_ASSIGNED", "Not assigned to this sport");
  }
}
