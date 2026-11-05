export interface SetsPointsConfig {
  bestOf: number;
  pointsToWin: number;
  capPoints?: number;
  setPoints?: number[];
  decidingSet?: { pointsToWin: number; capPoints?: number };
}

export interface SetScore {
  a: number;
  b: number;
  completed: boolean;
}

export interface SetsPointsState {
  sets: SetScore[];
  currentSet: number;
}

export interface SetTarget {
  pointsToWin: number;
  capPoints?: number;
}

export function emptySetsPointsState(): SetsPointsState {
  return { sets: [{ a: 0, b: 0, completed: false }], currentSet: 0 };
}

export function isDecidingSet(config: SetsPointsConfig, setIndex: number): boolean {
  return config.bestOf > 1 && setIndex === config.bestOf - 1;
}

export function setTarget(config: SetsPointsConfig, setIndex: number): SetTarget {
  const deciding = isDecidingSet(config, setIndex) && config.decidingSet;
  const pointsToWin = config.setPoints?.[setIndex] ?? (deciding ? config.decidingSet!.pointsToWin : config.pointsToWin);
  const cap = deciding ? config.decidingSet!.capPoints : config.capPoints;
  return { pointsToWin, capPoints: cap !== undefined && cap > pointsToWin ? cap : undefined };
}

export function setWinner(a: number, b: number, target: SetTarget): "A" | "B" | null {
  const leader = a > b ? "A" : b > a ? "B" : null;
  if (!leader) return null;
  const high = Math.max(a, b);
  if (target.capPoints !== undefined && high >= target.capPoints) return leader;
  if (high >= target.pointsToWin && Math.abs(a - b) >= 2) return leader;
  return null;
}

function setsWon(sets: SetScore[]): { a: number; b: number } {
  return {
    a: sets.filter((s) => s.completed && s.a > s.b).length,
    b: sets.filter((s) => s.completed && s.b > s.a).length,
  };
}

export function incrementPoint(state: SetsPointsState, side: "A" | "B", config: SetsPointsConfig): SetsPointsState {
  if (matchWinner(state, config)) return state;
  const sets = state.sets.map((s) => ({ ...s }));
  const current = sets[state.currentSet];
  if (!current || current.completed) return state;
  if (side === "A") current.a++;
  else current.b++;

  if (setWinner(current.a, current.b, setTarget(config, state.currentSet))) {
    current.completed = true;
    const won = setsWon(sets);
    const majority = Math.ceil(config.bestOf / 2);
    if (won.a < majority && won.b < majority) {
      sets.push({ a: 0, b: 0, completed: false });
      return { sets, currentSet: sets.length - 1 };
    }
  }
  return { sets, currentSet: state.currentSet };
}

export function correctPoint(
  state: SetsPointsState,
  side: "A" | "B",
  delta: -1 | 1,
  config?: SetsPointsConfig,
  setIndex: number = state.currentSet
): SetsPointsState {
  const target = state.sets[setIndex];
  if (!target) return state;
  const a = side === "A" ? Math.max(0, target.a + delta) : target.a;
  const b = side === "B" ? Math.max(0, target.b + delta) : target.b;
  if (a === target.a && b === target.b) return state;
  if (config) {
    const rule = setTarget(config, setIndex);
    const before = target.completed ? setWinner(target.a, target.b, rule) : null;
    const after = setWinner(a, b, rule);
    if (target.completed && (before === null || after !== before)) return state;
    if (!target.completed && after !== null) return state;
  } else if (target.completed) {
    return state;
  }
  const sets = state.sets.map((s, i) => (i === setIndex ? { ...s, a, b } : { ...s }));
  return { sets, currentSet: state.currentSet };
}

export function matchWinner(state: SetsPointsState, config: SetsPointsConfig): "A" | "B" | null {
  const won = setsWon(state.sets);
  const majority = Math.ceil(config.bestOf / 2);
  if (won.a >= majority) return "A";
  if (won.b >= majority) return "B";
  return null;
}

export function setsSummary(state: SetsPointsState): string {
  return state.sets
    .filter((s) => s.completed)
    .map((s) => `${s.a}-${s.b}`)
    .join(", ");
}
