export type FootballEventType = "GOAL" | "YELLOW_CARD" | "RED_CARD";

export interface FootballEvent {
  id: string;
  type: FootballEventType;
  side: "A" | "B";
  playerId: string;
  minute: number;
}

export interface FootballState {
  events: FootballEvent[];
  penalties?: { a: number; b: number };
}

export function emptyFootballState(): FootballState {
  return { events: [] };
}

export function addEvent(state: FootballState, event: FootballEvent): FootballState {
  return { ...state, events: [...state.events, event] };
}

export function removeEvent(state: FootballState, eventId: string): FootballState {
  return { ...state, events: state.events.filter((e) => e.id !== eventId) };
}

export function score(state: FootballState): { a: number; b: number } {
  const a = state.events.filter((e) => e.type === "GOAL" && e.side === "A").length;
  const b = state.events.filter((e) => e.type === "GOAL" && e.side === "B").length;
  return { a, b };
}

export function cardsFor(state: FootballState, side: "A" | "B") {
  return {
    yellow: state.events.filter((e) => e.type === "YELLOW_CARD" && e.side === side),
    red: state.events.filter((e) => e.type === "RED_CARD" && e.side === side),
  };
}

export function decideWinner(state: FootballState): "A" | "B" | "DRAW" | null {
  const s = score(state);
  if (s.a > s.b) return "A";
  if (s.b > s.a) return "B";
  if (state.penalties) {
    if (state.penalties.a > state.penalties.b) return "A";
    if (state.penalties.b > state.penalties.a) return "B";
  }
  return s.a === s.b ? "DRAW" : null;
}
