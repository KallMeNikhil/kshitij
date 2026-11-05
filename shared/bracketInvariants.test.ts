import { describe, expect, it } from "vitest";
import { generateBracket, propagateWinner } from "./bracket";
import { expectedNext, feederFixtureIds, validateBracketInvariants } from "./bracketInvariants";
import type { FixtureDoc } from "./types";

const entrants = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, kind: "PARTICIPANT" as const }));

describe("topology convention matches generateBracket for every supported size", () => {
  for (const n of [2, 3, 4, 5, 8, 11, 16, 32, 64, 128]) {
    it(`${n} entrants: feeders/next derive exactly from round + matchNumber, no violations`, () => {
      const { fixtures } = generateBracket("c-open", "chess", entrants(n));
      expect(validateBracketInvariants(fixtures)).toEqual([]);
      for (const f of fixtures) {
        if (f.nextFixtureId) expect({ fixtureId: f.nextFixtureId, slot: f.nextSlot }).toEqual(expectedNext(f));
        const feeders = feederFixtureIds(f);
        if (feeders) {
          for (const side of ["A", "B"] as const) {
            const slot = side === "A" ? f.slotA : f.slotB;
            if (slot.kind === "FIXTURE_WINNER") expect(slot.fromFixtureId).toBe(feeders[side]);
          }
        }
      }
    });
  }

  it("stays violation-free after winners are propagated through a whole bracket", () => {
    let { fixtures } = generateBracket("c-open", "chess", entrants(8));
    for (const round of [1, 2, 3]) {
      for (const f of fixtures.filter((x) => x.round === round && x.status !== "COMPLETED")) {
        fixtures = propagateWinner(fixtures, f.fixtureId, "A");
      }
    }
    expect(validateBracketInvariants(fixtures)).toEqual([]);
  });
});

describe("validateBracketInvariants detects structural tampering", () => {
  const base = () => generateBracket("c-open", "chess", entrants(8)).fixtures;
  const get = (fs: FixtureDoc[], id: string) => fs.find((f) => f.fixtureId === id)!;
  const codes = (fs: FixtureDoc[]) => validateBracketInvariants(fs).map((i) => i.code);

  it("rewired nextFixtureId / nextSlot", () => {
    const fs = base();
    get(fs, "c-open-r1-m01").nextSlot = "B";
    expect(codes(fs)).toContain("NEXT_FIXTURE_WRONG_POSITION");
    const fs2 = base();
    get(fs2, "c-open-r1-m01").nextFixtureId = "c-open-r2-m02";
    expect(codes(fs2)).toContain("NEXT_FIXTURE_WRONG_POSITION");
    const fs3 = base();
    get(fs3, "c-open-r1-m01").nextFixtureId = "c-open-r2-m09";
    expect(codes(fs3)).toContain("NEXT_FIXTURE_MISSING");
  });

  it("a winner slot that follows the wrong feeder", () => {
    const fs = base();
    get(fs, "c-open-r2-m01").slotA = { kind: "FIXTURE_WINNER", fromFixtureId: "c-open-r1-m03" };
    expect(codes(fs)).toContain("WINNER_SLOT_WRONG_FEEDER");
  });

  it("the same entrant seated in two fixtures of one round", () => {
    const fs = base();
    const r1 = fs.filter((f) => f.round === 1);
    r1[1].slotA = { ...r1[0].slotA };
    expect(codes(fs)).toContain("ENTRANT_SEATED_TWICE_IN_ROUND");
  });

  it("ignores standalone imported fixtures that declare no topology", () => {
    const standalone: FixtureDoc = {
      fixtureId: "x-open-r1-m01", competitionId: "x-open", sportId: "chess", round: 1, matchNumber: 1,
      slotA: { kind: "PARTICIPANT", participantId: "a1" }, slotB: { kind: "PARTICIPANT", participantId: "b1" },
      status: "DRAFT", nextFixtureId: null, nextSlot: null,
    };
    expect(validateBracketInvariants([standalone])).toEqual([]);
  });
});
