import type { ScoringModel, FixtureDoc, SportDoc } from "../types";
import * as SetsPoints from "./sets-points";
import * as CricketInnings from "./cricket-innings";
import * as FootballEvents from "./football-events";
import * as BasketballPoints from "./basketball-points";
import * as TennisSetsGames from "./tennis-sets-games";
import * as ResultOnly from "./result-only";

export const scoringRegistry: Record<ScoringModel, unknown> = {
  SETS_POINTS: SetsPoints,
  CRICKET_INNINGS: CricketInnings,
  FOOTBALL_EVENTS: FootballEvents,
  BASKETBALL_POINTS: BasketballPoints,
  TENNIS_SETS_GAMES: TennisSetsGames,
  RESULT_ONLY: ResultOnly,
};

export function sportToScoringModel(sportId: string): ScoringModel {
  const map: Record<string, ScoringModel> = {
    football: "FOOTBALL_EVENTS",
    cricket: "CRICKET_INNINGS",
    badminton: "SETS_POINTS",
    "table-tennis": "SETS_POINTS",
    volleyball: "SETS_POINTS",
    basketball: "BASKETBALL_POINTS",
    tennis: "TENNIS_SETS_GAMES",
    chess: "RESULT_ONLY",
    carrom: "RESULT_ONLY",
  };
  const model = map[sportId];
  if (!model) throw new Error(`UNKNOWN_SPORT_FOR_SCORING_MODEL: ${sportId}`);
  return model;
}

export function resolveScoringModel(fixture: Pick<FixtureDoc, "sportId" | "matchConfigurationSnapshot">, sport?: Pick<SportDoc, "matchConfiguration"> | null): ScoringModel {
  return (
    fixture.matchConfigurationSnapshot?.scoringModel ??
    sport?.matchConfiguration?.scoringModel ??
    sportToScoringModel(fixture.sportId)
  );
}
