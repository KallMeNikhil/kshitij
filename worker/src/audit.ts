import type { WriteOp } from "./firestore/client";

export interface AuditEntry {
  action: string;
  actorEmail: string;
  actorRole?: string;
  targetType: string;
  targetId: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
}

export function auditWrite(entry: AuditEntry): WriteOp {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    collection: "auditLogs",
    id,
    data: { ...entry, createdAt: new Date().toISOString() },
  };
}
