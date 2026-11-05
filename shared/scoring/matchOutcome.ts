import type { ScoringModel } from "../types";
import type { MatchConfiguration } from "../matchConfig";
import { canEndMatch, type BasketballState } from "./basketball-points";
import { matchWinner as setsWinner, setsSummary, type SetsPointsState } from "./sets-points";
import { matchWinner as tennisWinner, tennisSummary, type TennisState } from "./tennis-sets-games";
import { decideWinner as footballWinner, score as footballScore, type FootballState } from "./football-events";
import { computeResult as cricketResult, type CricketInningsState } from "./cricket-innings";
import { boardsSummary, boardsWinner, resultWinner, type ResultOnlyState } from "./result-only";
import {
  basketballConfigFrom,
  cricketWicketsFrom,
  penaltiesOnDrawFrom,
  resultOnlyRulesFrom,
  setsPointsConfigFrom,
} from "./fromMatchConfiguration";

export type MatchOutcome =
  | { finished: true; winner: "A" | "B"; summary: string }
  | { finished: false; reason: "IN_PROGRESS" | "LEVEL"; message: string };

const inProgress = (message: string): MatchOutcome => ({ finished: false, reason: "IN_PROGRESS", message });
const level = (message: string): MatchOutcome => ({ finished: false, reason: "LEVEL", message });

export interface OutcomeOptions {
  penalties?: { a: number; b: number };
}

export function evaluateMatch(
  scoringModel: ScoringModel,
  matchConfiguration: MatchConfiguration | null | undefined,
  sportId: string,
  data: unknown,
  options: OutcomeOptions = {}
): MatchOutcome {
  if (!data || typeof data !== "object") return inProgress("No score has been recorded for this match yet.");
  try {
    switch (scoringModel) {
      case "SETS_POINTS": {
        const state = data as SetsPointsState;
        const winner = setsWinner(state, setsPointsConfigFrom(matchConfiguration, sportId));
        return winner ? { finished: true, winner, summary: setsSummary(state) } : inProgress("The required number of sets has not been won yet.");
      }
      case "TENNIS_SETS_GAMES": {
        const state = data as TennisState;
        const winner = tennisWinner(state);
        return winner ? { finished: true, winner, summary: tennisSummary(state) } : inProgress("The required number of sets has not been won yet.");
      }
      case "BASKETBALL_POINTS": {
        const state = data as BasketballState;
        const config = basketballConfigFrom(matchConfiguration);
        if (!state.ended) {
          if (state.period >= config.quarters && state.scoreA === state.scoreB) return level("Scores are level. Play overtime to decide a winner.");
          return inProgress(canEndMatch(state, config) ? "End the final period before completing the match." : "The final period has not been played yet.");
        }
        if (state.scoreA === state.scoreB) return level("Scores are level. Play overtime to decide a winner.");
        return { finished: true, winner: state.scoreA > state.scoreB ? "A" : "B", summary: `${state.scoreA}-${state.scoreB}` };
      }
      case "CRICKET_INNINGS": {
        const state = data as CricketInningsState;
        const result = cricketResult(state, cricketWicketsFrom(matchConfiguration));
        if (result.winner === null) return inProgress("The second innings is not over yet.");
        if (result.winner === "TIE") return level("The match is tied. Record the tie-break result as an organisers' decision.");
        return { finished: true, winner: result.winner, summary: result.margin };
      }
      case "FOOTBALL_EVENTS": {
        const state = data as FootballState;
        if (!state.ended) return inProgress("Mark the end of the match before completing it.");
        const penalties = options.penalties ?? state.penalties;
        const goals = footballScore(state);
        const usePenalties = penaltiesOnDrawFrom(matchConfiguration);
        const outcome = footballWinner({ ...state, penalties: usePenalties ? penalties : undefined });
        if (outcome === "DRAW") {
          return level(usePenalties ? "Scores are level. Record the penalty shoot-out result." : "Scores are level. Record the result as an organisers' decision.");
        }
        const pens = goals.a === goals.b && penalties ? ` (penalties ${penalties.a}-${penalties.b})` : "";
        return { finished: true, winner: outcome, summary: `${goals.a}-${goals.b}${pens}` };
      }
      case "RESULT_ONLY": {
        const state = data as ResultOnlyState;
        const rules = resultOnlyRulesFrom(matchConfiguration, sportId);
        if (rules.boards) {
          const winner = boardsWinner(state, rules.bestOfBoards);
          return winner ? { finished: true, winner, summary: boardsSummary(state) } : inProgress("The required number of boards has not been won yet.");
        }
        if (state.outcome === "DRAW" && !rules.drawAllowed) return level("A draw is not allowed in this competition.");
        const winner = resultWinner(state);
        if (winner) {
          const parts = [state.outcome === "DRAW" ? "Drawn, won on tie-break" : "", state.method ?? ""].filter(Boolean);
          return { finished: true, winner, summary: parts.join(" · ") };
        }
        if (state.outcome === "DRAW") return level("The game was drawn. Record the tie-break winner.");
        return inProgress("No result has been recorded yet.");
      }
      default:
        return inProgress("This scoring model is not supported.");
    }
  } catch {
    return inProgress("The recorded score could not be read.");
  }
}
