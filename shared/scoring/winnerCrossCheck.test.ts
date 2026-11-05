import { describe, it, expect } from "vitest";
import { crossCheckWinner } from "./winnerCrossCheck";

describe("crossCheckWinner", () => {
  it("flags a SETS_POINTS submission that contradicts completed sets", () => {
    const state = {
      sets: [
        { a: 25, b: 20, completed: true },
        { a: 25, b: 18, completed: true },
      ],
      currentSet: 1,
    };
    const result = crossCheckWinner("SETS_POINTS", "SETS_POINTS", "volleyball", undefined, state, "B");
    expect(result.ok).toBe(false);
  });

  it("accepts a matching TENNIS_SETS_GAMES submission", () => {
    const state = {
      sets: [
        { gamesA: 6, gamesB: 3, completed: true },
        { gamesA: 6, gamesB: 4, completed: true },
      ],
      currentGame: { pointsA: 0, pointsB: 0 },
      bestOfSets: 3,
    };
    const result = crossCheckWinner("TENNIS_SETS_GAMES", "TENNIS_SETS_GAMES", "tennis", undefined, state, "A");
    expect(result.ok).toBe(true);
  });

  const cricket = (chaseRuns: number, overs = 10) => ({
    oversPerInnings: 10,
    battingFirst: "A",
    innings1: { runs: 150, wickets: 5, oversCompleted: 10, ballsInOver: 0, allOut: false },
    innings2: { runs: chaseRuns, wickets: 2, oversCompleted: overs, ballsInOver: 0, allOut: false },
    currentInnings: 2,
  });

  it("cross-checks CRICKET_INNINGS: setter wins when the chase ends short, mid-chase and a tie cannot be completed", () => {
    expect(crossCheckWinner("CRICKET_INNINGS", "CRICKET_INNINGS", "cricket", undefined, cricket(40), "B").ok).toBe(false);
    expect(crossCheckWinner("CRICKET_INNINGS", "CRICKET_INNINGS", "cricket", undefined, cricket(40), "A").ok).toBe(true);
    expect(crossCheckWinner("CRICKET_INNINGS", "CRICKET_INNINGS", "cricket", undefined, cricket(40, 4), "A").ok).toBe(false);
    expect(crossCheckWinner("CRICKET_INNINGS", "CRICKET_INNINGS", "cricket", undefined, cricket(150), "A").ok).toBe(false);
  });

  it("refuses a score completion when no score was recorded or the match is unfinished", () => {
    expect(crossCheckWinner("SETS_POINTS", "SETS_POINTS", "badminton", undefined, undefined, "A").ok).toBe(false);
    const oneSet = { sets: [{ a: 21, b: 10, completed: true }, { a: 0, b: 0, completed: false }], currentSet: 1 };
    expect(crossCheckWinner("SETS_POINTS", "SETS_POINTS", "badminton", undefined, oneSet, "A").ok).toBe(false);
    const running = { scoreA: 40, scoreB: 30, period: 2, overtime: false };
    expect(crossCheckWinner("BASKETBALL_POINTS", "BASKETBALL_POINTS", "basketball", undefined, running, "A").ok).toBe(false);
    expect(crossCheckWinner("BASKETBALL_POINTS", "BASKETBALL_POINTS", "basketball", undefined, { ...running, period: 4, ended: true }, "A").ok).toBe(true);
    expect(crossCheckWinner("RESULT_ONLY", "RESULT_ONLY", "chess", undefined, { outcome: "DRAW" }, "A").ok).toBe(false);
    expect(crossCheckWinner("RESULT_ONLY", "RESULT_ONLY", "chess", undefined, { outcome: "DRAW", tieBreakWinner: "A" }, "A").ok).toBe(true);
    const boards = { outcome: "B", boards: [{ a: 25, b: 10 }, { a: 12, b: 25 }, { a: 20, b: 25 }] };
    expect(crossCheckWinner("RESULT_ONLY", "RESULT_ONLY", "carrom", undefined, boards, "B").ok).toBe(true);
  });

  it("cross-checks FOOTBALL_EVENTS using the submitted penalties, and rejects a level game without them", () => {
    const goal = (id: string, side: "A" | "B") => ({ id, type: "GOAL", side, playerId: "p", minute: 1 });
    const level = { events: [goal("1", "A"), goal("2", "B")], ended: true };
    expect(crossCheckWinner("FOOTBALL_EVENTS", "FOOTBALL_EVENTS", "football", undefined, level, "A").ok).toBe(false);
    expect(crossCheckWinner("FOOTBALL_EVENTS", "FOOTBALL_EVENTS", "football", undefined, level, "A", { penalties: { a: 4, b: 3 } }).ok).toBe(true);
    expect(crossCheckWinner("FOOTBALL_EVENTS", "FOOTBALL_EVENTS", "football", undefined, level, "B", { penalties: { a: 4, b: 3 } }).ok).toBe(false);
  });

  it("rejects a level BASKETBALL_POINTS score and points to the admin override", () => {
    const r = crossCheckWinner("BASKETBALL_POINTS", "BASKETBALL_POINTS", "basketball", undefined, { scoreA: 80, scoreB: 80, period: 5, overtime: true }, "A");
    expect(r.ok).toBe(false);
  });

  it("skips the check for any decidedBy other than the scoring model itself", () => {
    const state = { scoreA: 10, scoreB: 90, period: 4, overtime: false };
    const result = crossCheckWinner("BASKETBALL_POINTS", "MANUAL_OVERRIDE", "basketball", undefined, state, "A");
    expect(result.ok).toBe(true);
  });
});
