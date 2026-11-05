import { describe, expect, it } from "vitest";
import { emptyTennisState, matchWinner as tennisWinner, tennisSummary, winPoint, type TennisRules, type TennisState } from "./tennis-sets-games";
import { emptySetsPointsState, incrementPoint, matchWinner as setsWinner, setTarget, type SetsPointsState } from "./sets-points";
import { addEvent, emptyFootballState, removeEvent, score } from "./football-events";
import { addBoard, emptyResultOnlyState, removeLastBoard } from "./result-only";
import { canEndMatch, emptyBasketballState, endMatch, addPoints } from "./basketball-points";
import { setsPointsConfigFrom, tennisRulesFrom } from "./fromMatchConfiguration";
import { resolveScoringModel, tryResolveScoringModel } from "./registry";
import { defaultMatchConfigurations, matchConfigurationSchema } from "../matchConfig";

const play = (state: TennisState, sides: string, rules?: TennisRules) =>
  [...sides].reduce((s, side) => winPoint(s, side as "A" | "B", rules), state);

describe("tennis scoring", () => {
  it("returns to deuce when the player without advantage wins the point", () => {
    let s = play(emptyTennisState(3), "AAABBB");
    s = play(s, "A");
    expect(s.currentGame).toEqual({ pointsA: "AD", pointsB: 40 });
    s = play(s, "B");
    expect(s.currentGame).toEqual({ pointsA: 40, pointsB: 40 });
    s = play(s, "BB");
    expect(s.sets[0].gamesB).toBe(1);
    expect(s.currentGame).toEqual({ pointsA: 0, pointsB: 0 });
  });

  it("decides the game on the deciding point with no-ad scoring", () => {
    const rules = { ...tennisRulesFrom(null), noAd: true };
    const s = play(emptyTennisState(3, rules), "AAABBBB", rules);
    expect(s.sets[0]).toMatchObject({ gamesA: 0, gamesB: 1 });
  });

  it("plays the deciding set as a 10-point match tie-break when configured", () => {
    const rules = tennisRulesFrom(defaultMatchConfigurations.tennis);
    const set = (side: "A" | "B") => "".padEnd(24, side);
    let s = play(emptyTennisState(3, rules), set("A") + set("B"), rules);
    expect(s.tiebreak).toEqual({ a: 0, b: 0, super: true });
    s = play(s, "AAAAAAAAABBBBBBBBB", rules);
    expect(tennisWinner(s)).toBe(null);
    s = play(s, "AA", rules);
    expect(tennisWinner(s)).toBe("A");
    expect(tennisSummary(s)).toBe("6-0, 0-6, [11-9]");
  });
});

describe("sets and points scoring", () => {
  const volleyball = setsPointsConfigFrom(defaultMatchConfigurations.volleyball, "volleyball");
  const tableTennis = setsPointsConfigFrom(defaultMatchConfigurations["table-tennis"], "table-tennis");
  const points = (state: SetsPointsState, side: "A" | "B", n: number, config = volleyball) => {
    for (let i = 0; i < n; i++) state = incrementPoint(state, side, config);
    return state;
  };

  it("plays the volleyball deciding set to 15", () => {
    let s = points(emptySetsPointsState(), "A", 25);
    s = points(s, "B", 25);
    expect(setTarget(volleyball, 2)).toEqual({ pointsToWin: 15, capPoints: undefined });
    s = points(s, "A", 15);
    expect(setsWinner(s, volleyball)).toBe("A");
  });

  it("keeps playing until a two-point lead when no cap is configured", () => {
    let s = emptySetsPointsState();
    for (let i = 0; i < 25; i++) {
      s = incrementPoint(s, "A", tableTennis);
      s = incrementPoint(s, "B", tableTennis);
    }
    expect(s.sets[0]).toMatchObject({ a: 25, b: 25, completed: false });
    s = points(s, "A", 2, tableTennis);
    expect(s.sets[0].completed).toBe(true);
  });

  it("ignores further points once the match is won", () => {
    const badminton = setsPointsConfigFrom(null, "badminton");
    let s = points(emptySetsPointsState(), "A", 21, badminton);
    s = points(s, "A", 21, badminton);
    expect(setsWinner(s, badminton)).toBe("A");
    expect(incrementPoint(s, "B", badminton)).toBe(s);
  });
});

describe("football events", () => {
  const event = (id: string, type: "GOAL" | "OWN_GOAL" | "PENALTY_GOAL" | "YELLOW_CARD", side: "A" | "B", playerId = "p1") => ({ id, type, side, playerId, minute: 10 });

  it("credits own goals to the opponent and counts penalty goals", () => {
    let s = addEvent(emptyFootballState(), event("1", "OWN_GOAL", "A"));
    s = addEvent(s, event("2", "PENALTY_GOAL", "A"));
    expect(score(s)).toEqual({ a: 1, b: 1 });
  });

  it("turns a second yellow into a red card and removes both together", () => {
    let s = addEvent(emptyFootballState(), event("1", "YELLOW_CARD", "B"));
    s = addEvent(s, event("2", "YELLOW_CARD", "B"));
    expect(s.events.map((e) => e.type)).toEqual(["YELLOW_CARD", "YELLOW_CARD", "RED_CARD"]);
    expect(removeEvent(s, "2").events).toHaveLength(1);
    const unknown = addEvent(addEvent(emptyFootballState(), event("3", "YELLOW_CARD", "A", "unknown")), event("4", "YELLOW_CARD", "A", "unknown"));
    expect(unknown.events).toHaveLength(2);
  });
});

describe("boards and basketball completion", () => {
  it("decides carrom on boards won and ignores level boards", () => {
    let s = addBoard(emptyResultOnlyState(), { a: 25, b: 10 }, 3);
    s = addBoard(s, { a: 12, b: 12 }, 3);
    expect(s.outcome).toBe(null);
    s = addBoard(s, { a: 25, b: 20 }, 3);
    expect(s.outcome).toBe("A");
    expect(removeLastBoard(s, 3).outcome).toBe(null);
  });

  it("only lets basketball end after regulation with a non-level score", () => {
    const config = { quarters: 4 };
    const s = addPoints(emptyBasketballState(), "A", 2);
    expect(canEndMatch(s, config)).toBe(false);
    const late = { ...s, period: 4 };
    expect(canEndMatch(late, config)).toBe(true);
    expect(endMatch(late, config)).toMatchObject({ ended: true, periodEnds: [{ a: 2, b: 0 }] });
    expect(addPoints(endMatch(late, config), "B", 3)).toMatchObject({ scoreB: 0 });
  });
});

describe("rule validation and resolution", () => {
  it("rejects even best-of counts and caps below the winning score", () => {
    const base = defaultMatchConfigurations.badminton!;
    expect(matchConfigurationSchema.safeParse(base).success).toBe(true);
    expect(matchConfigurationSchema.safeParse({ ...base, structure: { ...base.structure, bestOf: 2 } }).success).toBe(false);
    expect(matchConfigurationSchema.safeParse({ ...base, structure: { ...base.structure, capPoints: 20 } }).success).toBe(false);
  });

  it("accepts every bundled template", () => {
    for (const config of Object.values(defaultMatchConfigurations)) {
      expect(matchConfigurationSchema.safeParse(config).success).toBe(true);
    }
  });

  it("uses the sport's registered scoring model for sports outside the built-in list", () => {
    const fixture = { sportId: "kabaddi" };
    expect(resolveScoringModel(fixture, { scoringModel: "BASKETBALL_POINTS" })).toBe("BASKETBALL_POINTS");
    expect(tryResolveScoringModel(fixture, null)).toBe(null);
  });
});
