import { describe, it, expect } from "vitest";
import { generateBracket, isGenerationOnlyFixture, propagateWinner, seedOrder } from "./bracket";
import type { Entrant } from "./bracket";

function entrants(n: number): Entrant[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, kind: "PARTICIPANT" as const }));
}

describe("seedOrder", () => {
  it("produces the standard doubling seed order for size 8", () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

describe("generateBracket: power of two", () => {
  it("builds 3 rounds for 8 entrants with no byes", () => {
    const { fixtures } = generateBracket("badminton-mens-singles", "badminton", entrants(8));
    expect(fixtures.filter((f) => f.round === 1)).toHaveLength(4);
    expect(fixtures.filter((f) => f.round === 2)).toHaveLength(2);
    expect(fixtures.filter((f) => f.round === 3)).toHaveLength(1);
    expect(fixtures.some((f) => f.slotA.kind === "BYE" || f.slotB.kind === "BYE")).toBe(false);
  });

  it("links nextFixtureId/nextSlot correctly round to round", () => {
    const { fixtures } = generateBracket("badminton-mens-singles", "badminton", entrants(4));
    const r1 = fixtures.filter((f) => f.round === 1);
    const final = fixtures.find((f) => f.round === 2)!;
    expect(r1[0].nextFixtureId).toBe(final.fixtureId);
    expect(r1[0].nextSlot).toBe("A");
    expect(r1[1].nextFixtureId).toBe(final.fixtureId);
    expect(r1[1].nextSlot).toBe("B");
  });
});

describe("generateBracket: non-power-of-two byes", () => {
  it("gives byes to top seeds for 5 entrants (bracket size 8)", () => {
    const { fixtures } = generateBracket("chess-open", "chess", entrants(5));
    const r1 = fixtures.filter((f) => f.round === 1);
    expect(r1).toHaveLength(4);
    const byeMatches = r1.filter((f) => f.slotA.kind === "BYE" || f.slotB.kind === "BYE");
    expect(byeMatches).toHaveLength(3);
  });

  it("auto-advances bye winners into round 2 slots immediately", () => {
    const { fixtures } = generateBracket("chess-open", "chess", entrants(5));
    const r2 = fixtures.filter((f) => f.round === 2);
    for (const f of r2) {
      expect(["PARTICIPANT", "TEAM", "FIXTURE_WINNER", "BYE"]).toContain(f.slotA.kind);
    }
    const resolvedSlots = r2.flatMap((f) => [f.slotA, f.slotB]).filter((s) => s.kind === "PARTICIPANT");
    expect(resolvedSlots.length).toBeGreaterThan(0);
  });

  it("marks bye-walkover round-1 fixtures as COMPLETED", () => {
    const { fixtures } = generateBracket("chess-open", "chess", entrants(5));
    const r1 = fixtures.filter((f) => f.round === 1);
    const byeFixtures = r1.filter((f) => f.slotA.kind === "BYE" || f.slotB.kind === "BYE");
    for (const f of byeFixtures) expect(f.status).toBe("COMPLETED");
  });
});

describe("propagateWinner", () => {
  it("moves the winning slot into the next fixture and completes the source", () => {
    const { fixtures } = generateBracket("badminton-mens-singles", "badminton", entrants(4));
    const r1a = fixtures.find((f) => f.round === 1 && f.matchNumber === 1)!;
    const updated = propagateWinner(fixtures, r1a.fixtureId, "A");
    const source = updated.find((f) => f.fixtureId === r1a.fixtureId)!;
    expect(source.status).toBe("COMPLETED");
    const final = updated.find((f) => f.round === 2)!;
    expect(final.slotA).toEqual(r1a.slotA);
  });

  it("recursively resolves a chain when the fed-forward fixture is now bye-vs-real", () => {
    const { fixtures } = generateBracket("chess-open", "chess", entrants(3));
    const r1 = fixtures.filter((f) => f.round === 1);
    const playedMatch = r1.find((f) => f.slotA.kind !== "BYE" && f.slotB.kind !== "BYE")!;
    const updated = propagateWinner(fixtures, playedMatch.fixtureId, "A");
    const final = updated.find((f) => f.round === 2)!;
    expect(final.status === "COMPLETED" || final.slotA.kind === "PARTICIPANT" || final.slotB.kind === "PARTICIPANT").toBe(true);
  });
});

describe("isGenerationOnlyFixture", () => {
  it("treats every fixture of a freshly generated bracket as regenerable scaffolding, even though BYE fixtures are auto-COMPLETED", () => {
    const { fixtures } = generateBracket("chess-open", "chess", entrants(5));

    expect(fixtures.some((f) => f.status === "COMPLETED")).toBe(true);
    expect(fixtures.every(isGenerationOnlyFixture)).toBe(true);
  });

  it("treats scheduled, live, cancelled and genuinely played fixtures as operational history", () => {
    const { fixtures } = generateBracket("chess-open", "chess", entrants(4));
    const base = fixtures.find((f) => f.round === 1)!;
    for (const status of ["SCHEDULED", "LIVE", "CANCELLED", "POSTPONED", "COMPLETED"] as const) {
      expect(isGenerationOnlyFixture({ ...base, status })).toBe(false);
    }
  });
});
