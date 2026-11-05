export interface SetsPointsConfig {
  bestOf: number;
  pointsToWin: number;
  capPoints: number;
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

export function emptySetsPointsState(): SetsPointsState {
  return { sets: [{ a: 0, b: 0, completed: false }], currentSet: 0 };
}

function isSetWon(a: number, b: number, config: SetsPointsConfig): "A" | "B" | null {
  const leader = a > b ? "A" : b > a ? "B" : null;
  if (!leader) return null;
  const high = Math.max(a, b);
  const diff = Math.abs(a - b);
  if (high >= config.capPoints) return leader;
  if (high >= config.pointsToWin && diff >= 2) return leader;
  return null;
}

export function incrementPoint(
  state: SetsPointsState,
  side: "A" | "B",
  config: SetsPointsConfig
): SetsPointsState {
  const sets = state.sets.map((s) => ({ ...s }));
  const current = sets[state.currentSet];
  if (current.completed) return state;
  if (side === "A") current.a++;
  else current.b++;

  const winner = isSetWon(current.a, current.b, config);
  if (winner) {
    current.completed = true;
    const setsWonA = sets.filter((s) => s.completed && s.a > s.b).length;
    const setsWonB = sets.filter((s) => s.completed && s.b > s.a).length;
    const majority = Math.ceil(config.bestOf / 2);
    const matchOver = setsWonA >= majority || setsWonB >= majority;
    if (!matchOver) {
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
  if (target.completed) {
    if (!config) return state;
    const before = isSetWon(target.a, target.b, config);
    if (before === null || isSetWon(a, b, config) !== before) return state;
  }
  const sets = state.sets.map((s, i) => (i === setIndex ? { ...s, a, b } : { ...s }));
  return { sets, currentSet: state.currentSet };
}

export function matchWinner(state: SetsPointsState, config: SetsPointsConfig): "A" | "B" | null {
  const setsWonA = state.sets.filter((s) => s.completed && s.a > s.b).length;
  const setsWonB = state.sets.filter((s) => s.completed && s.b > s.a).length;
  const majority = Math.ceil(config.bestOf / 2);
  if (setsWonA >= majority) return "A";
  if (setsWonB >= majority) return "B";
  return null;
}

export function setsSummary(state: SetsPointsState): string {
  return state.sets
    .filter((s) => s.completed)
    .map((s) => `${s.a}-${s.b}`)
    .join(", ");
}
