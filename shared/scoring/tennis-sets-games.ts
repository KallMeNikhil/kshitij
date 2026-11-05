export type TennisPoint = 0 | 15 | 30 | 40 | "AD";

export interface TennisSet {
  gamesA: number;
  gamesB: number;
  completed: boolean;
  tiebreakA?: number;
  tiebreakB?: number;
}

export interface TennisTiebreak {
  a: number;
  b: number;
  super?: boolean;
}

export interface TennisState {
  sets: TennisSet[];
  currentGame: { pointsA: TennisPoint; pointsB: TennisPoint };
  bestOfSets: number;
  tiebreak?: TennisTiebreak;
}

export interface TennisRules {
  gamesPerSet: number;
  tieBreakAtGames?: number;
  tieBreakPoints?: number;
  finalSetFormat?: "FULL_SET" | "SUPER_TIE_BREAK";
  superTieBreakPoints?: number;
  noAd?: boolean;
}

export const DEFAULT_TENNIS_RULES: TennisRules = { gamesPerSet: 6, tieBreakAtGames: 6, tieBreakPoints: 7 };
const DEFAULT_TIEBREAK_POINTS = 7;
const DEFAULT_SUPER_TIEBREAK_POINTS = 10;

export function emptyTennisState(bestOfSets: number, rules: TennisRules = DEFAULT_TENNIS_RULES): TennisState {
  const state: TennisState = {
    sets: [{ gamesA: 0, gamesB: 0, completed: false }],
    currentGame: { pointsA: 0, pointsB: 0 },
    bestOfSets,
  };
  return isDecidingSet(state.sets, bestOfSets) && usesSuperTiebreak(rules, bestOfSets)
    ? { ...state, tiebreak: { a: 0, b: 0, super: true } }
    : state;
}

function setsWon(sets: TennisSet[]): { a: number; b: number } {
  return {
    a: sets.filter((s) => s.completed && s.gamesA > s.gamesB).length,
    b: sets.filter((s) => s.completed && s.gamesB > s.gamesA).length,
  };
}

function isDecidingSet(sets: TennisSet[], bestOfSets: number): boolean {
  const majority = Math.ceil(bestOfSets / 2);
  const won = setsWon(sets);
  return won.a === majority - 1 && won.b === majority - 1;
}

function usesSuperTiebreak(rules: TennisRules, bestOfSets: number): boolean {
  return rules.finalSetFormat === "SUPER_TIE_BREAK" && bestOfSets > 1;
}

const NEXT_POINT: Record<0 | 15 | 30, TennisPoint> = { 0: 15, 15: 30, 30: 40 };

type PointOutcome = { game: true } | { game: false; scorer: TennisPoint; other: TennisPoint };

function scorePoint(scorer: TennisPoint, other: TennisPoint, noAd: boolean): PointOutcome {
  if (scorer === "AD") return { game: true };
  if (scorer === 40) {
    if (other === "AD") return { game: false, scorer: 40, other: 40 };
    if (other === 40) return noAd ? { game: true } : { game: false, scorer: "AD", other: 40 };
    return { game: true };
  }
  return { game: false, scorer: NEXT_POINT[scorer], other };
}

function closeSet(sets: TennisSet[], current: TennisSet, state: TennisState, rules: TennisRules): TennisState {
  current.completed = true;
  const won = setsWon(sets);
  const majority = Math.ceil(state.bestOfSets / 2);
  const base: TennisState = { sets, currentGame: { pointsA: 0, pointsB: 0 }, bestOfSets: state.bestOfSets };
  if (won.a >= majority || won.b >= majority) return base;
  sets.push({ gamesA: 0, gamesB: 0, completed: false });
  if (isDecidingSet(sets, state.bestOfSets) && usesSuperTiebreak(rules, state.bestOfSets)) {
    return { ...base, tiebreak: { a: 0, b: 0, super: true } };
  }
  return base;
}

export function winPoint(state: TennisState, side: "A" | "B", rules: TennisRules = DEFAULT_TENNIS_RULES): TennisState {
  if (matchWinner(state)) return state;
  const sets = state.sets.map((s) => ({ ...s }));
  const current = sets[sets.length - 1];
  if (current.completed) return state;

  if (state.tiebreak) {
    const tb = { ...state.tiebreak };
    if (side === "A") tb.a++;
    else tb.b++;
    const needed = tb.super
      ? rules.superTieBreakPoints ?? DEFAULT_SUPER_TIEBREAK_POINTS
      : rules.tieBreakPoints ?? DEFAULT_TIEBREAK_POINTS;
    if (Math.max(tb.a, tb.b) >= needed && Math.abs(tb.a - tb.b) >= 2) {
      current.tiebreakA = tb.a;
      current.tiebreakB = tb.b;
      if (side === "A") current.gamesA++;
      else current.gamesB++;
      return closeSet(sets, current, state, rules);
    }
    return { sets, currentGame: state.currentGame, bestOfSets: state.bestOfSets, tiebreak: tb };
  }

  const { pointsA, pointsB } = state.currentGame;
  const outcome = side === "A" ? scorePoint(pointsA, pointsB, rules.noAd === true) : scorePoint(pointsB, pointsA, rules.noAd === true);

  if (!outcome.game) {
    const currentGame = side === "A" ? { pointsA: outcome.scorer, pointsB: outcome.other } : { pointsA: outcome.other, pointsB: outcome.scorer };
    return { sets, currentGame, bestOfSets: state.bestOfSets };
  }

  if (side === "A") current.gamesA++;
  else current.gamesB++;
  const high = Math.max(current.gamesA, current.gamesB);
  const diff = Math.abs(current.gamesA - current.gamesB);
  if (high >= rules.gamesPerSet && diff >= 2) return closeSet(sets, current, state, rules);
  if (rules.tieBreakAtGames !== undefined && current.gamesA === rules.tieBreakAtGames && current.gamesB === rules.tieBreakAtGames) {
    return { sets, currentGame: { pointsA: 0, pointsB: 0 }, bestOfSets: state.bestOfSets, tiebreak: { a: 0, b: 0 } };
  }
  return { sets, currentGame: { pointsA: 0, pointsB: 0 }, bestOfSets: state.bestOfSets };
}

export function matchWinner(state: TennisState): "A" | "B" | null {
  const won = setsWon(state.sets);
  const majority = Math.ceil(state.bestOfSets / 2);
  if (won.a >= majority) return "A";
  if (won.b >= majority) return "B";
  return null;
}

export function tennisSummary(state: TennisState): string {
  return state.sets
    .filter((s) => s.completed)
    .map((s) => {
      const games = `${s.gamesA}-${s.gamesB}`;
      if (s.tiebreakA === undefined || s.tiebreakB === undefined) return games;
      if (s.gamesA + s.gamesB === 1) return `[${s.tiebreakA}-${s.tiebreakB}]`;
      return `${games} (${Math.min(s.tiebreakA, s.tiebreakB)})`;
    })
    .join(", ");
}
