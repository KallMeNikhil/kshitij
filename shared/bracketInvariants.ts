import { fixtureId } from "./ids";
import type { FixtureDoc, Slot } from "./types";

export interface BracketIssue {
  code:
    | "NEXT_FIXTURE_MISSING"
    | "NEXT_FIXTURE_WRONG_COMPETITION"
    | "NEXT_FIXTURE_WRONG_POSITION"
    | "WINNER_SLOT_WRONG_FEEDER"
    | "FEEDER_DOES_NOT_POINT_HERE"
    | "ENTRANT_SEATED_TWICE_IN_ROUND";
  fixtureId: string;
  message: string;
}

export function feederFixtureIds(f: Pick<FixtureDoc, "competitionId" | "round" | "matchNumber">): { A: string; B: string } | null {
  if (f.round <= 1) return null;
  return {
    A: fixtureId(f.competitionId, f.round - 1, 2 * f.matchNumber - 1),
    B: fixtureId(f.competitionId, f.round - 1, 2 * f.matchNumber),
  };
}

export function expectedNext(f: Pick<FixtureDoc, "competitionId" | "round" | "matchNumber">): { fixtureId: string; slot: "A" | "B" } {
  return {
    fixtureId: fixtureId(f.competitionId, f.round + 1, Math.floor((f.matchNumber - 1) / 2) + 1),
    slot: f.matchNumber % 2 === 1 ? "A" : "B",
  };
}

export function entrantKey(slot: Slot): string | null {
  if (slot.kind === "PARTICIPANT" && slot.participantId) return `P:${slot.participantId}`;
  if (slot.kind === "TEAM" && slot.teamId) return `T:${slot.teamId}`;
  return null;
}

export function validateBracketInvariants(fixtures: FixtureDoc[]): BracketIssue[] {
  const issues: BracketIssue[] = [];
  const byId = new Map(fixtures.map((f) => [f.fixtureId, f]));

  for (const f of fixtures) {
    if (f.nextFixtureId) {
      const next = byId.get(f.nextFixtureId);
      if (!next) {
        issues.push({ code: "NEXT_FIXTURE_MISSING", fixtureId: f.fixtureId, message: `next fixture ${f.nextFixtureId} does not exist` });
      } else {
        if (next.competitionId !== f.competitionId) {
          issues.push({ code: "NEXT_FIXTURE_WRONG_COMPETITION", fixtureId: f.fixtureId, message: `next fixture belongs to ${next.competitionId}` });
        }
        const want = expectedNext(f);
        if (next.fixtureId !== want.fixtureId || f.nextSlot !== want.slot) {
          issues.push({
            code: "NEXT_FIXTURE_WRONG_POSITION",
            fixtureId: f.fixtureId,
            message: `winner must advance to ${want.fixtureId} slot ${want.slot}, not ${next.fixtureId} slot ${f.nextSlot}`,
          });
        }
      }
    }

    const feeders = feederFixtureIds(f);
    if (feeders) {
      for (const side of ["A", "B"] as const) {
        const slot = side === "A" ? f.slotA : f.slotB;
        if (slot.kind === "FIXTURE_WINNER") {
          if (slot.fromFixtureId !== feeders[side]) {
            issues.push({
              code: "WINNER_SLOT_WRONG_FEEDER",
              fixtureId: f.fixtureId,
              message: `slot ${side} must follow ${feeders[side]}, not ${slot.fromFixtureId ?? "(none)"}`,
            });
          }
          const feeder = byId.get(feeders[side]);
          if (feeder && (feeder.nextFixtureId !== f.fixtureId || feeder.nextSlot !== side)) {
            issues.push({
              code: "FEEDER_DOES_NOT_POINT_HERE",
              fixtureId: f.fixtureId,
              message: `${feeders[side]} does not advance into slot ${side} of this fixture`,
            });
          }
        }
      }
    }
  }

  const seen = new Map<string, string>();
  for (const f of fixtures) {
    for (const slot of [f.slotA, f.slotB]) {
      const key = entrantKey(slot);
      if (!key) continue;
      const k = `${f.round}|${key}`;
      const first = seen.get(k);
      if (first) {
        issues.push({
          code: "ENTRANT_SEATED_TWICE_IN_ROUND",
          fixtureId: f.fixtureId,
          message: `${key.slice(2)} is already seated in ${first} in round ${f.round}`,
        });
      } else {
        seen.set(k, f.fixtureId);
      }
    }
  }
  return issues;
}
