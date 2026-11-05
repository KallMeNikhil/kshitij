import { AppError } from "../errors";
import { AuthContext, requireSportAccess, requireSuperAdmin } from "../auth/authorize";
import { auditWrite } from "../audit";
import type { FixtureDoc } from "../../../shared/types";
import { resolveLifecycle, type LifecycleAction } from "../../../shared/fixtureLifecycle";
import { findVenueConflict } from "../../../shared/schedule";
import { parseInput, lifecycleInput, resumeInput, reinstateInput } from "../validation";

async function loadAuthorized(ctx: AuthContext, fixtureId: string, transaction: string): Promise<FixtureDoc> {
  const fixture = await ctx.db.getDocument<FixtureDoc>("fixtures", fixtureId, transaction);
  if (!fixture) throw new AppError(404, "FIXTURE_NOT_FOUND", "Fixture not found");
  requireSportAccess(ctx, fixture.sportId);
  if (fixture.slotA.kind === "BYE" || fixture.slotB.kind === "BYE") {
    throw new AppError(400, "CANNOT_CHANGE_BYE_FIXTURE", "A bye fixture has no lifecycle to change");
  }
  return fixture;
}

function resolveOrThrow(action: LifecycleAction, fixture: FixtureDoc) {
  const resolution = resolveLifecycle(action, fixture);
  if (!resolution.ok) throw new AppError(400, resolution.code, resolution.message);
  return resolution;
}

async function withReason(ctx: AuthContext, action: "postpone" | "cancel", input: unknown) {
  const { fixtureId, reason } = parseInput(lifecycleInput, input);
  const transaction = await ctx.db.beginTransaction();
  try {
    const fixture = await loadAuthorized(ctx, fixtureId, transaction);
    const resolution = resolveOrThrow(action, fixture);

    const update: Record<string, unknown> = { status: resolution.to, statusReason: reason };
    const fields = ["status", "statusReason", "resumeStatus"];
    if (resolution.resumeStatus) update.resumeStatus = resolution.resumeStatus;

    await ctx.db.commit(transaction, [
      { collection: "fixtures", id: fixtureId, data: update, mergeFields: fields },
      auditWrite({
        action: action === "postpone" ? "postponeFixture" : "cancelFixture",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "fixture",
        targetId: fixtureId,
        reason,
        before: { status: fixture.status, resumeStatus: fixture.resumeStatus, statusReason: fixture.statusReason },
        after: { status: resolution.to, resumeStatus: resolution.resumeStatus, statusReason: reason },
      }),
    ]);
    return { ok: true, status: resolution.to };
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }
}

export const postponeFixture = (ctx: AuthContext, input: unknown) => withReason(ctx, "postpone", input);
export async function cancelFixture(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  return withReason(ctx, "cancel", input);
}

