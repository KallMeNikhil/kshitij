import type { FixtureDoc, Slot } from "../../shared/types";

export function placeholderLabel(slot: Slot, fixtures: readonly FixtureDoc[] | null): string {
  if (slot.kind === "BYE") return "BYE";
  if (slot.kind === "TBD") return "To be decided";
  if (slot.kind === "FIXTURE_WINNER") {
    const feeder = slot.fromFixtureId ? fixtures?.find((f) => f.fixtureId === slot.fromFixtureId) : undefined;
    return feeder ? `Winner of Match ${feeder.matchNumber}` : "Winner of previous match";
  }
  return "To be decided";
}

export function isByeFixture(f: Pick<FixtureDoc, "slotA" | "slotB">): boolean {
  return f.slotA.kind === "BYE" || f.slotB.kind === "BYE";
}
