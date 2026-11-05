import { describe, expect, it } from "vitest";
import { postponeFixture, resumeFixture, cancelFixture } from "../src/operations/lifecycle";
import { resolveOperation } from "../src/operations/registry";
import { AppError } from "../src/errors";
import { ctxFor, dbWith, fixture } from "./helpers";
import type { FixtureDoc } from "../../shared/types";

const ID = "basketball-mens-r1-m01";

function setup(over: Partial<FixtureDoc> = {}, role: "SUPER_ADMIN" | "SPORT_COORDINATOR" = "SUPER_ADMIN", sportIds: string[] = []) {
  const db = dbWith({ fixtures: [fixture({ fixtureId: ID, ...over })] });
  return { db, ctx: ctxFor(db, role, sportIds) };
}

function committed(db: ReturnType<typeof dbWith>) {
  const call = (db.commit as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
  return call[1] as { collection: string; id: string; data: Record<string, unknown>; mergeFields?: string[] }[];
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return "OK";
}

describe("lifecycle operations are registered", () => {
  it("resolves all three", () => {
    for (const name of ["postponeFixture", "resumeFixture", "cancelFixture"]) expect(resolveOperation(name)).toBeTypeOf("function");
  });
});

describe("postponeFixture", () => {
  it("postpones a SCHEDULED fixture, records reason and resume status, and audits it", async () => {
    const { db, ctx } = setup({ status: "SCHEDULED" });
    await postponeFixture(ctx, { fixtureId: ID, reason: "  rain  " });
    const [write, audit] = committed(db);
    expect(write).toMatchObject({ collection: "fixtures", id: ID, data: { status: "POSTPONED", statusReason: "rain", resumeStatus: "SCHEDULED" } });
    expect(write.mergeFields).toEqual(["status", "statusReason", "resumeStatus"]);
    expect(audit.collection).toBe("auditLogs");
    expect(audit.data).toMatchObject({
      action: "postponeFixture",
      actorEmail: "root@example.com",
      actorRole: "SUPER_ADMIN",
      targetType: "fixture",
      targetId: ID,
      reason: "rain",
      before: { status: "SCHEDULED" },
      after: { status: "POSTPONED", resumeStatus: "SCHEDULED", statusReason: "rain" },
    });
    expect(typeof audit.data.createdAt).toBe("string");
  });

  it("remembers that a LIVE match was suspended", async () => {
    const { db, ctx } = setup({ status: "LIVE" });
    await postponeFixture(ctx, { fixtureId: ID, reason: "lightning" });
    expect(committed(db)[0].data).toMatchObject({ status: "POSTPONED", resumeStatus: "LIVE" });
  });

  it.each(["DRAFT", "COMPLETED", "CANCELLED", "POSTPONED"] as const)("refuses to postpone a %s fixture", async (status) => {
    const { db, ctx } = setup({ status });
    expect(await code(postponeFixture(ctx, { fixtureId: ID, reason: "x" }))).toBe("INVALID_FIXTURE_TRANSITION");
    expect(db.commit).not.toHaveBeenCalled();
    expect(db.rollback).toHaveBeenCalled();
  });

  it("requires a reason and a valid fixture id", async () => {
    const { db, ctx } = setup();
    expect(await code(postponeFixture(ctx, { fixtureId: ID }))).not.toBe("OK");
    expect(await code(postponeFixture(ctx, { fixtureId: ID, reason: "   " }))).not.toBe("OK");
    expect(await code(postponeFixture(ctx, { fixtureId: ID, reason: "x".repeat(301) }))).not.toBe("OK");
    expect(await code(postponeFixture(ctx, { fixtureId: "bad id!", reason: "x" }))).not.toBe("OK");
    expect(await code(postponeFixture(ctx, null))).not.toBe("OK");
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing fixture and refuses BYE fixtures", async () => {
    const missing = ctxFor(dbWith({ fixtures: [] }));
    expect(await code(postponeFixture(missing, { fixtureId: ID, reason: "x" }))).toBe("FIXTURE_NOT_FOUND");
    const { ctx } = setup({ slotB: { kind: "BYE" } });
    expect(await code(postponeFixture(ctx, { fixtureId: ID, reason: "x" }))).toBe("CANNOT_CHANGE_BYE_FIXTURE");
  });
});

describe("cancelFixture", () => {
  it.each(["SCHEDULED", "LIVE", "POSTPONED"] as const)("cancels a %s fixture and clears the resume status", async (status) => {
    const { db, ctx } = setup({ status, resumeStatus: status === "POSTPONED" ? "LIVE" : undefined, statusReason: status === "POSTPONED" ? "rain" : undefined });
    await cancelFixture(ctx, { fixtureId: ID, reason: "ground flooded" });
    const [write, audit] = committed(db);
    expect(write.data).toMatchObject({ status: "CANCELLED", statusReason: "ground flooded" });
    expect(write.data.resumeStatus).toBeUndefined();
    expect(write.mergeFields).toContain("resumeStatus");
    expect(audit.data).toMatchObject({ action: "cancelFixture", reason: "ground flooded", before: { status } });
  });

  it.each(["DRAFT", "COMPLETED", "CANCELLED"] as const)("refuses to cancel a %s fixture", async (status) => {
    const { db, ctx } = setup({ status });
    expect(await code(cancelFixture(ctx, { fixtureId: ID, reason: "x" }))).toBe("INVALID_FIXTURE_TRANSITION");
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    const { ctx } = setup();
    expect(await code(cancelFixture(ctx, { fixtureId: ID, reason: "" }))).not.toBe("OK");
  });
});

describe("resumeFixture", () => {
  it("returns a postponed SCHEDULED fixture to SCHEDULED and clears the lifecycle fields", async () => {
    const { db, ctx } = setup({ status: "POSTPONED", resumeStatus: "SCHEDULED", statusReason: "rain", scheduledDate: "2026-10-04", scheduledTime: "10:00" });
    await resumeFixture(ctx, { fixtureId: ID });
    const [write, audit] = committed(db);
    expect(write.data).toEqual({ status: "SCHEDULED" });
    expect(write.mergeFields).toEqual(["status", "statusReason", "resumeStatus"]);
    expect(audit.data).toMatchObject({ action: "resumeFixture", reason: "rain", before: { status: "POSTPONED", resumeStatus: "SCHEDULED" } });
  });

  it("returns a suspended LIVE match to LIVE, never to SCHEDULED", async () => {
    const { db, ctx } = setup({ status: "POSTPONED", resumeStatus: "LIVE", statusReason: "lightning" });
    await resumeFixture(ctx, { fixtureId: ID });
    expect(committed(db)[0].data).toEqual({ status: "LIVE" });
  });

  it("applies a new schedule when resuming to SCHEDULED", async () => {
    const { db, ctx } = setup({ status: "POSTPONED", resumeStatus: "SCHEDULED" });
    await resumeFixture(ctx, { fixtureId: ID, scheduledDate: "2026-10-06", scheduledTime: "15:30", venue: "Court 2" });
    const [write] = committed(db);
    expect(write.data).toEqual({ status: "SCHEDULED", scheduledDate: "2026-10-06", scheduledTime: "15:30", venue: "Court 2" });
    expect(write.mergeFields).toEqual(["status", "statusReason", "resumeStatus", "scheduledDate", "scheduledTime", "venue"]);
  });

  it("rejects half a schedule, a bad date, and rescheduling a suspended live match", async () => {
    const sched = setup({ status: "POSTPONED", resumeStatus: "SCHEDULED" });
    expect(await code(resumeFixture(sched.ctx, { fixtureId: ID, scheduledDate: "2026-10-06" }))).toBe("SCHEDULE_DATE_AND_TIME_MUST_BE_TOGETHER");
    expect(await code(resumeFixture(sched.ctx, { fixtureId: ID, scheduledDate: "2026-02-30", scheduledTime: "10:00" }))).not.toBe("OK");
    expect(await code(resumeFixture(sched.ctx, { fixtureId: ID, scheduledDate: "2026-10-06", scheduledTime: "25:00" }))).not.toBe("OK");
    const live = setup({ status: "POSTPONED", resumeStatus: "LIVE" });
    expect(await code(resumeFixture(live.ctx, { fixtureId: ID, scheduledDate: "2026-10-06", scheduledTime: "10:00" }))).toBe("SCHEDULE_NOT_APPLICABLE");
    expect(sched.db.commit).not.toHaveBeenCalled();
    expect(live.db.commit).not.toHaveBeenCalled();
  });

  it.each(["DRAFT", "SCHEDULED", "LIVE", "COMPLETED", "CANCELLED"] as const)("refuses to resume a %s fixture", async (status) => {
    const { db, ctx } = setup({ status });
    expect(await code(resumeFixture(ctx, { fixtureId: ID }))).toBe("INVALID_FIXTURE_TRANSITION");
    expect(db.commit).not.toHaveBeenCalled();
  });
});

describe("authorization", () => {
  it("lets a coordinator act on their own sport", async () => {
    const { db, ctx } = setup({ status: "SCHEDULED" }, "SPORT_COORDINATOR", ["basketball"]);
    await postponeFixture(ctx, { fixtureId: ID, reason: "rain" });
    expect(committed(db)[1].data).toMatchObject({ actorRole: "SPORT_COORDINATOR", actorEmail: "coord@example.com" });
  });

  it.each([
    ["postponeFixture", postponeFixture, { fixtureId: ID, reason: "x" }],
    ["resumeFixture", resumeFixture, { fixtureId: ID }],
  ] as const)("rejects a coordinator of another sport on %s", async (_name, op, input) => {
    const { db, ctx } = setup({ status: "POSTPONED", resumeStatus: "SCHEDULED" }, "SPORT_COORDINATOR", ["football"]);
    expect(await code(op(ctx, input))).toBe("SPORT_NOT_ASSIGNED");
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("rejects a coordinator with no sports at all", async () => {
    const { ctx } = setup({ status: "SCHEDULED" }, "SPORT_COORDINATOR", []);
    expect(await code(postponeFixture(ctx, { fixtureId: ID, reason: "x" }))).toBe("SPORT_NOT_ASSIGNED");
  });

  it("allows only the Super Admin to cancel a fixture", async () => {
    const coordinator = setup({ status: "SCHEDULED" }, "SPORT_COORDINATOR", ["basketball"]);
    expect(await code(cancelFixture(coordinator.ctx, { fixtureId: ID, reason: "x" }))).toBe("SUPER_ADMIN_REQUIRED");
    expect(coordinator.db.commit).not.toHaveBeenCalled();
    const admin = setup({ status: "SCHEDULED" });
    await expect(cancelFixture(admin.ctx, { fixtureId: ID, reason: "x" })).resolves.toMatchObject({ ok: true, status: "CANCELLED" });
  });
});
