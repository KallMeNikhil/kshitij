export type ResultOutcome = "A" | "B" | "DRAW";

export interface BoardScore {
  a: number;
  b: number;
}

export interface ResultOnlyState {
  outcome: ResultOutcome | null;
  tieBreakWinner?: "A" | "B";
  method?: string;
  boards?: BoardScore[];
}

export const RESULT_METHODS = [
  "Checkmate",
  "Resignation",
  "Time forfeit",
  "Illegal move",
  "Draw agreed",
  "Stalemate",
] as const;

export function emptyResultOnlyState(): ResultOnlyState {
  return { outcome: null };
}

export function setOutcome(state: ResultOnlyState, outcome: ResultOutcome, method?: string): ResultOnlyState {
  const { tieBreakWinner: _drop, ...rest } = state;
  return { ...rest, outcome, ...(method ? { method } : {}) };
}

export function setTieBreakWinner(state: ResultOnlyState, winner: "A" | "B"): ResultOnlyState {
  if (state.outcome !== "DRAW") return state;
  return { ...state, tieBreakWinner: winner };
}

export function boardsWon(state: ResultOnlyState): { a: number; b: number } {
  const boards = state.boards ?? [];
  return {
    a: boards.filter((x) => x.a > x.b).length,
    b: boards.filter((x) => x.b > x.a).length,
  };
}

export function boardsWinner(state: ResultOnlyState, bestOfBoards: number): "A" | "B" | null {
  const won = boardsWon(state);
  const majority = Math.ceil(bestOfBoards / 2);
  if (won.a >= majority) return "A";
  if (won.b >= majority) return "B";
  return null;
}

export function addBoard(state: ResultOnlyState, board: BoardScore, bestOfBoards: number): ResultOnlyState {
  if (boardsWinner(state, bestOfBoards)) return state;
  const boards = [...(state.boards ?? []), { a: Math.max(0, Math.floor(board.a)), b: Math.max(0, Math.floor(board.b)) }];
  const next: ResultOnlyState = { ...state, boards };
  const winner = boardsWinner(next, bestOfBoards);
  return { ...next, outcome: winner };
}

export function removeLastBoard(state: ResultOnlyState, bestOfBoards: number): ResultOnlyState {
  const boards = (state.boards ?? []).slice(0, -1);
  const next: ResultOnlyState = { ...state, boards };
  return { ...next, outcome: boardsWinner(next, bestOfBoards) };
}

export function resultWinner(state: ResultOnlyState): "A" | "B" | null {
  if (state.outcome === "A" || state.outcome === "B") return state.outcome;
  if (state.outcome === "DRAW" && state.tieBreakWinner) return state.tieBreakWinner;
  return null;
}

export function boardsSummary(state: ResultOnlyState): string {
  return (state.boards ?? []).map((x) => `${x.a}-${x.b}`).join(", ");
}
