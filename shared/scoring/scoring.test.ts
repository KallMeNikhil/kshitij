import { describe, it, expect } from "vitest";
import { emptySetsPointsState, incrementPoint, correctPoint, matchWinner as setsMatchWinner } from "./sets-points";
import { emptyCricketState, target, runsRequired, computeResult, recordBall, isMatchOver, battingFirstFromToss } from "./cricket-innings";
import { emptyTennisState, winPoint } from "./tennis-sets-games";
import { emptyBasketballState, addPoints, decideWinner as bbWinner } from "./basketball-points";
import { emptyFootballState, addEvent, score, decideWinner as fbWinner } from "./football-events";

const badmintonConfig = { bestOf: 3, pointsToWin: 21, capPoints: 30 };

describe("sets-points (badminton/TT/volleyball)", () => {
  it("wins a set at 21 with 2-point lead and the match at 2 sets", () => {
    let state = emptySetsPointsState();
    for (let i = 0; i < 21; i++) state = incrementPoint(state, "A", badmintonConfig);
    expect(state.sets[0].completed).toBe(true);
    expect(state.sets).toHaveLength(2);
    for (let i = 0; i < 21; i++) state = incrementPoint(state, "A", badmintonConfig);
    expect(setsMatchWinner(state, badmintonConfig)).toBe("A");
  });

  it("requires deuce (2-clear) below the cap", () => {
    let state = emptySetsPointsState();
    for (let i = 0; i < 20; i++) state = incrementPoint(state, "A", badmintonConfig);
    for (let i = 0; i < 20; i++) state = incrementPoint(state, "B", badmintonConfig);
    state = incrementPoint(state, "A", badmintonConfig);
    expect(state.sets[0].completed).toBe(false);
    state = incrementPoint(state, "A", badmintonConfig);
    expect(state.sets[0].completed).toBe(true);
  });

  it("caps the set at 30 even without a 2-point lead", () => {
    let state = emptySetsPointsState();
    for (let i = 0; i < 29; i++) {
      state = incrementPoint(state, "A", badmintonConfig);
      state = incrementPoint(state, "B", badmintonConfig);
    }
    state = incrementPoint(state, "A", badmintonConfig);
    expect(state.sets[0].completed).toBe(true);
    expect(state.sets[0].a).toBe(30);
  });
});

describe("cricket-innings", () => {
  const chasing = (runs1: number) => {
    const state = emptyCricketState(20, "A");
    state.innings1.runs = runs1;
    state.currentInnings = 2;
    return state;
  };

  it("computes target as innings1 runs + 1 once the chase begins", () => {
    const state = emptyCricketState(20, "A");
    state.innings1.runs = 150;
    expect(target(state)).toBe(null);
    expect(target(chasing(150))).toBe(151);
  });

  it("computes runs required for the chase", () => {
    const state = chasing(150);
    state.innings2.runs = 100;
    expect(runsRequired(state)).toBe(51);
  });

  it("declares the chaser winner by wickets when target is reached", () => {
    const state = chasing(150);
    state.innings2.runs = 151;
    state.innings2.wickets = 4;
    const result = computeResult(state);
    expect(result.winner).toBe("B");
    expect(result.margin).toBe("by 6 wickets");
  });

  it("does not declare a winner while the chase is still on", () => {
    const state = chasing(150);
    state.innings2.runs = 120;
    expect(computeResult(state).winner).toBe(null);
    state.innings2.runs = 150;
    expect(computeResult(state).winner).toBe(null);
  });

  it("declares the setter winner by runs once the chase ends short", () => {
    const state = chasing(150);
    state.innings2.runs = 120;
    state.innings2.oversCompleted = 20;
    const result = computeResult(state);
    expect(result.winner).toBe("A");
    expect(result.margin).toBe("by 30 runs");
  });

  it("declares a tie when scores are level after both innings", () => {
    const state = chasing(150);
    state.innings2.runs = 150;
    state.innings2.wickets = 10;
    expect(computeResult(state).winner).toBe("TIE");
  });

  it("counts extras without using up legal balls and ends innings automatically", () => {
    let state = emptyCricketState(1, "B");
    state = recordBall(state, { extra: "WIDE" });
    state = recordBall(state, { extra: "NO_BALL", runs: 4 });
    expect(state.innings1).toMatchObject({ runs: 6, extras: 2, ballsInOver: 0 });
    state = recordBall(state, { extra: "LEG_BYE", runs: 1 });
    expect(state.innings1).toMatchObject({ runs: 7, extras: 3, ballsInOver: 1 });
    for (let i = 0; i < 5; i++) state = recordBall(state, { runs: 1 });
    expect(state.currentInnings).toBe(2);
    expect(state.innings1).toMatchObject({ runs: 12, oversCompleted: 1 });
    state = recordBall(state, { runs: 6 });
    state = recordBall(state, { runs: 6 });
    state = recordBall(state, { runs: 1 });
    expect(isMatchOver(state)).toBe(true);
    expect(computeResult(state)).toEqual({ winner: "A", margin: "by 10 wickets" });
    expect(recordBall(state, { runs: 4 })).toBe(state);
  });

  it("closes the innings on the last wicket and derives batting order from the toss", () => {
    expect(battingFirstFromToss({ winner: "A", decision: "BOWL" })).toBe("B");
    let state = emptyCricketState(10, "A");
    for (let i = 0; i < 2; i++) state = recordBall(state, { wicket: true }, 2);
    expect(state.innings1.allOut).toBe(true);
    expect(state.currentInnings).toBe(2);
  });
});

