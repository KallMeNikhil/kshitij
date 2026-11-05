import type { FixtureDoc, FixtureStatus } from "./types";

export type LifecycleAction = "postpone" | "resume" | "cancel";

export const LEGAL_STATUS_TRANSITIONS: Readonly<Record<FixtureStatus, readonly FixtureStatus[]>> = {
  DRAFT: ["SCHEDULED", "COMPLETED"],
  SCHEDULED: ["LIVE", "COMPLETED", "POSTPONED", "CANCELLED"],
  LIVE: ["COMPLETED", "POSTPONED", "CANCELLED"],
  POSTPONED: ["SCHEDULED", "LIVE", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export const REASON_MAX_LENGTH = 300;

export function isLegalStatusTransition(from: FixtureStatus, to: FixtureStatus): boolean {
  return from === to || LEGAL_STATUS_TRANSITIONS[from].includes(to);
}

export type LifecycleResolution =
  | { ok: true; to: FixtureStatus; resumeStatus?: "SCHEDULED" | "LIVE" }
  | { ok: false; code: "INVALID_FIXTURE_TRANSITION"; message: string };

const SOURCES: Record<LifecycleAction, readonly FixtureStatus[]> = {
  postpone: ["SCHEDULED", "LIVE"],
  resume: ["POSTPONED"],
  cancel: ["SCHEDULED", "LIVE", "POSTPONED"],
};

export function resolveLifecycle(action: LifecycleAction, fixture: Pick<FixtureDoc, "status" | "resumeStatus">): LifecycleResolution {
  if (!SOURCES[action].includes(fixture.status)) {
    return {
      ok: false,
      code: "INVALID_FIXTURE_TRANSITION",
      message: `A ${fixture.status} fixture cannot be ${action === "cancel" ? "cancelled" : action === "postpone" ? "postponed" : "resumed"}`,
    };
  }
  if (action === "postpone") return { ok: true, to: "POSTPONED", resumeStatus: fixture.status as "SCHEDULED" | "LIVE" };
  if (action === "cancel") return { ok: true, to: "CANCELLED" };
  const target = fixture.resumeStatus === "LIVE" ? "LIVE" : "SCHEDULED";
  return { ok: true, to: target };
}

export function availableLifecycleActions(fixture: Pick<FixtureDoc, "status" | "resumeStatus" | "slotA" | "slotB">): LifecycleAction[] {
  if (fixture.slotA.kind === "BYE" || fixture.slotB.kind === "BYE") return [];
  return (["postpone", "resume", "cancel"] as const).filter((a) => resolveLifecycle(a, fixture).ok);
}

export const LIFECYCLE_COPY: Record<LifecycleAction, { verb: string; past: string }> = {
  postpone: { verb: "Postpone", past: "postponed" },
  resume: { verb: "Resume", past: "resumed" },
  cancel: { verb: "Cancel match", past: "cancelled" },
};
