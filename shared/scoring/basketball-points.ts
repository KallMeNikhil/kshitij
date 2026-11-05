export type PeriodLabel = "QUARTER" | "HALF" | "PERIOD";

export interface BasketballConfig {
  quarters: number;
  periodLabel?: PeriodLabel;
}

export interface PeriodEnd {
  a: number;
  b: number;
}

export interface BasketballState {
  scoreA: number;
  scoreB: number;
  period: number;
  overtime: boolean;
  periodEnds?: PeriodEnd[];
  ended?: boolean;
}

export function emptyBasketballState(): BasketballState {
  return { scoreA: 0, scoreB: 0, period: 1, overtime: false };
}

export function addPoints(state: BasketballState, side: "A" | "B", points: 1 | 2 | 3): BasketballState {
  if (state.ended) return state;
  return side === "A"
    ? { ...state, scoreA: state.scoreA + points }
    : { ...state, scoreB: state.scoreB + points };
}

export function correctPoints(state: BasketballState, side: "A" | "B", delta: number): BasketballState {
  if (state.ended) return state;
  return side === "A"
    ? { ...state, scoreA: Math.max(0, state.scoreA + delta) }
    : { ...state, scoreB: Math.max(0, state.scoreB + delta) };
}

export function advancePeriod(state: BasketballState, config: BasketballConfig): BasketballState {
  if (state.ended) return state;
  const next = state.period + 1;
  const ends = [...(state.periodEnds ?? []).slice(0, state.period - 1), { a: state.scoreA, b: state.scoreB }];
  return { ...state, period: next, overtime: next > config.quarters, periodEnds: ends };
}

export function setPeriod(state: BasketballState, period: number, config: BasketballConfig): BasketballState {
  if (state.ended) return state;
  const target = Math.max(1, Math.min(period, state.period + 1));
  if (target === state.period) return state;
  if (target > state.period) return advancePeriod(state, config);
  return {
    ...state,
    period: target,
    overtime: target > config.quarters,
    periodEnds: (state.periodEnds ?? []).slice(0, target - 1),
  };
}

export function periodName(period: number, config: BasketballConfig): string {
  const label = config.periodLabel === "HALF" ? "Half" : config.periodLabel === "PERIOD" ? "Period" : "Quarter";
  if (period <= config.quarters) return `${label} ${period}`;
  const n = period - config.quarters;
  return n === 1 ? "Overtime" : `Overtime ${n}`;
}

export function periodScores(state: BasketballState): { period: number; a: number; b: number }[] {
  const ends = state.periodEnds ?? [];
  return ends.map((end, i) => ({
    period: i + 1,
    a: end.a - (i === 0 ? 0 : ends[i - 1].a),
    b: end.b - (i === 0 ? 0 : ends[i - 1].b),
  }));
}

export function decideWinner(state: BasketballState): "A" | "B" | null {
  if (state.scoreA === state.scoreB) return null;
  return state.scoreA > state.scoreB ? "A" : "B";
}

export function canEndMatch(state: BasketballState, config: BasketballConfig): boolean {
  return !state.ended && state.period >= config.quarters && state.scoreA !== state.scoreB;
}

export function endMatch(state: BasketballState, config: BasketballConfig): BasketballState {
  if (!canEndMatch(state, config)) return state;
  const ends = [...(state.periodEnds ?? []).slice(0, state.period - 1), { a: state.scoreA, b: state.scoreB }];
  return { ...state, periodEnds: ends, ended: true };
}

export function resumeMatch(state: BasketballState): BasketballState {
  if (!state.ended) return state;
  return { ...state, ended: false, periodEnds: (state.periodEnds ?? []).slice(0, state.period - 1) };
}
