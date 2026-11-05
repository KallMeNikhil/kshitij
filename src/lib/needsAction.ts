import type { FixtureDoc } from "../../shared/types";

export type NeedsActionKind = "UNSCHEDULED" | "OVERDUE" | "BLOCKED";

export interface NeedsActionItem {
  kind: NeedsActionKind;
  fixture: FixtureDoc;
}

const isEntrant = (kind: string) => kind === "PARTICIPANT" || kind === "TEAM";

export function scheduledAt(f: Pick<FixtureDoc, "scheduledDate" | "scheduledTime">): Date | null {
  if (!f.scheduledDate || !f.scheduledTime) return null;
  const d = new Date(`${f.scheduledDate}T${f.scheduledTime}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function needsAction(fixtures: readonly FixtureDoc[], now: Date = new Date()): NeedsActionItem[] {
  const cancelledFeeders = new Set<string>();
  for (const f of fixtures) {
    if (f.status === "CANCELLED" && f.nextFixtureId) cancelledFeeders.add(f.nextFixtureId);
  }

  const items: NeedsActionItem[] = [];
  for (const fixture of fixtures) {
    if (cancelledFeeders.has(fixture.fixtureId) && (fixture.status === "SCHEDULED" || fixture.status === "POSTPONED" || fixture.status === "DRAFT")) {
      items.push({ kind: "BLOCKED", fixture });
    } else if (fixture.status === "SCHEDULED") {
      const bothReady = isEntrant(fixture.slotA.kind) && isEntrant(fixture.slotB.kind);
      if (!bothReady) continue;
      const at = scheduledAt(fixture);
      if (!at) items.push({ kind: "UNSCHEDULED", fixture });
      else if (at.getTime() < now.getTime()) items.push({ kind: "OVERDUE", fixture });
    }
  }
  const rank: Record<NeedsActionKind, number> = { OVERDUE: 0, BLOCKED: 1, UNSCHEDULED: 2 };
  return items.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || a.fixture.round - b.fixture.round || a.fixture.matchNumber - b.fixture.matchNumber
  );
}

export function suspendedFixtures(fixtures: readonly FixtureDoc[]): FixtureDoc[] {
  return fixtures
    .filter((f) => f.status === "POSTPONED" || f.status === "CANCELLED")
    .sort((a, b) => (a.status === b.status ? a.round - b.round || a.matchNumber - b.matchNumber : a.status === "POSTPONED" ? -1 : 1));
}

export const NEEDS_ACTION_LABEL: Record<NeedsActionKind, string> = {
  OVERDUE: "Start time has passed",
  UNSCHEDULED: "Both entrants set, no schedule",
  BLOCKED: "Waiting on a cancelled match, can't progress",
};

export function downstreamStarted(fixtures: readonly FixtureDoc[], fromFixtureId: string): boolean {
  const byId = new Map(fixtures.map((f) => [f.fixtureId, f]));
  let cursor = byId.get(fromFixtureId);
  const seen = new Set<string>();
  while (cursor?.nextFixtureId && !seen.has(cursor.nextFixtureId)) {
    seen.add(cursor.nextFixtureId);
    const next = byId.get(cursor.nextFixtureId);
    if (!next) return false;
    const scaffolding = next.status === "COMPLETED" && (next.slotA.kind === "BYE" || next.slotB.kind === "BYE");
    if (next.status === "LIVE" || (next.status === "COMPLETED" && !scaffolding)) return true;
    cursor = next;
  }
  return false;
}
