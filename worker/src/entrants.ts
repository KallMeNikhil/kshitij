import { AppError } from "./errors";
import type { FirestoreRestClient } from "./firestore/client";
import type { FixtureDoc, ParticipantDoc, Slot, TeamDoc } from "../../shared/types";
import { validateBracketInvariants } from "../../shared/bracketInvariants";

export interface SeatedEntrant {
  key: string;
  label: string;
  withdrawn: boolean;
}

export async function loadSeatedEntrant(
  db: FirestoreRestClient,
  slot: Slot,
  fixture: FixtureDoc,
  transaction: string
): Promise<SeatedEntrant> {
  let doc: ParticipantDoc | TeamDoc | null = null;
  let id: string | undefined;
  let label = "";
  if (slot.kind === "PARTICIPANT" && slot.participantId) {
    id = slot.participantId;
    doc = await db.getDocument<ParticipantDoc>("participants", id, transaction);
    label = (doc as ParticipantDoc | null)?.name ?? id;
  } else if (slot.kind === "TEAM" && slot.teamId) {
    id = slot.teamId;
    doc = await db.getDocument<TeamDoc>("teams", id, transaction);
    label = (doc as TeamDoc | null)?.teamName ?? (doc as TeamDoc | null)?.college ?? id;
  } else {
    throw new AppError(409, "SLOT_NOT_YET_DECIDED", "Both entrants must be decided first");
  }
  if (!doc) throw new AppError(409, "ENTRANT_NOT_FOUND", `Entrant ${id} does not exist`);
  if (doc.competitionId !== fixture.competitionId || doc.sportId !== fixture.sportId) {
    throw new AppError(
      409,
      "ENTRANT_OUT_OF_SCOPE",
      `Entrant ${id} does not belong to competition ${fixture.competitionId}`
    );
  }
  return { key: `${slot.kind}:${id}`, label, withdrawn: doc.status === "WITHDRAWN" };
}

export async function loadFixtureEntrants(
  db: FirestoreRestClient,
  fixture: FixtureDoc,
  transaction: string
): Promise<{ A: SeatedEntrant; B: SeatedEntrant }> {
  const A = await loadSeatedEntrant(db, fixture.slotA, fixture, transaction);
  const B = await loadSeatedEntrant(db, fixture.slotB, fixture, transaction);
  if (A.key === B.key) {
    throw new AppError(409, "DUPLICATE_ENTRANT", "The same entrant is seated on both sides of this fixture");
  }
  return { A, B };
}

export function assertNoNewBracketIssues(before: FixtureDoc[], after: FixtureDoc[]): void {
  const known = new Set(validateBracketInvariants(before).map((i) => `${i.code}|${i.fixtureId}|${i.message}`));
  const fresh = validateBracketInvariants(after).filter((i) => !known.has(`${i.code}|${i.fixtureId}|${i.message}`));
  if (fresh.length > 0) {
    throw new AppError(409, "BRACKET_INVARIANT_VIOLATION", `Operation would break the bracket structure: ${fresh[0].message}`);
  }
}
