import type { FixtureDoc, FixtureStatus } from "./types";

export const SCHEDULABLE_STATUSES = ["DRAFT", "SCHEDULED"] as const satisfies readonly FixtureStatus[];

export function isSchedulable(status: FixtureStatus): boolean {
  return (SCHEDULABLE_STATUSES as readonly string[]).includes(status);
}

export const VENUE_MAX_LENGTH = 80;

export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isRealTime(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value) && Number(value.slice(0, 2)) < 24 && Number(value.slice(3)) < 60;
}

export interface ScheduleDraft {
  date: string;
  time: string;
  venue: string;
}

export type ScheduleCheck =
  | { ok: true; value: { scheduledDate: string; scheduledTime: string; venue: string } }
  | { ok: false; error: string };

export function checkScheduleDraft(draft: ScheduleDraft): ScheduleCheck {
  const date = draft.date.trim();
  const time = draft.time.trim();
  const venue = draft.venue.trim();
  if (!date || !time) return { ok: false, error: "Choose both a date and a time." };
  if (!isRealDate(date)) return { ok: false, error: "That is not a real calendar date." };
  if (!isRealTime(time)) return { ok: false, error: "That is not a valid time of day." };
  if (venue.length > VENUE_MAX_LENGTH) return { ok: false, error: `Venue must be at most ${VENUE_MAX_LENGTH} characters.` };
  return { ok: true, value: { scheduledDate: date, scheduledTime: time, venue } };
}

const VENUE_FREE_STATUSES: readonly FixtureStatus[] = ["COMPLETED", "CANCELLED", "POSTPONED"];

export function normalizeVenue(venue: string | undefined): string {
  return (venue ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function findVenueConflict(
  fixtures: Array<Pick<FixtureDoc, "fixtureId" | "scheduledDate" | "scheduledTime" | "venue" | "status">>,
  candidate: { fixtureId: string; scheduledDate?: string; scheduledTime?: string; venue?: string }
): string | null {
  const venue = normalizeVenue(candidate.venue);
  if (!venue || !candidate.scheduledDate || !candidate.scheduledTime) return null;
  const clash = fixtures.find(
    (f) =>
      f.fixtureId !== candidate.fixtureId &&
      f.scheduledDate === candidate.scheduledDate &&
      f.scheduledTime === candidate.scheduledTime &&
      normalizeVenue(f.venue) === venue &&
      !VENUE_FREE_STATUSES.includes(f.status)
  );
  return clash ? clash.fixtureId : null;
}
