import type { FixtureDoc } from "../../shared/types";

export interface DayGroup {
  key: string;
  date: string | null;
  fixtures: FixtureDoc[];
}

const byTime = (a: FixtureDoc, b: FixtureDoc) =>
  (a.scheduledTime ?? "99:99").localeCompare(b.scheduledTime ?? "99:99") ||
  a.round - b.round ||
  a.matchNumber - b.matchNumber;

export function groupFixtures(fixtures: FixtureDoc[]) {
  const live = fixtures.filter((f) => f.status === "LIVE").sort(byTime);
  const completed = fixtures
    .filter((f) => f.status === "COMPLETED")
    .sort((a, b) => b.round - a.round || b.matchNumber - a.matchNumber);
  const pending = fixtures.filter(
    (f) => f.status === "SCHEDULED" || f.status === "DRAFT" || f.status === "POSTPONED" || f.status === "CANCELLED"
  );

  const days = new Map<string, FixtureDoc[]>();
  for (const f of pending) {
    const key = f.scheduledDate ?? "unscheduled";
    days.set(key, [...(days.get(key) ?? []), f]);
  }
  const upNext: DayGroup[] = [...days.entries()]
    .sort(([a], [b]) => (a === "unscheduled" ? 1 : b === "unscheduled" ? -1 : a.localeCompare(b)))
    .map(([key, rows]) => ({
      key,
      date: key === "unscheduled" ? null : key,
      fixtures: rows.slice().sort(byTime),
    }));

  return { live, upNext, completed, upNextCount: pending.length };
}

export function countRounds(fixtures: FixtureDoc[] | null): number {
  return fixtures ? new Set(fixtures.map((f) => f.round)).size : 0;
}
