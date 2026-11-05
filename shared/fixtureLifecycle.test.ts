import { describe, expect, it } from "vitest";
import { LEGAL_STATUS_TRANSITIONS, availableLifecycleActions, isLegalStatusTransition, resolveLifecycle } from "./fixtureLifecycle";
import type { FixtureStatus, Slot } from "./types";

const STATUSES: FixtureStatus[] = ["DRAFT", "SCHEDULED", "LIVE", "COMPLETED", "POSTPONED", "CANCELLED"];
const slot = (kind: Slot["kind"]): Slot => ({ kind });

describe("legal status transitions", () => {
  it("never leaves COMPLETED or CANCELLED", () => {
    for (const to of STATUSES) {
      if (to !== "COMPLETED") expect(isLegalStatusTransition("COMPLETED", to)).toBe(false);
      if (to !== "CANCELLED") expect(isLegalStatusTransition("CANCELLED", to)).toBe(false);
    }
  });

  it("rules out the nonsensical moves", () => {
    expect(isLegalStatusTransition("COMPLETED", "POSTPONED")).toBe(false);
    expect(isLegalStatusTransition("COMPLETED", "SCHEDULED")).toBe(false);
    expect(isLegalStatusTransition("CANCELLED", "LIVE")).toBe(false);
    expect(isLegalStatusTransition("DRAFT", "POSTPONED")).toBe(false);
    expect(isLegalStatusTransition("POSTPONED", "COMPLETED")).toBe(false);
    expect(isLegalStatusTransition("LIVE", "SCHEDULED")).toBe(false);
  });

  it("allows the lifecycle moves", () => {
    expect(isLegalStatusTransition("SCHEDULED", "POSTPONED")).toBe(true);
    expect(isLegalStatusTransition("LIVE", "POSTPONED")).toBe(true);
    expect(isLegalStatusTransition("POSTPONED", "SCHEDULED")).toBe(true);
    expect(isLegalStatusTransition("POSTPONED", "LIVE")).toBe(true);
    expect(isLegalStatusTransition("POSTPONED", "CANCELLED")).toBe(true);
    expect(LEGAL_STATUS_TRANSITIONS.SCHEDULED).toContain("CANCELLED");
  });
});

describe("resolveLifecycle", () => {
  it("resumes to the status a fixture was postponed from", () => {
    expect(resolveLifecycle("resume", { status: "POSTPONED", resumeStatus: "LIVE" })).toEqual({ ok: true, to: "LIVE" });
    expect(resolveLifecycle("resume", { status: "POSTPONED", resumeStatus: "SCHEDULED" })).toEqual({ ok: true, to: "SCHEDULED" });
    expect(resolveLifecycle("resume", { status: "POSTPONED" })).toEqual({ ok: true, to: "SCHEDULED" });
  });

  it("records where a postponement came from", () => {
    expect(resolveLifecycle("postpone", { status: "LIVE" })).toEqual({ ok: true, to: "POSTPONED", resumeStatus: "LIVE" });
    expect(resolveLifecycle("postpone", { status: "SCHEDULED" })).toEqual({ ok: true, to: "POSTPONED", resumeStatus: "SCHEDULED" });
  });

  it("only offers actions that resolve, and nothing on a BYE", () => {
    const f = { slotA: slot("PARTICIPANT"), slotB: slot("PARTICIPANT") };
    expect(availableLifecycleActions({ ...f, status: "SCHEDULED" })).toEqual(["postpone", "cancel"]);
    expect(availableLifecycleActions({ ...f, status: "LIVE" })).toEqual(["postpone", "cancel"]);
    expect(availableLifecycleActions({ ...f, status: "POSTPONED" })).toEqual(["resume", "cancel"]);
    expect(availableLifecycleActions({ ...f, status: "COMPLETED" })).toEqual([]);
    expect(availableLifecycleActions({ ...f, status: "CANCELLED" })).toEqual([]);
    expect(availableLifecycleActions({ ...f, status: "DRAFT" })).toEqual([]);
    expect(availableLifecycleActions({ slotA: slot("PARTICIPANT"), slotB: slot("BYE"), status: "SCHEDULED" })).toEqual([]);
  });
});
