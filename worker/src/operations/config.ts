import { AppError } from "../errors";
import { AuthContext, requireSuperAdmin } from "../auth/authorize";
import { auditWrite } from "../audit";
import { matchConfigurationSchema } from "../../../shared/schemas";
import { regenerationBlocker } from "../fixtureWrites";
import { isValidId } from "../../../shared/ids";
import { parseInput, updateSportConfigInput, updateCompetitionConfigInput } from "../validation";
import type { SportDoc, CompetitionDoc, FixtureDoc } from "../../../shared/types";

export async function updateSportConfig(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { sportId, matchConfiguration } = parseInput(updateSportConfigInput, input);
  if (!sportId) throw new AppError(400, "SPORT_ID_REQUIRED", "sportId is required");
  if (!isValidId(sportId)) throw new AppError(400, "INVALID_INPUT", "sportId is not a valid id");

  const parsed = matchConfigurationSchema.safeParse(matchConfiguration);
  if (!parsed.success) {
    throw new AppError(400, "INVALID_MATCH_CONFIGURATION", parsed.error.issues.map((i) => i.message).join("; "));
  }

  const transaction = await ctx.db.beginTransaction();
  try {
    const sport = await ctx.db.getDocument<SportDoc>("sports", sportId, transaction);
    if (!sport) throw new AppError(404, "SPORT_NOT_FOUND", "Sport not found");

    if (sport.scoringModel && parsed.data.scoringModel !== sport.scoringModel) {
      throw new AppError(
        400,
        "SCORING_MODEL_MISMATCH",
        `This sport is registered with scoring model ${sport.scoringModel}; the configuration says ${parsed.data.scoringModel}`
      );
    }

    const nextConfig = { ...parsed.data, configVersion: (sport.matchConfiguration?.configVersion ?? 0) + 1 };

    await ctx.db.commit(transaction, [
      {
        collection: "sports",
        id: sportId,
        data: { matchConfiguration: nextConfig },
        mergeFields: ["matchConfiguration"],
      },
      auditWrite({
        action: "updateSportConfig",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "sport",
        targetId: sportId,
        before: sport.matchConfiguration ?? null,
        after: nextConfig,
      }),
    ]);
    return { ok: true, matchConfiguration: nextConfig };
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }
}

export async function updateCompetitionConfig(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { competitionId, matchConfiguration, acknowledgeExistingFixtures } = parseInput(updateCompetitionConfigInput, input);
  if (!competitionId) throw new AppError(400, "COMPETITION_ID_REQUIRED", "competitionId is required");
  if (!isValidId(competitionId)) throw new AppError(400, "INVALID_INPUT", "competitionId is not a valid id");

  const parsed = matchConfigurationSchema.safeParse(matchConfiguration);
  if (!parsed.success) {
    throw new AppError(400, "INVALID_MATCH_CONFIGURATION", parsed.error.issues.map((i) => i.message).join("; "));
  }

  const transaction = await ctx.db.beginTransaction();
  try {
    const competition = await ctx.db.getDocument<CompetitionDoc>(
      "competitions",
      competitionId,
      transaction
    );
    if (!competition) throw new AppError(404, "COMPETITION_NOT_FOUND", "Competition not found");

    const sport = await ctx.db.getDocument<SportDoc>("sports", competition.sportId, transaction);
    const sportModel = sport?.matchConfiguration?.scoringModel ?? sport?.scoringModel;
    if (sportModel && parsed.data.scoringModel !== sportModel) {
      throw new AppError(
        400,
        "SCORING_MODEL_MISMATCH",
        `A ${competition.sportId} competition must use the sport's scoring model ${sportModel}, not ${parsed.data.scoringModel}`
      );
    }

    if (parsed.data.participantModel.participantType !== competition.participantType) {
      throw new AppError(
        400,
        "MATCH_CONFIGURATION_PARTICIPANT_TYPE_MISMATCH",
        "matchConfiguration.participantModel.participantType must match the competition's participantType"
      );
    }

    const existingFixtures = await ctx.db.runQuery<FixtureDoc>(
      "fixtures",
      [{ field: "competitionId", op: "EQUAL", value: competitionId }],
      transaction
    );

    if (existingFixtures.length > 0) {
      const blocker = await regenerationBlocker(ctx, existingFixtures.map((d) => d.data), transaction);
      if (blocker) {
        throw new AppError(
          400,
          "CONFIGURATION_LOCKED_OPERATIONAL_FIXTURES_EXIST",
          `Cannot change match configuration once play has started (${blocker})`
        );
      }
      if (!acknowledgeExistingFixtures) {
        throw new AppError(
          400,
          "CONFIRMATION_REQUIRED_EXISTING_DRAFT_FIXTURES",
          "Fixtures already exist for this competition; resubmit with acknowledgeExistingFixtures=true, then regenerate the bracket so fixtures pick up the new configuration"
        );
      }
    }

    const nextConfig = {
      ...parsed.data,
      configVersion: (competition.matchConfiguration?.configVersion ?? 0) + 1,
    };

    await ctx.db.commit(transaction, [
      {
        collection: "competitions",
        id: competitionId,
        data: { matchConfiguration: nextConfig },
        mergeFields: ["matchConfiguration"],
      },
      auditWrite({
        action: "updateCompetitionConfig",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "competition",
        targetId: competitionId,
        before: competition.matchConfiguration ?? null,
        after: nextConfig,
      }),
    ]);
    return { ok: true, matchConfiguration: nextConfig };
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }
}
