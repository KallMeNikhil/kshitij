import { describe, expect, it } from "vitest";
import { groupFixtures } from "./fixtureGroups";
import { downstreamStarted, needsAction, suspendedFixtures } from "./needsAction";
import { compactScore } from "./scoreSummary";
import { placeholderLabel } from "./matchLabels";
import { COL_GUTTER, COL_W, MATCH_H, forwardChain, layoutRounds } from "./bracketLayout";
import { emptySetsPointsState } from "../../shared/scoring/sets-points";
import { emptyCricketState } from "../../shared/scoring/cricket-innings";
import { addEvent, emptyFootballState } from "../../shared/scoring/football-events";
import { emptyBasketballState } from "../../shared/scoring/basketball-points";
import { emptyTennisState } from "../../shared/scoring/tennis-sets-games";
import type { FixtureDoc, FixtureStatus, MatchStateDoc, Slot } from "../../shared/types";

const entrant = (id: string): Slot => ({ kind: "PARTICIPANT", participantId: id });

function fixture(over: Partial<FixtureDoc> & { fixtureId: string }): FixtureDoc {
  return {
    competitionId: "c1",
    sportId: "badminton",
    round: 1,
    matchNumber: 1,
    slotA: entrant("a"),
    slotB: entrant("b"),
    status: "SCHEDULED" as FixtureStatus,
    ...over,
  } as FixtureDoc;
}

const state = (data: object): MatchStateDoc => ({ fixtureId: "f", version: 1, data } as unknown as MatchStateDoc);

describe("groupFixtures", () => {
  it("puts live first, groups pending by day, keeps postponed and cancelled inline, and orders results newest round first", () => {
    const fixtures = [
      fixture({ fixtureId: "done1", status: "COMPLETED", round: 1 }),
      fixture({ fixtureId: "done2", status: "COMPLETED", round: 2 }),
      fixture({ fixtureId: "live", status: "LIVE" }),
      fixture({ fixtureId: "d2", scheduledDate: "2026-10-05", scheduledTime: "10:00" }),
      fixture({ fixtureId: "d1b", scheduledDate: "2026-10-04", scheduledTime: "14:00" }),
      fixture({ fixtureId: "d1a", scheduledDate: "2026-10-04", scheduledTime: "09:00" }),
      fixture({ fixtureId: "post", status: "POSTPONED" }),
      fixture({ fixtureId: "canc", status: "CANCELLED", scheduledDate: "2026-10-04", scheduledTime: "16:00" }),
    ];
    const g = groupFixtures(fixtures);
    expect(g.live.map((f) => f.fixtureId)).toEqual(["live"]);
    expect(g.completed.map((f) => f.fixtureId)).toEqual(["done2", "done1"]);
    expect(g.upNext.map((d) => d.key)).toEqual(["2026-10-04", "2026-10-05", "unscheduled"]);
    expect(g.upNext[0].fixtures.map((f) => f.fixtureId)).toEqual(["d1a", "d1b", "canc"]);
    expect(g.upNext[2].fixtures.map((f) => f.fixtureId)).toEqual(["post"]);
    expect(g.upNextCount).toBe(5);
  });
});

describe("needsAction", () => {
  const now = new Date("2026-10-04T12:00:00");
  it("flags overdue, unscheduled-with-both-entrants and progression blocked by a cancelled match, and ignores unready fixtures", () => {
    const items = needsAction(
      [
        fixture({ fixtureId: "overdue", scheduledDate: "2026-10-04", scheduledTime: "09:00" }),
        fixture({ fixtureId: "unsched" }),
        fixture({ fixtureId: "future", scheduledDate: "2026-10-04", scheduledTime: "18:00" }),
        fixture({ fixtureId: "tbd", slotB: { kind: "FIXTURE_WINNER", fromFixtureId: "x" } }),
        fixture({ fixtureId: "post", status: "POSTPONED" }),
        fixture({ fixtureId: "canc", status: "CANCELLED", nextFixtureId: "next" }),
        fixture({ fixtureId: "next", round: 2, slotA: { kind: "FIXTURE_WINNER", fromFixtureId: "canc" }, slotB: entrant("z") }),
        fixture({ fixtureId: "live", status: "LIVE" }),
      ],
      now
    );
    expect(items.map((i) => [i.fixture.fixtureId, i.kind])).toEqual([
      ["overdue", "OVERDUE"],
      ["next", "BLOCKED"],
      ["unsched", "UNSCHEDULED"],
    ]);
  });

  it("does not flag a downstream match whose feeder was merely postponed", () => {
    const items = needsAction(
      [
        fixture({ fixtureId: "post", status: "POSTPONED", nextFixtureId: "next" }),
        fixture({ fixtureId: "next", round: 2, slotA: { kind: "FIXTURE_WINNER", fromFixtureId: "post" }, slotB: entrant("z") }),
      ],
      now
    );
    expect(items.every((i) => i.kind !== "BLOCKED")).toBe(true);
  });
});

describe("suspendedFixtures", () => {
  it("lists postponed before cancelled, each in bracket order", () => {
    const list = suspendedFixtures([
      fixture({ fixtureId: "c2", status: "CANCELLED", matchNumber: 2 }),
      fixture({ fixtureId: "p2", status: "POSTPONED", matchNumber: 2 }),
      fixture({ fixtureId: "p1", status: "POSTPONED", matchNumber: 1 }),
      fixture({ fixtureId: "s", status: "SCHEDULED" }),
    ]);
    expect(list.map((f) => f.fixtureId)).toEqual(["p1", "p2", "c2"]);
  });
});