describe("tennis-sets-games", () => {
  it("wins a game from deuce via advantage", () => {
    let state = emptyTennisState(3);
    for (let i = 0; i < 3; i++) {
      state = winPoint(state, "A");
      state = winPoint(state, "B");
    }
    state = winPoint(state, "A");
    state = winPoint(state, "A");
    expect(state.sets[0].gamesA).toBe(1);
  });

  it("wins a set 6-4 via outright (non-deuce) games", () => {
    let state = emptyTennisState(3);
    const winGameOutright = (s: typeof state, side: "A" | "B") => {
      for (let i = 0; i < 4; i++) s = winPoint(s, side);
      return s;
    };
    for (let g = 0; g < 4; g++) {
      state = winGameOutright(state, "A");
      state = winGameOutright(state, "B");
    }
    state = winGameOutright(state, "A");
    state = winGameOutright(state, "A");
    expect(state.sets[0].gamesA).toBe(6);
    expect(state.sets[0].gamesB).toBe(4);
    expect(state.sets[0].completed).toBe(true);
  });

  it("requires a 2-clear win, not just reaching 6", () => {
    let state = emptyTennisState(3);
    const winGameOutright = (s: typeof state, side: "A" | "B") => {
      for (let i = 0; i < 4; i++) s = winPoint(s, side);
      return s;
    };
    for (let g = 0; g < 5; g++) state = winGameOutright(state, "A");
    for (let g = 0; g < 5; g++) state = winGameOutright(state, "B");
    expect(state.sets[0].completed).toBe(false);
    state = winGameOutright(state, "A");
    expect(state.sets[0].completed).toBe(false);
    state = winGameOutright(state, "A");
    expect(state.sets[0].completed).toBe(true);
    expect(state.sets[0].gamesA).toBe(7);
  });
});

describe("basketball-points", () => {
  it("adds 1/2/3 point baskets and derives the leader", () => {
    let state = emptyBasketballState();
    state = addPoints(state, "A", 3);
    state = addPoints(state, "A", 2);
    state = addPoints(state, "B", 2);
    expect(state.scoreA).toBe(5);
    expect(bbWinner(state)).toBe("A");
  });
});

describe("football-events", () => {
  it("derives score from GOAL events only", () => {
    let state = emptyFootballState();
    state = addEvent(state, { id: "e1", type: "GOAL", side: "A", playerId: "p1", minute: 12 });
    state = addEvent(state, { id: "e2", type: "YELLOW_CARD", side: "B", playerId: "p2", minute: 30 });
    state = addEvent(state, { id: "e3", type: "GOAL", side: "A", playerId: "p1", minute: 55 });
    expect(score(state)).toEqual({ a: 2, b: 0 });
    expect(fbWinner(state)).toBe("A");
  });
});

