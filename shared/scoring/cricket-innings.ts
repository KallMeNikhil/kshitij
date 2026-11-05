export interface InningsState {
  runs: number;
  wickets: number;
  oversCompleted: number;
  ballsInOver: number;
  allOut: boolean;
}

export interface CricketInningsState {
  oversPerInnings: number;
  battingFirst: "A" | "B";
  innings1: InningsState;
  innings2: InningsState;
  currentInnings: 1 | 2;
}

function emptyInnings(): InningsState {
  return { runs: 0, wickets: 0, oversCompleted: 0, ballsInOver: 0, allOut: false };
}

export function emptyCricketState(oversPerInnings: number, battingFirst: "A" | "B"): CricketInningsState {
  return { oversPerInnings, battingFirst, innings1: emptyInnings(), innings2: emptyInnings(), currentInnings: 1 };
}

function inningsOverLimit(innings: InningsState, oversPerInnings: number): boolean {
  return innings.oversCompleted >= oversPerInnings;
}

export function target(state: CricketInningsState): number | null {
  if (state.innings1.runs === 0 && state.innings1.oversCompleted === 0 && state.innings1.ballsInOver === 0) {
    return null;
  }
  return state.innings1.runs + 1;
}

export function ballsBowled(innings: InningsState): number {
  return innings.oversCompleted * 6 + innings.ballsInOver;
}

export function runsRequired(state: CricketInningsState): number | null {
  const t = target(state);
  if (t === null) return null;
  return Math.max(0, t - state.innings2.runs);
}

export function ballsRemaining(state: CricketInningsState): number {
  const maxBalls = state.oversPerInnings * 6;
  return Math.max(0, maxBalls - ballsBowled(state.innings2));
}

export function isInningsOver(innings: InningsState, oversPerInnings: number, maxWickets: number): boolean {
  return innings.allOut || innings.wickets >= maxWickets || inningsOverLimit(innings, oversPerInnings);
}

export interface MatchResult {
  winner: "A" | "B" | "TIE" | null;
  margin: string;
}

export function computeResult(state: CricketInningsState, maxWickets = 10): MatchResult {
  const t = target(state);
  if (t === null) return { winner: null, margin: "" };
  const chasingRuns = state.innings2.runs;
  const chaser = state.battingFirst === "A" ? "B" : "A";
  const setter = state.battingFirst;
  if (chasingRuns >= t) {
    const wicketsLeft = maxWickets - state.innings2.wickets;
    return { winner: chaser, margin: `by ${Math.max(wicketsLeft, 0)} wicket(s)` };
  }
  if (chasingRuns === t - 1) {
    return { winner: "TIE", margin: "match tied" };
  }
  const runMargin = t - 1 - chasingRuns;
  return { winner: setter, margin: `by ${runMargin} run(s)` };
}
