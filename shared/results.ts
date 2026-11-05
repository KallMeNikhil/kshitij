export const RESULT_TYPES = ["WALKOVER", "RETIRED", "DISQUALIFIED", "ABANDONED", "ADMIN_DECISION"] as const;
export type ResultType = (typeof RESULT_TYPES)[number];

export const LEGACY_RESULT_TYPES = ["ADMIN_OVERRIDE"] as const;

export const COORDINATOR_RESULT_TYPES: readonly ResultType[] = ["WALKOVER", "RETIRED"];

const RESULT_TYPES_BEFORE_START: readonly ResultType[] = ["WALKOVER", "DISQUALIFIED", "ADMIN_DECISION"];

export const RESULT_SOURCE_STATUSES = ["SCHEDULED", "LIVE", "POSTPONED"] as const;

export function resultTypeAllowedFrom(type: ResultType, status: string, resumeStatus?: string): boolean {
  if (status === "LIVE") return true;
  if (status === "POSTPONED" && resumeStatus === "LIVE") return true;
  if (status === "SCHEDULED" || status === "POSTPONED") return RESULT_TYPES_BEFORE_START.includes(type);
  return false;
}

export const RESULT_TYPE_LABELS: Record<ResultType | (typeof LEGACY_RESULT_TYPES)[number], string> = {
  WALKOVER: "Walkover",
  RETIRED: "Opponent retired",
  DISQUALIFIED: "Opponent disqualified",
  ABANDONED: "Abandoned, decided by organisers",
  ADMIN_DECISION: "Decided by organisers",
  ADMIN_OVERRIDE: "Decided by organisers",
};

export const RESULT_TYPE_NAMES: Record<ResultType, string> = {
  WALKOVER: "Walkover (no-show)",
  RETIRED: "Retired (injury)",
  DISQUALIFIED: "Disqualified",
  ABANDONED: "Abandoned",
  ADMIN_DECISION: "Organisers' decision",
};

export function isResultType(value: string): value is ResultType {
  return (RESULT_TYPES as readonly string[]).includes(value);
}

export function isEarlyEnd(decidedBy: string | undefined): boolean {
  return !!decidedBy && (isResultType(decidedBy) || (LEGACY_RESULT_TYPES as readonly string[]).includes(decidedBy));
}

export function resultLabel(decidedBy: string | undefined): string | null {
  if (!decidedBy) return null;
  return (RESULT_TYPE_LABELS as Record<string, string>)[decidedBy] ?? null;
}

export function coordinatorMayRecord(type: string): boolean {
  return (COORDINATOR_RESULT_TYPES as readonly string[]).includes(type);
}
