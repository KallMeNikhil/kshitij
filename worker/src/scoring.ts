import { AppError } from "./errors";
import type { FirestoreRestClient } from "./firestore/client";
import type { FixtureDoc, ScoringModel, SportDoc } from "../../shared/types";
import type { MatchConfiguration } from "../../shared/matchConfig";
import { resolveScoringModel } from "../../shared/scoring/registry";

export async function resolveFixtureScoring(
  db: FirestoreRestClient,
  fixture: FixtureDoc,
  transaction: string
): Promise<{ scoringModel: ScoringModel; matchConfiguration: MatchConfiguration | null }> {
  const sport = fixture.matchConfigurationSnapshot
    ? null
    : await db.getDocument<SportDoc>("sports", fixture.sportId, transaction);
  let scoringModel: ScoringModel;
  try {
    scoringModel = resolveScoringModel(fixture, sport);
  } catch {
    throw new AppError(400, "UNKNOWN_SCORING_MODEL", "No scoring model could be resolved for this fixture's sport");
  }
  return {
    scoringModel,
    matchConfiguration: fixture.matchConfigurationSnapshot ?? sport?.matchConfiguration ?? null,
  };
}