export async function resumeFixture(ctx: AuthContext, input: unknown) {
  const { fixtureId, scheduledDate, scheduledTime, venue } = parseInput(resumeInput, input);
  if (Boolean(scheduledDate) !== Boolean(scheduledTime)) {
    throw new AppError(400, "SCHEDULE_DATE_AND_TIME_MUST_BE_TOGETHER", "Provide both a date and a time");
  }

  const transaction = await ctx.db.beginTransaction();
  try {
    const fixture = await loadAuthorized(ctx, fixtureId, transaction);
    const resolution = resolveOrThrow("resume", fixture);

    if (resolution.to === "LIVE" && (scheduledDate || venue !== undefined)) {
      throw new AppError(400, "SCHEDULE_NOT_APPLICABLE", "A suspended live match resumes as is and cannot be rescheduled");
    }

    const finalVenue = venue !== undefined ? venue : fixture.venue;
    if (resolution.to === "SCHEDULED" && finalVenue) {
      const finalDate = scheduledDate ?? fixture.scheduledDate;
      const finalTime = scheduledTime ?? fixture.scheduledTime;
      if (finalDate && finalTime) {
        const sameDay = await ctx.db.runQuery<FixtureDoc>(
          "fixtures",
          [{ field: "scheduledDate", op: "EQUAL", value: finalDate }],
          transaction
        );
        const clash = findVenueConflict(
          sameDay.map((r) => r.data),
          { fixtureId, scheduledDate: finalDate, scheduledTime: finalTime, venue: finalVenue }
        );
        if (clash) {
          throw new AppError(409, "SCHEDULE_CONFLICT", `${finalVenue} is already booked at ${finalTime} on ${finalDate} by ${clash}`);
        }
      }
    }

    const update: Record<string, unknown> = { status: resolution.to };
    const fields = ["status", "statusReason", "resumeStatus"];
    if (scheduledDate && scheduledTime) {
      update.scheduledDate = scheduledDate;
      update.scheduledTime = scheduledTime;
      fields.push("scheduledDate", "scheduledTime");
    }
    if (venue !== undefined) {
      update.venue = venue;
      fields.push("venue");
    }

    await ctx.db.commit(transaction, [
      { collection: "fixtures", id: fixtureId, data: update, mergeFields: fields },
      auditWrite({
        action: "resumeFixture",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "fixture",
        targetId: fixtureId,
        reason: fixture.statusReason,
        before: {
          status: fixture.status,
          resumeStatus: fixture.resumeStatus,
          statusReason: fixture.statusReason,
          scheduledDate: fixture.scheduledDate,
          scheduledTime: fixture.scheduledTime,
          venue: fixture.venue,
        },
        after: update,
      }),
    ], { verifyQueries: true });
    return { ok: true, status: resolution.to };
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }
}

export async function reinstateFixture(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { fixtureId, reason, scheduledDate, scheduledTime, venue } = parseInput(reinstateInput, input);
  if (Boolean(scheduledDate) !== Boolean(scheduledTime)) {
    throw new AppError(400, "SCHEDULE_DATE_AND_TIME_MUST_BE_TOGETHER", "Provide both a date and a time");
  }

  const transaction = await ctx.db.beginTransaction();
  try {
    const fixture = await loadAuthorized(ctx, fixtureId, transaction);
    if (fixture.status !== "CANCELLED") {
      throw new AppError(400, "INVALID_FIXTURE_TRANSITION", "Only a cancelled match can be reinstated");
    }

    const finalDate = scheduledDate ?? fixture.scheduledDate;
    const finalTime = scheduledTime ?? fixture.scheduledTime;
    const finalVenue = venue !== undefined ? venue : fixture.venue;
    if (finalDate && finalTime && finalVenue) {
      const sameDay = await ctx.db.runQuery<FixtureDoc>("fixtures", [{ field: "scheduledDate", op: "EQUAL", value: finalDate }], transaction);
      const clash = findVenueConflict(sameDay.map((r) => r.data), { fixtureId, scheduledDate: finalDate, scheduledTime: finalTime, venue: finalVenue });
      if (clash) throw new AppError(409, "SCHEDULE_CONFLICT", `${finalVenue} is already booked at ${finalTime} on ${finalDate} by ${clash}`);
    }

    const update: Record<string, unknown> = { status: "SCHEDULED" };
    const fields = ["status", "statusReason", "resumeStatus"];
    if (scheduledDate && scheduledTime) {
      update.scheduledDate = scheduledDate;
      update.scheduledTime = scheduledTime;
      fields.push("scheduledDate", "scheduledTime");
    }
    if (venue !== undefined) {
      update.venue = venue;
      fields.push("venue");
    }

    await ctx.db.commit(
      transaction,
      [
        { collection: "fixtures", id: fixtureId, data: update, mergeFields: fields },
        auditWrite({
          action: "reinstateFixture",
          actorEmail: ctx.email,
          actorRole: ctx.admin.role,
          targetType: "fixture",
          targetId: fixtureId,
          reason,
          before: { status: fixture.status, statusReason: fixture.statusReason },
          after: update,
        }),
      ],
      { verifyQueries: true }
    );
    return { ok: true, status: "SCHEDULED" };
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }
}
