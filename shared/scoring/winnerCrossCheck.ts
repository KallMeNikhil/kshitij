import type { ScoringModel } from "../types";
import type { MatchConfiguration } from "../matchConfig";
import { evaluateMatch, type OutcomeOptions } from "./matchOutcome";

export interface CrossCheckOptions extends OutcomeOptions {}

export function crossCheckWinner(
  scoringModel: ScoringModel,
  decidedBy: string,
  sportId: string,
  matchConfiguration: MatchConfiguration | null | undefined,
  stateData: unknown,
  submittedWinnerSlot: "A" | "B",
  options: CrossCheckOptions = {}
): { ok: true; summary?: string } | { ok: false; message: string } {
  if (decidedBy !== scoringModel) return { ok: true };
  const outcome = evaluateMatch(scoringModel, matchConfiguration, sportId, stateData, options);
  if (!outcome.finished) {
    return { ok: false, message: `${outcome.message} To end the match early, record a result type such as walkover, retired or organisers' decision.` };
  }
  if (outcome.winner !== submittedWinnerSlot) {
    return { ok: false, message: `The recorded score shows ${outcome.winner} as the winner, not ${submittedWinnerSlot}.` };
  }
  return { ok: true, summary: outcome.summary };
}
