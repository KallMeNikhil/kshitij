export type FootballEventType = "GOAL" | "PENALTY_GOAL" | "OWN_GOAL" | "YELLOW_CARD" | "RED_CARD";

export const UNKNOWN_PLAYER = "unknown";

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
  ended?: boolean;
}

export function emptyFootballState(): FootballState {
  return { events: [] };
}

export function addEvent(state: FootballState, event: FootballEvent): FootballState {
  const events = [...state.events, event];
  if (event.type === "YELLOW_CARD" && event.playerId !== UNKNOWN_PLAYER) {
    const yellows = state.events.filter((e) => e.type === "YELLOW_CARD" && e.side === event.side && e.playerId === event.playerId).length;
    const alreadyRed = state.events.some((e) => e.type === "RED_CARD" && e.side === event.side && e.playerId === event.playerId);
    if (yellows === 1 && !alreadyRed) {
      events.push({ ...event, id: `${event.id}-red`, type: "RED_CARD" });
    }
  }
  return { ...state, events };
}

export function removeEvent(state: FootballState, eventId: string): FootballState {
  return { ...state, events: state.events.filter((e) => e.id !== eventId && e.id !== `${eventId}-red`) };
}

export function goalFor(event: FootballEvent): "A" | "B" | null {
  if (event.type === "GOAL" || event.type === "PENALTY_GOAL") return event.side;
  if (event.type === "OWN_GOAL") return event.side === "A" ? "B" : "A";
  return null;
}

export function score(state: FootballState): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const e of state.events) {
    const side = goalFor(e);
    if (side === "A") a++;
    else if (side === "B") b++;
  }
  return { a, b };
}

export function cardsFor(state: FootballState, side: "A" | "B") {
  return {
    yellow: state.events.filter((e) => e.type === "YELLOW_CARD" && e.side === side),
    red: state.events.filter((e) => e.type === "RED_CARD" && e.side === side),
  };
}

export function decideWinner(state: FootballState): "A" | "B" | "DRAW" {
  const s = score(state);
  if (s.a > s.b) return "A";
  if (s.b > s.a) return "B";
  if (state.penalties) {
    if (state.penalties.a > state.penalties.b) return "A";
    if (state.penalties.b > state.penalties.a) return "B";
  }
  return "DRAW";
}
