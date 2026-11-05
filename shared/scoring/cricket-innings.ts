export interface InningsState {
  runs: number;
  wickets: number;
  oversCompleted: number;
  ballsInOver: number;
  allOut: boolean;
  extras?: number;
  closed?: boolean;
}

export interface CricketToss {
  winner: "A" | "B";
  decision: "BAT" | "BOWL";
}

export interface CricketInningsState {
  oversPerInnings: number;
  battingFirst: "A" | "B";
  innings1: InningsState;
  innings2: InningsState;
  currentInnings: 1 | 2;
  toss?: CricketToss;
}

export type CricketExtra = "WIDE" | "NO_BALL" | "BYE" | "LEG_BYE";

export interface CricketBall {
  runs?: number;
  wicket?: boolean;
  extra?: CricketExtra;
}

function emptyInnings(): InningsState {
  return { runs: 0, wickets: 0, oversCompleted: 0, ballsInOver: 0, allOut: false };
}

export function emptyCricketState(oversPerInnings: number, battingFirst: "A" | "B", toss?: CricketToss): CricketInningsState {
  return {
    oversPerInnings,
    battingFirst,
    innings1: emptyInnings(),
    innings2: emptyInnings(),
    currentInnings: 1,
    ...(toss ? { toss } : {}),
  };
}

export function battingFirstFromToss(toss: CricketToss): "A" | "B" {
  if (toss.decision === "BAT") return toss.winner;
  return toss.winner === "A" ? "B" : "A";
}

export function ballsBowled(innings: InningsState): number {
  return innings.oversCompleted * 6 + innings.ballsInOver;
}

export function hasStarted(state: CricketInningsState): boolean {
  return ballsBowled(state.innings1) > 0 || state.innings1.runs > 0 || state.currentInnings === 2;
}

export function target(state: CricketInningsState): number | null {
  if (state.currentInnings === 1) return null;
  return state.innings1.runs + 1;
}

export function runsRequired(state: CricketInningsState): number | null {
  const t = target(state);
  if (t === null) return null;
  return Math.max(0, t - state.innings2.runs);
}

export function ballsRemaining(state: CricketInningsState): number {
  const current = state.currentInnings === 1 ? state.innings1 : state.innings2;
  return Math.max(0, state.oversPerInnings * 6 - ballsBowled(current));
}

export function isInningsOver(innings: InningsState, oversPerInnings: number, maxWickets: number): boolean {
  return innings.allOut || innings.closed === true || innings.wickets >= maxWickets || innings.oversCompleted >= oversPerInnings;
}

export function isMatchOver(state: CricketInningsState, maxWickets = 10): boolean {
  if (state.currentInnings === 1) return false;
  const t = state.innings1.runs + 1;
  return state.innings2.runs >= t || isInningsOver(state.innings2, state.oversPerInnings, maxWickets);
}

export interface MatchResult {
  winner: "A" | "B" | "TIE" | null;
  margin: string;
}

export function computeResult(state: CricketInningsState, maxWickets = 10): MatchResult {
  if (state.currentInnings === 1) return { winner: null, margin: "" };
  const t = state.innings1.runs + 1;
  const chaser = state.battingFirst === "A" ? "B" : "A";
  const setter = state.battingFirst;
  if (state.innings2.runs >= t) {
    const wicketsLeft = Math.max(maxWickets - state.innings2.wickets, 0);
    return { winner: chaser, margin: `by ${wicketsLeft} wicket${wicketsLeft === 1 ? "" : "s"}` };
  }
  if (!isInningsOver(state.innings2, state.oversPerInnings, maxWickets)) return { winner: null, margin: "" };
  if (state.innings2.runs === t - 1) return { winner: "TIE", margin: "match tied" };
  const runMargin = t - 1 - state.innings2.runs;
  return { winner: setter, margin: `by ${runMargin} run${runMargin === 1 ? "" : "s"}` };
}

function settleInnings(innings: InningsState, maxWickets: number): InningsState {
  return innings.wickets >= maxWickets ? { ...innings, allOut: true } : innings;
}

export function recordBall(state: CricketInningsState, ball: CricketBall, maxWickets = 10): CricketInningsState {
  if (isMatchOver(state, maxWickets)) return state;
  const key = state.currentInnings === 1 ? "innings1" : "innings2";
  const innings = state[key];
  if (isInningsOver(innings, state.oversPerInnings, maxWickets)) return state;

  const runs = Math.max(0, Math.floor(ball.runs ?? 0));
  const illegal = ball.extra === "WIDE" || ball.extra === "NO_BALL";
  const penalty = illegal ? 1 : 0;
  const extraRuns = ball.extra === "WIDE" || ball.extra === "BYE" || ball.extra === "LEG_BYE" ? runs : 0;
  const next: InningsState = {
    ...innings,
    runs: innings.runs + runs + penalty,
    wickets: innings.wickets + (ball.wicket ? 1 : 0),
    extras: (innings.extras ?? 0) + penalty + extraRuns,
  };
  if (!illegal) {
    next.ballsInOver = innings.ballsInOver + 1;
    if (next.ballsInOver === 6) {
      next.ballsInOver = 0;
      next.oversCompleted = innings.oversCompleted + 1;
    }
  }
  const settled = settleInnings(next, maxWickets);
  const updated: CricketInningsState = { ...state, [key]: settled };
  if (state.currentInnings === 1 && isInningsOver(settled, state.oversPerInnings, maxWickets)) {
    return { ...updated, currentInnings: 2 };
  }
  return updated;
}

export function endInnings(state: CricketInningsState): CricketInningsState {
  if (state.currentInnings === 1) {
    return { ...state, innings1: { ...state.innings1, closed: true }, currentInnings: 2 };
  }
  return { ...state, innings2: { ...state.innings2, closed: true } };
}
