export type ResultOutcome = "A" | "B" | "DRAW";

export interface ResultOnlyState {
  outcome: ResultOutcome | null;
}

export function emptyResultOnlyState(): ResultOnlyState {
  return { outcome: null };
}

export function setOutcome(_state: ResultOnlyState, outcome: ResultOutcome): ResultOnlyState {
  return { outcome };
}
