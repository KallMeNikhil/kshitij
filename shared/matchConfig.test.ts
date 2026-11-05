import { describe, it, expect } from "vitest";
import { matchConfigurationSchema, defaultMatchConfigurations, configurationForRound } from "./matchConfig";
import { generateBracket } from "./bracket";
import { setsPointsConfigFrom } from "./scoring/fromMatchConfiguration";
import { crossCheckWinner } from "./scoring/winnerCrossCheck";

describe("matchConfigurationSchema", () => {
  it("accepts every seeded default configuration", () => {
    for (const [sportId, config] of Object.entries(defaultMatchConfigurations)) {
      const result = matchConfigurationSchema.safeParse(config);
      expect(result.success, `${sportId}: ${JSON.stringify(result.success ? null : result.error.issues)}`).toBe(true);
    }
  });

  it("rejects a structure kind that does not match the scoring model", () => {
    const bad = {
      ...defaultMatchConfigurations.basketball!,
      structure: { kind: "RESULT_ONLY", drawAllowed: true, pointDetail: "NONE" },
    };
    expect(matchConfigurationSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown scoring model", () => {
    expect(
      matchConfigurationSchema.safeParse({ ...defaultMatchConfigurations.chess!, scoringModel: "MADE_UP" }).success
    ).toBe(false);
  });

  it("rejects a TEAM participant model with no teamSize", () => {
    const bad = {
      ...defaultMatchConfigurations.basketball!,
      participantModel: { participantType: "TEAM" },
    };
    expect(matchConfigurationSchema.safeParse(bad).success).toBe(false);
  });
});

describe("generateBracket matchConfiguration snapshot", () => {
  const entrants = [
    { id: "a", kind: "TEAM" as const },
    { id: "b", kind: "TEAM" as const },
    { id: "c", kind: "TEAM" as const },
  ];

  it("stamps the given configuration onto every generated fixture", () => {
    const config = defaultMatchConfigurations.basketball!;
    const { fixtures } = generateBracket("basketball-mens", "basketball", entrants, config);
    expect(fixtures.length).toBeGreaterThan(0);
    for (const f of fixtures) {
      expect(f.matchConfigurationSnapshot).toEqual(config);
    }
  });

  it("leaves the snapshot undefined when no configuration is supplied (back-compat)", () => {
    const { fixtures } = generateBracket("basketball-mens", "basketball", entrants);
    for (const f of fixtures) {
      expect(f.matchConfigurationSnapshot).toBeUndefined();
    }
  });
});

describe("round-specific configuration (table tennis best-of-5 for semifinal/final)", () => {
  const tt = defaultMatchConfigurations["table-tennis"]!;
  const entrants = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, kind: "PARTICIPANT" as const }));
  const bestOfOf = (f: { matchConfigurationSnapshot?: unknown }) =>
    (f.matchConfigurationSnapshot as { structure: { bestOf: number } }).structure.bestOf;

  it("the shipped table-tennis default is valid, models the supplied format, and no longer flags it pending", () => {
    expect(matchConfigurationSchema.safeParse(tt).success).toBe(true);
    expect(tt.structure).toMatchObject({ bestOf: 3, pointsToWin: 11 });
    expect(tt.roundOverrides?.map((o) => o.roundsFromEnd).sort()).toEqual([0, 1]);
    expect(tt.pending.join(" ")).not.toMatch(/best-?of/i);
  });

  it("freezes best-of-5 into semifinal and final snapshots and best-of-3 into earlier rounds (8 entrants)", () => {
    const { fixtures } = generateBracket("table-tennis-mens-singles", "table-tennis", entrants(8), tt);
    const byRound = (r: number) => fixtures.filter((f) => f.round === r);
    expect(byRound(1).map(bestOfOf)).toEqual([3, 3, 3, 3]);
    expect(byRound(2).map(bestOfOf)).toEqual([5, 5]);
    expect(byRound(3).map(bestOfOf)).toEqual([5]);
  });

  it("means the same thing for any bracket size (roundsFromEnd, not absolute round)", () => {
    const { fixtures } = generateBracket("table-tennis-mens-singles", "table-tennis", entrants(16), tt);
    const rounds = (r: number) => fixtures.filter((f) => f.round === r).map(bestOfOf);
    expect(rounds(1)).toEqual(Array(8).fill(3));
    expect(rounds(2)).toEqual(Array(4).fill(3));
    expect(rounds(3)).toEqual([5, 5]);
    expect(rounds(4)).toEqual([5]);
  });

  it("stores a self-contained snapshot: no roundOverrides, pointsToWin still configurable", () => {
    const custom = matchConfigurationSchema.parse({
      ...tt,
      structure: { kind: "SETS_POINTS", bestOf: 3, pointsToWin: 21 },
      roundOverrides: [{ roundsFromEnd: 0, structure: { kind: "SETS_POINTS", bestOf: 5, pointsToWin: 15 } }],
    });
    const { fixtures } = generateBracket("table-tennis-mens-singles", "table-tennis", entrants(4), custom);
    const final = fixtures.find((f) => f.round === 2)!;
    const semi = fixtures.find((f) => f.round === 1)!;
    expect(final.matchConfigurationSnapshot).not.toHaveProperty("roundOverrides");
    expect(final.matchConfigurationSnapshot?.structure).toMatchObject({ bestOf: 5, pointsToWin: 15 });
    expect(semi.matchConfigurationSnapshot?.structure).toMatchObject({ bestOf: 3, pointsToWin: 21 });
  });

  it("leaves configurations without overrides byte-identical (no behavior change for other sports)", () => {
    const bb = defaultMatchConfigurations.basketball!;
    const { fixtures } = generateBracket("basketball-mens", "basketball", entrants(4), bb);
    for (const f of fixtures) expect(f.matchConfigurationSnapshot).toEqual(bb);
    expect(configurationForRound(bb, 1, 2)).toEqual(bb);
  });

  it("rejects an override of a different structure kind, and duplicate stages", () => {
    const wrongKind = matchConfigurationSchema.safeParse({
      ...tt,
      roundOverrides: [{ roundsFromEnd: 0, structure: { kind: "GAMES_SETS", bestOfSets: 3 } }],
    });
    expect(wrongKind.success).toBe(false);
    const dup = matchConfigurationSchema.safeParse({
      ...tt,
      roundOverrides: [
        { roundsFromEnd: 0, structure: { kind: "SETS_POINTS", bestOf: 5, pointsToWin: 11 } },
        { roundsFromEnd: 0, structure: { kind: "SETS_POINTS", bestOf: 7, pointsToWin: 11 } },
      ],
    });
    expect(dup.success).toBe(false);
  });

  it("scores the final under best-of-5: the shared scoring config and winner cross-check both see 5, not 3", () => {
    const { fixtures } = generateBracket("table-tennis-mens-singles", "table-tennis", entrants(4), tt);
    const final = fixtures.find((f) => f.round === 2)!;
    const semiEarly = fixtures.find((f) => f.round === 1)!;
    expect(setsPointsConfigFrom(final.matchConfigurationSnapshot, "table-tennis")).toMatchObject({ bestOf: 5, pointsToWin: 11 });

    expect(setsPointsConfigFrom(semiEarly.matchConfigurationSnapshot, "table-tennis")).toMatchObject({ bestOf: 5, pointsToWin: 11 });
    const eight = generateBracket("table-tennis-mens-singles", "table-tennis", entrants(8), tt).fixtures;
    expect(setsPointsConfigFrom(eight.find((f) => f.round === 1)!.matchConfigurationSnapshot, "table-tennis").bestOf).toBe(3);

    const twoZeroA = {
      sets: [{ a: 11, b: 5, completed: true }, { a: 11, b: 7, completed: true }],
      currentSet: 2,
    };
    const bestOfThree = { ...tt, roundOverrides: undefined };
    const early = crossCheckWinner("SETS_POINTS", "SETS_POINTS", "table-tennis", bestOfThree, twoZeroA, "B");
    expect(early.ok).toBe(false);
    const asFinal = crossCheckWinner("SETS_POINTS", "SETS_POINTS", "table-tennis", final.matchConfigurationSnapshot, twoZeroA, "A");
    expect(asFinal.ok).toBe(false);
    const threeZeroA = { sets: [...twoZeroA.sets, { a: 11, b: 9, completed: true }], currentSet: 2 };
    expect(crossCheckWinner("SETS_POINTS", "SETS_POINTS", "table-tennis", final.matchConfigurationSnapshot, threeZeroA, "A").ok).toBe(true);
  });
});
