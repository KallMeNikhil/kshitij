import type { ScoringModel } from "../types";
import type { MatchConfiguration } from "../matchConfig";
import { decideWinner as basketballWinner, type BasketballState } from "./basketball-points";
import { matchWinner as setsWinner, type SetsPointsState } from "./sets-points";
import { matchWinner as tennisWinner, type TennisState } from "./tennis-sets-games";
import { decideWinner as footballWinner, type FootballState } from "./football-events";
import { computeResult as cricketResult, type CricketInningsState } from "./cricket-innings";
import type { ResultOnlyState } from "./result-only";
import { cricketWicketsFrom, setsPointsConfigFrom } from "./fromMatchConfiguration";

export const COMPLETION_OVERRIDE_KINDS = ["WALKOVER", "ADMIN_OVERRIDE"] as const;

export interface CrossCheckOptions {
  penalties?: { a: number; b: number };
}

const OVERRIDE_HINT = "If this is a walkover or manual override, set decidedBy to something other than the scoring model name.";

export function crossCheckWinner(
  scoringModel: ScoringModel,
  decidedBy: string,
  sportId: string,
  matchConfiguration: MatchConfiguration | null | undefined,
  stateData: unknown,
  submittedWinnerSlot: "A" | "B",
  options: CrossCheckOptions = {}
): { ok: true } | { ok: false; message: string } {
  if (decidedBy !== scoringModel) return { ok: true };

  const level = (what: string) => ({
    ok: false as const,
    message: `The recorded score is ${what}, so it cannot decide a winner. A Super Admin can record this as an admin override with an explanation.`,
  });

  let computed: "A" | "B" | "DRAW" | "TIE" | null;
  if (scoringModel === "BASKETBALL_POINTS") {
    computed = basketballWinner(stateData as BasketballState);
    if (computed === null) return level("level");
  } else if (scoringModel === "SETS_POINTS") {
    computed = setsWinner(stateData as SetsPointsState, setsPointsConfigFrom(matchConfiguration, sportId));
  } else if (scoringModel === "TENNIS_SETS_GAMES") {
    computed = tennisWinner(stateData as TennisState);
  } else if (scoringModel === "FOOTBALL_EVENTS") {
    const state = stateData as FootballState;
    computed = footballWinner({ ...state, penalties: options.penalties ?? state.penalties });
    if (computed === "DRAW") return level("level with no shootout result");
  } else if (scoringModel === "CRICKET_INNINGS") {
    computed = cricketResult(stateData as CricketInningsState, cricketWicketsFrom(matchConfiguration)).winner;
    if (computed === "TIE") return level("a tie");
  } else if (scoringModel === "RESULT_ONLY") {
    computed = (stateData as ResultOnlyState).outcome;
    if (computed === "DRAW") return level("a draw");
  } else {
    return { ok: true };
  }

  if (computed !== null && computed !== submittedWinnerSlot) {
    return {
      ok: false,
      message: `Recorded score shows ${computed} as the winner, not ${submittedWinnerSlot}. ${OVERRIDE_HINT}`,
    };
  }
  return { ok: true };
}
