import { AppError } from "../errors";
import { AuthContext, requireSuperAdmin } from "../auth/authorize";
import { auditWrite } from "../audit";
import { parseInput, withdrawEntrantInput } from "../validation";
import type { FixtureDoc, ParticipantDoc, TeamDoc } from "../../../shared/types";

export async function withdrawEntrant(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { collection, id, reason } = parseInput(withdrawEntrantInput, input);
  if (collection !== "teams" && collection !== "participants") {
    throw new AppError(400, "INVALID_COLLECTION", "collection must be 'teams' or 'participants'");
  }
  if (!reason || reason.trim().length === 0) {
    throw new AppError(400, "REASON_REQUIRED", "A reason is required to withdraw an entrant");
  }

  const transaction = await ctx.db.beginTransaction();
  try {
    const before = await ctx.db.getDocument<TeamDoc | ParticipantDoc>(collection, id, transaction);
    if (!before) throw new AppError(404, "ENTRANT_NOT_FOUND", "Entrant not found");
    if (before.status === "WITHDRAWN") {
      throw new AppError(400, "ALREADY_WITHDRAWN", "This entrant is already withdrawn");
    }

    const slotKind = collection === "teams" ? "TEAM" : "PARTICIPANT";
    const idField = collection === "teams" ? "teamId" : "participantId";
    const entrantId = collection === "teams" ? (before as TeamDoc).teamId : (before as ParticipantDoc).participantId;

    const fixtureRows = await ctx.db.runQuery<FixtureDoc>(
      "fixtures",
      [{ field: "competitionId", op: "EQUAL", value: before.competitionId }],
      transaction
    );
    const affectedFixtureIds = fixtureRows
      .map((r) => r.data)
      .filter((f) => f.status !== "COMPLETED" && f.status !== "CANCELLED")
      .filter(
        (f) =>
          (f.slotA.kind === slotKind && f.slotA[idField as "teamId" | "participantId"] === entrantId) ||
          (f.slotB.kind === slotKind && f.slotB[idField as "teamId" | "participantId"] === entrantId)
      )
      .map((f) => f.fixtureId);

    await ctx.db.commit(transaction, [
      { collection, id, data: { status: "WITHDRAWN" }, mergeFields: ["status"] },
      auditWrite({
        action: "withdrawEntrant",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: collection === "teams" ? "team" : "participant",
        targetId: id,
        reason,
        before: { status: before.status ?? "ACTIVE" },
        after: { status: "WITHDRAWN", affectedFixtureIds },
      }),
    ]);

    return { ok: true, affectedFixtureIds };
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }
}
