import { describe, it, expect } from "vitest";
import { generateDemoData } from "./generate";
import { validateImport, emptyStore } from "../../shared/import-validator";

describe("generateDemoData", () => {
  const bundle = generateDemoData();

  it("covers all 9 sports", () => {
    expect(bundle.sports).toHaveLength(9);
  });

  it("produces participants/teams/competitions that pass the real import validator", () => {
    const result = validateImport(
      {
        schemaVersion: "kshitij.canonical/1",
        sports: bundle.sports,

        competitions: bundle.competitions.map((c) => ({ ...c, published: false })),
        participants: bundle.participants,
        teams: bundle.teams,
      },
      emptyStore()
    );
    if (!result.ok) {
      console.log(JSON.stringify(result.issues, null, 2));
    }
    expect(result.ok).toBe(true);
  });

  it("includes at least one BYE fixture (non-power-of-two field)", () => {
    const hasBye = bundle.fixtures.some((f) => f.slotA.kind === "BYE" || f.slotB.kind === "BYE");
    expect(hasBye).toBe(true);
  });

  it("includes fixtures in LIVE, COMPLETED, and SCHEDULED states", () => {
    const statuses = new Set(bundle.fixtures.map((f) => f.status));
    expect(statuses.has("LIVE")).toBe(true);
    expect(statuses.has("COMPLETED")).toBe(true);
    expect(statuses.has("SCHEDULED")).toBe(true);
  });

  it("includes an empty category (basketball girls' team with no teams generated)", () => {
    const girlsBasketball = bundle.competitions.find((c) => c.competitionId === "basketball-girls-team");
    expect(girlsBasketball).toBeDefined();
    const teamsInIt = bundle.teams.filter((t) => t.competitionId === "basketball-girls-team");
    expect(teamsInIt).toHaveLength(0);
  });

  it("includes a long team name for mobile overflow testing", () => {
    const hasLongName = bundle.teams.some((t) => (t.teamName?.length ?? 0) > 40);
    expect(hasLongName).toBe(true);
  });

  it("gives every match state a fixtureId that exists in the generated fixtures", () => {
    const fixtureIds = new Set(bundle.fixtures.map((f) => f.fixtureId));
    for (const ms of bundle.matchStates) {
      expect(fixtureIds.has(ms.fixtureId)).toBe(true);
    }
  });

  it("keeps every participant's normalized phone unique per competition", () => {
    const seen = new Set<string>();
    for (const p of bundle.participants) {
      const key = `${p.competitionId}:${p.phone}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
