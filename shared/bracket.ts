import { fixtureId } from "./ids";
import type { FixtureDoc, Slot } from "./types";
import { configurationForRound, type MatchConfiguration } from "./matchConfig";

export interface Entrant {
  id: string;
  kind: "PARTICIPANT" | "TEAM";
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function seedOrder(size: number): number[] {
  if (size === 1) return [1];
  const prev = seedOrder(size / 2);
  const result: number[] = [];
  for (const s of prev) {
    result.push(s);
    result.push(size + 1 - s);
  }
  return result;
}

export interface GeneratedBracket {
  fixtures: FixtureDoc[];
}

export function generateBracket(
  competitionId: string,
  sportId: string,
  entrants: Entrant[],
  matchConfiguration?: MatchConfiguration
): GeneratedBracket {
  const n = entrants.length;
  if (n < 2) {
    throw new Error("BRACKET_REQUIRES_AT_LEAST_TWO_ENTRANTS");
  }
  const size = nextPowerOfTwo(n);
  const order = seedOrder(size);
  const totalRounds = Math.log2(size);

  const slotFor = (seed: number): Slot => {
    if (seed > n) return { kind: "BYE" };
    const entrant = entrants[seed - 1];
    return entrant.kind === "TEAM"
      ? { kind: "TEAM", teamId: entrant.id }
      : { kind: "PARTICIPANT", participantId: entrant.id };
  };

  const fixturesByRound: FixtureDoc[][] = [];

  const round1Count = size / 2;
  const round1: FixtureDoc[] = [];
  for (let m = 1; m <= round1Count; m++) {
    const seedA = order[2 * (m - 1)];
    const seedB = order[2 * (m - 1) + 1];
    round1.push({
      fixtureId: fixtureId(competitionId, 1, m),
      competitionId,
      sportId,
      round: 1,
      matchNumber: m,
      slotA: slotFor(seedA),
      slotB: slotFor(seedB),
      status: "DRAFT",
      nextFixtureId: null,
      nextSlot: null,
    });
  }
  fixturesByRound.push(round1);

  for (let r = 2; r <= totalRounds; r++) {
    const prevCount = fixturesByRound[r - 2].length;
    const count = prevCount / 2;
    const roundFixtures: FixtureDoc[] = [];
    for (let m = 1; m <= count; m++) {
      roundFixtures.push({
        fixtureId: fixtureId(competitionId, r, m),
        competitionId,
        sportId,
        round: r,
        matchNumber: m,
        slotA: { kind: "FIXTURE_WINNER", fromFixtureId: fixtureId(competitionId, r - 1, 2 * m - 1) },
        slotB: { kind: "FIXTURE_WINNER", fromFixtureId: fixtureId(competitionId, r - 1, 2 * m) },
        status: "DRAFT",
        nextFixtureId: null,
        nextSlot: null,
      });
    }
    fixturesByRound.push(roundFixtures);
  }

  for (let r = 1; r < totalRounds; r++) {
    const round = fixturesByRound[r - 1];
    const nextRound = fixturesByRound[r];
    round.forEach((f, idx) => {
      const nextMatch = nextRound[Math.floor(idx / 2)];
      f.nextFixtureId = nextMatch.fixtureId;
      f.nextSlot = idx % 2 === 0 ? "A" : "B";
    });
  }

  const all = fixturesByRound.flat();
  if (matchConfiguration) {

    for (const f of all) f.matchConfigurationSnapshot = configurationForRound(matchConfiguration, f.round, totalRounds);
  }
  resolveByeWalkovers(all);
  return { fixtures: all };
}

function winnerSlotOf(f: FixtureDoc): Slot | null {
  const aIsBye = f.slotA.kind === "BYE";
  const bIsBye = f.slotB.kind === "BYE";
  if (aIsBye && bIsBye) return { kind: "BYE" };
  if (aIsBye) return f.slotB;
  if (bIsBye) return f.slotA;
  return null;
}

export function resolveByeWalkovers(fixtures: FixtureDoc[]): void {
  const byId = new Map(fixtures.map((f) => [f.fixtureId, f]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of fixtures) {
      if (f.status === "COMPLETED") continue;
      const winner = winnerSlotOf(f);
      if (!winner) continue;
      if (f.slotA.kind !== "BYE" || f.slotB.kind !== "BYE") {
        f.status = "COMPLETED";
      }
      if (f.nextFixtureId && f.nextSlot) {
        const next = byId.get(f.nextFixtureId);
        if (next) {
          const target = f.nextSlot === "A" ? "slotA" : "slotB";
          if (next[target].kind === "FIXTURE_WINNER" && next[target].fromFixtureId === f.fixtureId) {
            next[target] = winner;
            changed = true;
          }
        }
      }
    }
  }
}

export function propagateWinner(
  fixtures: FixtureDoc[],
  fixtureIdCompleted: string,
  winnerSlot: "A" | "B"
): FixtureDoc[] {
  const byId = new Map(fixtures.map((f) => [f.fixtureId, f]));
  const source = byId.get(fixtureIdCompleted);
  if (!source) throw new Error("FIXTURE_NOT_FOUND");
  source.status = "COMPLETED";
  const winner = winnerSlot === "A" ? source.slotA : source.slotB;
  if (source.nextFixtureId && source.nextSlot) {
    const next = byId.get(source.nextFixtureId);
    if (next) {
      const target = source.nextSlot === "A" ? "slotA" : "slotB";
      next[target] = winner;
    }
  }
  resolveByeWalkovers(fixtures);
  return fixtures;
}

export function isGenerationOnlyFixture(f: FixtureDoc): boolean {
  if (f.status === "DRAFT") return true;
  return f.status === "COMPLETED" && (f.slotA.kind === "BYE" || f.slotB.kind === "BYE");
}
