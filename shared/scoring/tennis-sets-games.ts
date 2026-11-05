export type TennisPoint = 0 | 15 | 30 | 40 | "AD";

export interface TennisSet {
  gamesA: number;
  gamesB: number;
  completed: boolean;
}

export interface TennisState {
  sets: TennisSet[];
  currentGame: { pointsA: TennisPoint; pointsB: TennisPoint };
  bestOfSets: number;
  tiebreak?: { a: number; b: number };
}

export interface TennisRules {
  gamesPerSet: number;
  tieBreakAtGames?: number;
  tieBreakPoints?: number;
}

const DEFAULT_RULES: TennisRules = { gamesPerSet: 6 };
const DEFAULT_TIEBREAK_POINTS = 7;

export function emptyTennisState(bestOfSets: number): TennisState {
  return { sets: [{ gamesA: 0, gamesB: 0, completed: false }], currentGame: { pointsA: 0, pointsB: 0 }, bestOfSets };
}

const POINT_SEQUENCE: TennisPoint[] = [0, 15, 30, 40];

function advancePoint(current: TennisPoint, opponent: TennisPoint): TennisPoint {
  if (current === "AD") return current;
  if (current === 40) {
    if (opponent === 40) return "AD";
    if (opponent === "AD") return 40;
    return "WIN" as unknown as TennisPoint;
  }
  const idx = POINT_SEQUENCE.indexOf(current);
  return POINT_SEQUENCE[idx + 1] ?? 40;
}

function closeSet(sets: TennisSet[], current: TennisSet, bestOfSets: number): void {
  current.completed = true;
  const setsA = sets.filter((s) => s.completed && s.gamesA > s.gamesB).length;
  const setsB = sets.filter((s) => s.completed && s.gamesB > s.gamesA).length;
  const majority = Math.ceil(bestOfSets / 2);
  if (setsA < majority && setsB < majority) {
    sets.push({ gamesA: 0, gamesB: 0, completed: false });
  }
}

export function winPoint(state: TennisState, side: "A" | "B", rules: TennisRules = DEFAULT_RULES): TennisState {
  const sets = state.sets.map((s) => ({ ...s }));
  const current = sets[sets.length - 1];
  if (current.completed) return state;

  if (state.tiebreak) {
    const tb = { ...state.tiebreak };
    if (side === "A") tb.a++;
    else tb.b++;
    const needed = rules.tieBreakPoints ?? DEFAULT_TIEBREAK_POINTS;
    if (Math.max(tb.a, tb.b) >= needed && Math.abs(tb.a - tb.b) >= 2) {
      if (side === "A") current.gamesA++;
      else current.gamesB++;
      closeSet(sets, current, state.bestOfSets);
      return { sets, currentGame: { pointsA: 0, pointsB: 0 }, bestOfSets: state.bestOfSets };
    }
    return { sets, currentGame: state.currentGame, bestOfSets: state.bestOfSets, tiebreak: tb };
  }

  let { pointsA, pointsB } = state.currentGame;
  const scorer = side === "A" ? pointsA : pointsB;
  const other = side === "A" ? pointsB : pointsA;
  const advanced = advancePoint(scorer, other);

  if (advanced === ("WIN" as unknown as TennisPoint) || scorer === "AD") {
    if (side === "A") current.gamesA++;
    else current.gamesB++;
    pointsA = 0;
    pointsB = 0;

    const highGames = Math.max(current.gamesA, current.gamesB);
    const gameDiff = Math.abs(current.gamesA - current.gamesB);
    if (highGames >= rules.gamesPerSet && gameDiff >= 2) {
      closeSet(sets, current, state.bestOfSets);
    } else if (rules.tieBreakAtGames !== undefined && current.gamesA === rules.tieBreakAtGames && current.gamesB === rules.tieBreakAtGames) {
      return { sets, currentGame: { pointsA, pointsB }, bestOfSets: state.bestOfSets, tiebreak: { a: 0, b: 0 } };
    }
  } else if (side === "A") {
    pointsA = advanced;
  } else {
    pointsB = advanced;
  }

  return { sets, currentGame: { pointsA, pointsB }, bestOfSets: state.bestOfSets };
}

export function matchWinner(state: TennisState): "A" | "B" | null {
  const setsA = state.sets.filter((s) => s.completed && s.gamesA > s.gamesB).length;
  const setsB = state.sets.filter((s) => s.completed && s.gamesB > s.gamesA).length;
  const majority = Math.ceil(state.bestOfSets / 2);
  if (setsA >= majority) return "A";
  if (setsB >= majority) return "B";
  return null;
}