describe("basketball period model", () => {
  const config = { quarters: 4, periodLabel: "QUARTER" as const };

  it("records the cumulative score at the end of each period and derives per-period scores", async () => {
    const { emptyBasketballState, addPoints, advancePeriod, periodScores } = await import("./basketball-points");
    let s = addPoints(addPoints(emptyBasketballState(), "A", 3), "B", 2);
    s = advancePeriod(s, config);
    s = addPoints(s, "A", 2);
    s = advancePeriod(s, config);
    expect(s.period).toBe(3);
    expect(periodScores(s)).toEqual([
      { period: 1, a: 3, b: 2 },
      { period: 2, a: 2, b: 0 },
    ]);
  });

  it("goes into overtime after the configured number of periods and names them", async () => {
    const { emptyBasketballState, setPeriod, periodName } = await import("./basketball-points");
    let s = emptyBasketballState();
    for (let i = 0; i < 4; i++) s = setPeriod(s, s.period + 1, config);
    expect(s.period).toBe(5);
    expect(s.overtime).toBe(true);
    expect(periodName(5, config)).toBe("Overtime");
    expect(periodName(6, config)).toBe("Overtime 2");
    expect(periodName(2, { quarters: 2, periodLabel: "HALF" })).toBe("Half 2");
  });

  it("stepping back truncates recorded period ends and restores regulation play", async () => {
    const { emptyBasketballState, setPeriod } = await import("./basketball-points");
    let s = emptyBasketballState();
    for (let i = 0; i < 4; i++) s = setPeriod(s, s.period + 1, config);
    s = setPeriod(s, 3, config);
    expect(s.period).toBe(3);
    expect(s.overtime).toBe(false);
    expect(s.periodEnds).toHaveLength(2);
  });

  it("cannot skip ahead more than one period and the state schema accepts periodEnds", async () => {
    const { emptyBasketballState, setPeriod, advancePeriod } = await import("./basketball-points");
    const { validateLiveState } = await import("./stateSchemas");
    expect(setPeriod(emptyBasketballState(), 4, config).period).toBe(2);
    const state = advancePeriod(emptyBasketballState(), config);
    expect(validateLiveState("BASKETBALL_POINTS", state).ok).toBe(true);
    expect(validateLiveState("BASKETBALL_POINTS", { ...state, periodEnds: [{ a: -1, b: 0 }] }).ok).toBe(false);
  });
});

describe("configurable scoring rules", () => {
  const game = (s: ReturnType<typeof emptyTennisState>, side: "A" | "B", rules?: Parameters<typeof winPoint>[2]) => {
    for (let i = 0; i < 4; i++) s = winPoint(s, side, rules);
    return s;
  };

  it("tennis plays a tie-break at the configured games-all and completes the set 7-6", () => {
    const rules = { gamesPerSet: 6, tieBreakAtGames: 6, tieBreakPoints: 7 };
    let s = emptyTennisState(3);
    for (let g = 0; g < 5; g++) { s = game(s, "A", rules); s = game(s, "B", rules); }
    s = game(s, "A", rules);
    s = game(s, "B", rules);
    expect(s.tiebreak).toEqual({ a: 0, b: 0 });
    for (let i = 0; i < 7; i++) s = winPoint(s, "A", rules);
    expect(s.tiebreak).toBeUndefined();
    expect(s.sets[0]).toEqual({ gamesA: 7, gamesB: 6, completed: true, tiebreakA: 7, tiebreakB: 0 });
  });

  it("tennis tie-break needs a 2-point margin", () => {
    const rules = { gamesPerSet: 6, tieBreakAtGames: 6 };
    let s = emptyTennisState(3);
    for (let g = 0; g < 6; g++) { s = game(s, "A", rules); s = game(s, "B", rules); }
    for (let i = 0; i < 6; i++) { s = winPoint(s, "A", rules); s = winPoint(s, "B", rules); }
    s = winPoint(s, "A", rules);
    expect(s.sets[0].completed).toBe(false);
    s = winPoint(s, "A", rules);
    expect(s.sets[0].completed).toBe(true);
  });

  it("cricket result uses the configured wicket count", () => {
    const state = emptyCricketState(20, "A");
    state.currentInnings = 2;
    state.innings1.runs = 100;
    state.innings2.runs = 101;
    state.innings2.wickets = 4;
    expect(computeResult(state, 11).margin).toContain("7 wicket");
  });

  it("correctPoint refuses to flip a completed set's winner but allows a harmless correction", () => {
    const cfg = { bestOf: 3, pointsToWin: 21, capPoints: 30 };
    const s = { sets: [{ a: 25, b: 10, completed: true }, { a: 3, b: 2, completed: false }], currentSet: 1 };
    expect(correctPoint(s, "A", -1, cfg, 0).sets[0].a).toBe(24);
    expect(correctPoint({ ...s, sets: [{ a: 21, b: 19, completed: true }, s.sets[1]] }, "A", -1, cfg, 0)).toEqual({ ...s, sets: [{ a: 21, b: 19, completed: true }, s.sets[1]] });
    expect(correctPoint(s, "B", -1).sets[1].b).toBe(1);
  });
});