describe("downstreamStarted", () => {
  it("is true when a later match is live or genuinely completed, false for BYE scaffolding", () => {
    const base = [
      fixture({ fixtureId: "r1", nextFixtureId: "r2" }),
      fixture({ fixtureId: "r2", round: 2, nextFixtureId: "r3", status: "SCHEDULED" }),
      fixture({ fixtureId: "r3", round: 3, status: "SCHEDULED" }),
    ];
    expect(downstreamStarted(base, "r1")).toBe(false);
    const live = base.map((f) => (f.fixtureId === "r3" ? { ...f, status: "LIVE" as FixtureStatus } : f));
    expect(downstreamStarted(live, "r1")).toBe(true);
    const byeScaffold = base.map((f) =>
      f.fixtureId === "r2" ? { ...f, status: "COMPLETED" as FixtureStatus, slotB: { kind: "BYE" } as Slot } : f
    );
    expect(downstreamStarted(byeScaffold, "r1")).toBe(false);
  });
});

describe("compactScore", () => {
  it("summarises a live sets match with the current set and sets won", () => {
    const s = emptySetsPointsState();
    s.sets = [
      { a: 21, b: 15, completed: true },
      { a: 7, b: 9, completed: false },
    ];
    s.currentSet = 1;
    expect(compactScore("SETS_POINTS", state(s))).toEqual({ a: "7", b: "9", sub: "Set 2 · sets 1-0" });
    expect(compactScore("SETS_POINTS", state(s), true)?.a).toBe("1");
  });

  it("maps cricket runs to the correct side whoever bats first", () => {
    const s = emptyCricketState(20, "B");
    s.innings1 = { runs: 98, wickets: 6, oversCompleted: 20, ballsInOver: 0, allOut: false };
    s.innings2 = { runs: 40, wickets: 2, oversCompleted: 6, ballsInOver: 2, allOut: false };
    s.currentInnings = 2;
    const out = compactScore("CRICKET_INNINGS", state(s));
    expect(out).toEqual({ a: "40/2", b: "98/6", sub: "Innings 2 · 6.2 ov" });
  });

  it("counts football goals per side and shows penalties", () => {
    let s = addEvent(emptyFootballState(), { id: "1", type: "GOAL", side: "A", playerId: "p", minute: 3 });
    s = addEvent(s, { id: "2", type: "YELLOW_CARD", side: "B", playerId: "q", minute: 9 });
    expect(compactScore("FOOTBALL_EVENTS", state(s))).toEqual({ a: "1", b: "0", sub: undefined });
    expect(compactScore("FOOTBALL_EVENTS", state({ ...s, penalties: { a: 4, b: 3 } }))?.sub).toBe("Penalties 4-3");
  });

  it("reports basketball period or overtime", () => {
    const s = { ...emptyBasketballState(), scoreA: 12, scoreB: 10 };
    expect(compactScore("BASKETBALL_POINTS", state(s))).toEqual({ a: "12", b: "10", sub: "Quarter 1" });
    expect(compactScore("BASKETBALL_POINTS", state({ ...s, period: 5, overtime: true }))?.sub).toBe("Overtime");
  });

  it("shows tennis current games and point", () => {
    const s = emptyTennisState(3);
    expect(compactScore("TENNIS_SETS_GAMES", state(s))).toEqual({ a: "0", b: "0", sub: "Set 1 · 0-0" });
  });

  it("returns null without a state and for result-only sports", () => {
    expect(compactScore("SETS_POINTS", null)).toBeNull();
    expect(compactScore("RESULT_ONLY", state({}))).toBeNull();
  });
});

describe("placeholderLabel", () => {
  const feeder = fixture({ fixtureId: "f1", matchNumber: 3 });
  it("names the feeder match", () => {
    expect(placeholderLabel({ kind: "FIXTURE_WINNER", fromFixtureId: "f1" }, [feeder])).toBe("Winner of Match 3");
    expect(placeholderLabel({ kind: "FIXTURE_WINNER", fromFixtureId: "missing" }, [feeder])).toBe("Winner of previous match");
    expect(placeholderLabel({ kind: "BYE" }, null)).toBe("BYE");
    expect(placeholderLabel({ kind: "TBD" }, null)).toBe("To be decided");
  });
});

describe("bracket layout", () => {
  const f = [
    fixture({ fixtureId: "a", round: 1, matchNumber: 1, nextFixtureId: "c" }),
    fixture({ fixtureId: "b", round: 1, matchNumber: 2, nextFixtureId: "c" }),
    fixture({ fixtureId: "c", round: 2, matchNumber: 3 }),
  ];
  it("centres a later-round node between its feeders", () => {
    const layout = layoutRounds(f, [1, 2]);
    const [a, b] = layout.get(1)!;
    const [c] = layout.get(2)!;
    expect(c.y).toBe((a.y + b.y) / 2);
    expect(b.y - a.y).toBeGreaterThan(MATCH_H);
  });
  it("walks the forward chain for path highlighting", () => {
    expect([...forwardChain(f, "a")]).toEqual(["a", "c"]);
    expect(forwardChain(f, null).size).toBe(0);
  });
  it("uses a column geometry that leaves room for connectors", () => {
    expect(COL_GUTTER).toBeGreaterThan(0);
    expect(COL_W).toBeGreaterThan(MATCH_H);
  });
});
