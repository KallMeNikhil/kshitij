import { describe, expect, it } from "vitest";
import { checkScheduleDraft, findVenueConflict, isRealDate, isRealTime, isSchedulable, SCHEDULABLE_STATUSES } from "./schedule";

describe("schedule rules", () => {
  it("accepts real dates (incl. leap day) and rejects shape-valid impossible ones", () => {
    for (const ok of ["2026-10-12", "2028-02-29", "2026-12-31"]) expect(isRealDate(ok)).toBe(true);
    for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "26-10-12", "2026-1-5", "", "tomorrow"]) {
      expect(isRealDate(bad), bad).toBe(false);
    }
  });

  it("accepts a 24-hour clock and rejects the rest", () => {
    for (const ok of ["00:00", "09:05", "23:59"]) expect(isRealTime(ok)).toBe(true);
    for (const bad of ["24:00", "12:60", "25:99", "9:05", "12:5", "noon", ""]) expect(isRealTime(bad), bad).toBe(false);
  });

  it("only DRAFT and SCHEDULED fixtures can be scheduled", () => {
    expect([...SCHEDULABLE_STATUSES]).toEqual(["DRAFT", "SCHEDULED"]);
    for (const s of ["DRAFT", "SCHEDULED"] as const) expect(isSchedulable(s)).toBe(true);
    for (const s of ["LIVE", "COMPLETED", "POSTPONED", "CANCELLED"] as const) expect(isSchedulable(s)).toBe(false);
  });

  it("checkScheduleDraft requires date AND time, trims the venue, and surfaces a human-readable reason", () => {
    expect(checkScheduleDraft({ date: "2026-10-12", time: "16:30", venue: "  Court 1 " })).toEqual({
      ok: true,
      value: { scheduledDate: "2026-10-12", scheduledTime: "16:30", venue: "Court 1" },
    });
    expect(checkScheduleDraft({ date: "", time: "16:30", venue: "" })).toMatchObject({ ok: false, error: expect.stringMatching(/both a date and a time/) });
    expect(checkScheduleDraft({ date: "2026-10-12", time: "", venue: "" })).toMatchObject({ ok: false });
    expect(checkScheduleDraft({ date: "2026-02-30", time: "10:00", venue: "" })).toMatchObject({ ok: false, error: expect.stringMatching(/calendar date/) });
    expect(checkScheduleDraft({ date: "2026-10-12", time: "25:00", venue: "" })).toMatchObject({ ok: false, error: expect.stringMatching(/time of day/) });
    expect(checkScheduleDraft({ date: "2026-10-12", time: "10:00", venue: "x".repeat(81) })).toMatchObject({ ok: false, error: expect.stringMatching(/80/) });
    expect(checkScheduleDraft({ date: "2026-10-12", time: "10:00", venue: "" })).toMatchObject({ ok: true });
  });
});

describe("venue conflicts", () => {
  const booked = { fixtureId: "f1", scheduledDate: "2026-10-12", scheduledTime: "10:00", venue: "Court 1", status: "SCHEDULED" as const };
  const candidate = { fixtureId: "f2", scheduledDate: "2026-10-12", scheduledTime: "10:00", venue: "  court 1 " };

  it("reports the fixture that holds the same venue at the same date and time, ignoring case and spacing", () => {
    expect(findVenueConflict([booked], candidate)).toBe("f1");
  });

  it("ignores itself, other times, other venues and fixtures that no longer hold the venue", () => {
    expect(findVenueConflict([booked], { ...candidate, fixtureId: "f1" })).toBeNull();
    expect(findVenueConflict([booked], { ...candidate, scheduledTime: "11:00" })).toBeNull();
    expect(findVenueConflict([booked], { ...candidate, venue: "Court 2" })).toBeNull();
    expect(findVenueConflict([{ ...booked, status: "CANCELLED" }], candidate)).toBeNull();
  });

  it("does nothing without a venue, date or time", () => {
    expect(findVenueConflict([booked], { ...candidate, venue: "" })).toBeNull();
    expect(findVenueConflict([booked], { fixtureId: "f2", venue: "Court 1" })).toBeNull();
  });
});
