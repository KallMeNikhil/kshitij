
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, deleteField, doc, getDoc, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import rules from "../firebase/firestore.rules?raw";
import { generateBracket } from "./bracket";
import type { FixtureDoc } from "./types";

const host = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.FIRESTORE_EMULATOR_HOST;

const ROOT = "root@example.com";
const COORD = "coord@example.com";
const OTHER = "cricket@example.com";
const COMP = "basketball-mens";
const F1 = `${COMP}-r1-m01`;
const F2 = `${COMP}-r1-m02`;
const FINAL = `${COMP}-r2-m01`;

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const adminDoc = (email: string, role: string, sportIds: string[], active = true) => ({
  email, role, sportIds, active, createdAt: "t", createdBy: "seed", updatedAt: "t", updatedBy: "seed",
});

function bracket(): FixtureDoc[] {
  const { fixtures } = generateBracket(COMP, "basketball", ["t1", "t2", "t3", "t4"].map((id) => ({ id, kind: "TEAM" as const })));
  return clean(fixtures).map((f) => ({ ...f, status: "SCHEDULED" as const }));
}
const by = (fs: FixtureDoc[], id: string) => fs.find((f) => f.fixtureId === id)!;

describe.skipIf(!host)("firestore.rules (emulator)", () => {
  let env: RulesTestEnvironment;
  let fixtures: FixtureDoc[];

  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: "demo-kshitij-rules", firestore: { rules } });
  });
  afterAll(async () => env.cleanup());

  async function seed(over: Record<string, Partial<FixtureDoc>> = {}) {
    fixtures = bracket().map((f) => ({ ...f, ...(over[f.fixtureId] ?? {}) }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "admins", ROOT), adminDoc(ROOT, "SUPER_ADMIN", []));
      await setDoc(doc(db, "admins", COORD), adminDoc(COORD, "SPORT_COORDINATOR", ["basketball"]));
      await setDoc(doc(db, "admins", OTHER), adminDoc(OTHER, "SPORT_COORDINATOR", ["cricket"]));
      for (const f of fixtures) await setDoc(doc(db, "fixtures", f.fixtureId), clean(f));
    });
  }
  beforeEach(async () => {
    await env.clearFirestore();
    await seed();
  });

  const as = (email: string) => env.authenticatedContext(`uid-${email}`, { email, email_verified: true }).firestore();
  const anon = () => env.unauthenticatedContext().firestore();
  const fx = (db: ReturnType<typeof as>, id: string) => doc(db, "fixtures", id);
  const ms = (db: ReturnType<typeof as>, id: string) => doc(db, "matchStates", id);
  const result = (winnerSlot: "A" | "B", decidedBy = "BASKETBALL_POINTS") => ({ winnerSlot, decidedBy, summary: "s" });

  async function completionBatch(db: ReturnType<typeof as>, winnerSlot: "A" | "B", seatInto: "slotA" | "slotB" = "slotA", entrantFrom: "slotA" | "slotB" | null = null) {
    const f1 = by(fixtures, F1);
    const winner = f1[entrantFrom ?? (winnerSlot === "A" ? "slotA" : "slotB")];
    const b = writeBatch(db);
    b.update(fx(db, F1), { status: "COMPLETED" });
    b.update(fx(db, FINAL), { [seatInto]: clean(winner) });
    b.set(ms(db, F1), { fixtureId: F1, version: 1, result: result(winnerSlot) });
    return b.commit();
  }

  describe("coordinator: legitimate Worker flows", () => {
    it("start: SCHEDULED -> LIVE", async () => {
      await assertSucceeds(updateDoc(fx(as(COORD), F1), { status: "LIVE" }));
    });

    it("completeMatch: LIVE -> COMPLETED + winner into the next round's slot + match state, in one batch", async () => {
      await seed({ [F1]: { status: "LIVE" } });
      await assertSucceeds(completionBatch(as(COORD), "A"));
    });

    it("completeMatch with winner B moves slotB's entrant into the right feeder slot", async () => {
      await seed({ [F1]: { status: "LIVE" } });
      await assertSucceeds(completionBatch(as(COORD), "B"));
    });

    it("saveFixture: schedule fields on a SCHEDULED fixture", async () => {
      await assertSucceeds(updateDoc(fx(as(COORD), F1), { scheduledDate: "2026-10-12", scheduledTime: "16:30", venue: "Court 1" }));
    });

    it("live scoring ticks: versioned match state while LIVE", async () => {
      await seed({ [F1]: { status: "LIVE" } });
      const db = as(COORD);
      await assertSucceeds(setDoc(ms(db, F1), { fixtureId: F1, scoringModel: "BASKETBALL_POINTS", version: 1, data: { scoreA: 1 } }));
      await assertSucceeds(setDoc(ms(db, F1), { fixtureId: F1, scoringModel: "BASKETBALL_POINTS", version: 2, data: { scoreA: 3 } }));
    });

    it("correctResult on a completed fixture nobody has built on is Super-Admin-only: new winner into the slot, version bump", async () => {
      await seed({ [F1]: { status: "COMPLETED" } });
      await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(ms(db, F1), { fixtureId: F1, version: 1, result: result("A") });
        await updateDoc(fx(db, FINAL), { slotA: clean(by(fixtures, F1).slotA) });
      });
      const f1 = by(fixtures, F1);
      const correction = (db: ReturnType<typeof as>) => {
        const b = writeBatch(db);
        b.update(fx(db, FINAL), { slotA: clean(f1.slotB) });
        b.update(ms(db, F1), { version: 2, "result.winnerSlot": "B" });
        return b.commit();
      };
      await assertFails(correction(as(COORD)));
      await assertSucceeds(correction(as(ROOT)));
    });
  });

  describe("coordinator: attacks on fixtures", () => {
    it("cannot seat an entrant other than the feeder's winner downstream", async () => {
      await seed({ [F1]: { status: "LIVE" } });

      await assertFails(completionBatch(as(COORD), "A", "slotA", "slotB"));
    });

    it("cannot put the winner into the wrong downstream side", async () => {
      await seed({ [F1]: { status: "LIVE" } });
      await assertFails(completionBatch(as(COORD), "A", "slotB"));
    });

    it("cannot write a downstream slot without an actual recorded result for the feeder", async () => {
      await seed({ [F1]: { status: "LIVE" } });
      const db = as(COORD);
      await assertFails(updateDoc(fx(db, FINAL), { slotA: clean(by(fixtures, F1).slotA) }));
    });

    it("cannot re-point topology: set a slot to a fixture-winner of another feeder, or to TBD", async () => {
      const db = as(COORD);
      await assertFails(updateDoc(fx(db, FINAL), { slotA: { kind: "FIXTURE_WINNER", fromFixtureId: F2 } }));
      await assertFails(updateDoc(fx(db, FINAL), { slotA: { kind: "TBD" } }));
    });

    it("cannot seat anyone into a round-1 slot", async () => {
      await assertFails(updateDoc(fx(as(COORD), F1), { slotA: { kind: "TEAM", teamId: "t4" } }));
    });

    it("cannot restart, reopen or skip states: COMPLETED -> LIVE, LIVE -> SCHEDULED, SCHEDULED -> CANCELLED", async () => {
      await seed({ [F1]: { status: "COMPLETED" }, [F2]: { status: "LIVE" } });
      const db = as(COORD);
      await assertFails(updateDoc(fx(db, F1), { status: "LIVE" }));
      await assertFails(updateDoc(fx(db, F2), { status: "SCHEDULED" }));
      await assertFails(updateDoc(fx(db, FINAL), { status: "CANCELLED" }));
    });

    it("cannot complete a fixture without a recorded result, or complete one that is not LIVE", async () => {
      await seed({ [F1]: { status: "LIVE" } });
      const db = as(COORD);
      await assertFails(updateDoc(fx(db, F1), { status: "COMPLETED" }));
      await assertFails(updateDoc(fx(db, F2), { status: "COMPLETED" }));
      const b = writeBatch(db);
      b.update(fx(db, F2), { status: "COMPLETED" });
      b.set(ms(db, F2), { fixtureId: F2, version: 1, result: result("A") });
      await assertFails(b.commit());
    });

    it("cannot cancel a fixture", async () => {
      await seed({ [F1]: { status: "LIVE" } });
      const db = as(COORD);
      await assertFails(updateDoc(fx(db, F1), { status: "CANCELLED", statusReason: "ground flooded" }));
      await assertFails(updateDoc(fx(db, F2), { status: "CANCELLED", statusReason: "ground flooded" }));
    });

    it("cannot publish a DRAFT fixture", async () => {
      await seed({ [F1]: { status: "DRAFT" } });
      await assertFails(updateDoc(fx(as(COORD), F1), { status: "SCHEDULED" }));
    });

    it("cannot touch identity, topology or the configuration snapshot", async () => {
      const db = as(COORD);
      await assertFails(updateDoc(fx(db, F1), { matchConfigurationSnapshot: { configVersion: 9 } }));
      await assertFails(updateDoc(fx(db, F1), { nextFixtureId: FINAL, nextSlot: "B" }));
      await assertFails(updateDoc(fx(db, F1), { sportId: "cricket" }));
      await assertFails(updateDoc(fx(db, F1), { competitionId: "other" }));
      await assertFails(updateDoc(fx(db, F1), { round: 2 }));
    });

    it("cannot reschedule or edit a LIVE fixture (only complete it)", async () => {
      await seed({ [F1]: { status: "LIVE" } });
      await assertFails(updateDoc(fx(as(COORD), F1), { venue: "Elsewhere" }));
    });

    it("cannot create or delete fixtures, nor act outside their sport", async () => {
      const db = as(COORD);
      await assertFails(setDoc(fx(db, "basketball-mens-r9-m01"), clean(by(fixtures, F1))));
      await assertFails(deleteDoc(fx(db, F1)));
      await assertFails(updateDoc(fx(as(OTHER), F1), { status: "LIVE" }));
    });
  });

  describe("postpone, resume and cancel", () => {
    const reason = "rain";

    it("coordinator: postpone a SCHEDULED fixture, then resume it to SCHEDULED", async () => {
      const db = as(COORD);
      await assertSucceeds(updateDoc(fx(db, F1), { status: "POSTPONED", statusReason: reason, resumeStatus: "SCHEDULED" }));
      await assertSucceeds(
        updateDoc(fx(db, F1), { status: "SCHEDULED", statusReason: deleteField(), resumeStatus: deleteField(), scheduledDate: "2026-10-12", scheduledTime: "16:30" })
      );
    });

    it("coordinator: suspend a LIVE fixture and resume it to LIVE only", async () => {
      await seed({ [F1]: { status: "LIVE" } });
      const db = as(COORD);
      await assertSucceeds(updateDoc(fx(db, F1), { status: "POSTPONED", statusReason: reason, resumeStatus: "LIVE" }));
      await assertFails(updateDoc(fx(db, F1), { status: "SCHEDULED", statusReason: deleteField(), resumeStatus: deleteField() }));
      await assertSucceeds(updateDoc(fx(db, F1), { status: "LIVE", statusReason: deleteField(), resumeStatus: deleteField() }));
    });

    it("cancel: Super Admin only, allowed from SCHEDULED, LIVE and POSTPONED with a reason, then terminal", async () => {
      await seed({ [F1]: { status: "LIVE" }, [F2]: { status: "POSTPONED", statusReason: reason, resumeStatus: "SCHEDULED" } });
      const db = as(ROOT);
      await assertSucceeds(updateDoc(fx(db, F1), { status: "CANCELLED", statusReason: "ground flooded" }));
      await assertSucceeds(updateDoc(fx(db, F2), { status: "CANCELLED", statusReason: "ground flooded", resumeStatus: deleteField() }));
      await assertSucceeds(updateDoc(fx(db, FINAL), { status: "CANCELLED", statusReason: "ground flooded" }));
      await assertFails(updateDoc(fx(db, F1), { status: "LIVE" }));
      await assertFails(updateDoc(fx(db, F1), { status: "SCHEDULED", statusReason: deleteField() }));
      await assertFails(updateDoc(fx(as(COORD), F1), { status: "SCHEDULED", statusReason: deleteField() }));
    });

    it("rejects missing or oversize reasons, a wrong resume status, and stray lifecycle fields", async () => {
      const db = as(COORD);
      await assertFails(updateDoc(fx(db, F1), { status: "POSTPONED", resumeStatus: "SCHEDULED" }));
      await assertFails(updateDoc(fx(db, F1), { status: "POSTPONED", statusReason: "", resumeStatus: "SCHEDULED" }));
      await assertFails(updateDoc(fx(db, F1), { status: "POSTPONED", statusReason: "x".repeat(301), resumeStatus: "SCHEDULED" }));
      await assertFails(updateDoc(fx(db, F1), { status: "POSTPONED", statusReason: reason, resumeStatus: "LIVE" }));
      await assertFails(updateDoc(fx(db, F1), { status: "CANCELLED", statusReason: reason, resumeStatus: "SCHEDULED" }));
      await assertFails(updateDoc(fx(db, F1), { statusReason: reason }));
      await assertFails(updateDoc(fx(db, F1), { resumeStatus: "LIVE" }));
    });

    it("cannot postpone or cancel what is draft or already finished", async () => {
      await seed({ [F1]: { status: "DRAFT" }, [F2]: { status: "COMPLETED" } });
      await assertFails(updateDoc(fx(as(ROOT), F1), { status: "POSTPONED", statusReason: reason, resumeStatus: "SCHEDULED" }));
      await assertFails(updateDoc(fx(as(ROOT), F2), { status: "POSTPONED", statusReason: reason, resumeStatus: "SCHEDULED" }));
      await assertFails(updateDoc(fx(as(ROOT), F2), { status: "CANCELLED", statusReason: reason }));
    });

    it("a postponed fixture is frozen apart from its schedule, and other sports' coordinators cannot touch it", async () => {
      await seed({ [F1]: { status: "POSTPONED", statusReason: reason, resumeStatus: "SCHEDULED" } });
      await assertFails(updateDoc(fx(as(COORD), F1), { slotA: { kind: "TEAM", teamId: "t4" } }));
      await assertFails(updateDoc(fx(as(OTHER), F1), { status: "CANCELLED", statusReason: reason }));
      await assertFails(updateDoc(fx(anon(), F1), { status: "CANCELLED", statusReason: reason }));
    });

    it("cannot score or complete a postponed or cancelled fixture", async () => {
      await seed({ [F1]: { status: "POSTPONED", statusReason: reason, resumeStatus: "LIVE" } });
      await assertFails(setDoc(ms(as(COORD), F1), { fixtureId: F1, scoringModel: "BASKETBALL_POINTS", version: 1, data: { scoreA: 1 } }));
      await assertFails(updateDoc(fx(as(COORD), F1), { status: "COMPLETED" }));
    });
  });

  describe("match states", () => {
    beforeEach(async () => seed({ [F1]: { status: "LIVE" } }));

    it("rejects a skipped, repeated or non-initial version", async () => {
      const db = as(COORD);
      await assertFails(setDoc(ms(db, F1), { fixtureId: F1, scoringModel: "BASKETBALL_POINTS", version: 5, data: {} }));
      await assertSucceeds(setDoc(ms(db, F1), { fixtureId: F1, scoringModel: "BASKETBALL_POINTS", version: 1, data: {} }));
      await assertFails(setDoc(ms(db, F1), { fixtureId: F1, scoringModel: "BASKETBALL_POINTS", version: 1, data: {} }));
      await assertFails(setDoc(ms(db, F1), { fixtureId: F1, scoringModel: "BASKETBALL_POINTS", version: 3, data: {} }));
    });

    it("rejects unknown keys and a mismatched fixtureId", async () => {
      const db = as(COORD);
      await assertFails(setDoc(ms(db, F1), { fixtureId: F1, version: 1, data: {}, extra: true }));
      await assertFails(setDoc(ms(db, F1), { fixtureId: F2, version: 1, data: {} }));
    });

    it("coordinators can write a result or penalties only in the batch that completes a LIVE fixture", async () => {
      const db = as(COORD);
      await assertFails(setDoc(ms(db, F1), { fixtureId: F1, version: 1, result: result("A") }));
      await assertFails(setDoc(ms(db, F1), { fixtureId: F1, version: 1, penalties: { a: 3, b: 1 } }));
      await assertSucceeds(setDoc(ms(db, F1), { fixtureId: F1, scoringModel: "BASKETBALL_POINTS", version: 1, data: {} }));
      await assertFails(updateDoc(ms(db, F1), { version: 2, result: result("A") }));
    });

    it("coordinators cannot record walkover / admin-override results", async () => {
      const db = as(COORD);
      await assertFails(setDoc(ms(db, F1), { fixtureId: F1, version: 1, result: result("A", "WALKOVER") }));
      await assertFails(setDoc(ms(db, F1), { fixtureId: F1, version: 1, result: result("A", "ADMIN_OVERRIDE") }));
    });

    it("live data cannot change once the fixture is COMPLETED", async () => {
      await seed({ [F1]: { status: "COMPLETED" } });
      await env.withSecurityRulesDisabled(async (ctx) => setDoc(ms(ctx.firestore(), F1), { fixtureId: F1, scoringModel: "BASKETBALL_POINTS", version: 1, data: { scoreA: 1 } }));
      await assertFails(setDoc(ms(as(COORD), F1), { fixtureId: F1, scoringModel: "BASKETBALL_POINTS", version: 2, data: { scoreA: 99 } }));
    });

    it("no match state can be written for a fixture that is only SCHEDULED, except a Super Admin walkover", async () => {
      await seed();
      await assertFails(setDoc(ms(as(COORD), F2), { fixtureId: F2, version: 1, data: {} }));
      await assertFails(setDoc(ms(as(ROOT), F2), { fixtureId: F2, version: 1, result: result("A") }));
      await assertSucceeds(setDoc(ms(as(ROOT), F2), { fixtureId: F2, version: 1, result: result("A", "WALKOVER") }));
    });

    it("a coordinator cannot do the walkover the Super Admin can", async () => {
      await seed();
      await assertFails(setDoc(ms(as(COORD), F2), { fixtureId: F2, version: 1, result: result("A", "WALKOVER") }));
    });

    it("nobody can delete a match state: a recorded result is history", async () => {
      await env.withSecurityRulesDisabled(async (ctx) => setDoc(ms(ctx.firestore(), F1), { fixtureId: F1, version: 1, data: {} }));
      await assertFails(deleteDoc(ms(as(COORD), F1)));
      await assertFails(deleteDoc(ms(as(ROOT), F1)));
    });
  });

  describe("Super Admin", () => {
    it("walkover on a SCHEDULED fixture: fixture -> COMPLETED + advance + match state, one batch", async () => {
      const db = as(ROOT);
      const f1 = by(fixtures, F1);
      const b = writeBatch(db);
      b.update(fx(db, F1), { status: "COMPLETED" });
      b.update(fx(db, FINAL), { slotA: clean(f1.slotA) });
      b.set(ms(db, F1), { fixtureId: F1, version: 1, result: result("A", "WALKOVER") });
      await assertSucceeds(b.commit());
    });

    it("publish: DRAFT -> SCHEDULED", async () => {
      await seed({ [F1]: { status: "DRAFT" } });
      await assertSucceeds(updateDoc(fx(as(ROOT), F1), { status: "SCHEDULED" }));
    });

    it("cannot swap entrants on a LIVE or COMPLETED fixture, or reopen a COMPLETED one", async () => {
      await seed({ [F1]: { status: "LIVE" }, [F2]: { status: "COMPLETED" } });
      const db = as(ROOT);
      await assertFails(updateDoc(fx(db, F1), { slotA: { kind: "TEAM", teamId: "t4" } }));
      await assertFails(updateDoc(fx(db, F2), { slotA: { kind: "TEAM", teamId: "t4" } }));
      await assertFails(updateDoc(fx(db, F2), { status: "LIVE" }));
    });

    it("can regenerate DRAFT scaffolding (overwrite incl. snapshot) but not a SCHEDULED fixture", async () => {
      await seed({ [F1]: { status: "DRAFT" } });
      const db = as(ROOT);
      const snap = { configVersion: 2 };
      await assertSucceeds(setDoc(fx(db, F1), clean({ ...by(fixtures, F1), status: "DRAFT", matchConfigurationSnapshot: snap })));
      await assertFails(setDoc(fx(db, F2), clean({ ...by(fixtures, F2), matchConfigurationSnapshot: snap })));
    });

    it("can overwrite an auto-completed BYE fixture when regenerating, but not a played one", async () => {
      const bye = { status: "COMPLETED" as const, slotB: { kind: "BYE" as const } };
      await seed({ [F1]: bye, [F2]: { status: "COMPLETED" } });
      const db = as(ROOT);
      await assertSucceeds(setDoc(fx(db, F1), clean({ ...by(fixtures, F1), status: "DRAFT" })));
      await assertFails(setDoc(fx(db, F2), clean({ ...by(fixtures, F2), status: "DRAFT" })));
    });
  });

  describe("fixture deletion", () => {
    it("a Super Admin can delete generation scaffolding (DRAFT) but not scheduled, live or played fixtures", async () => {
      await seed({ [F1]: { status: "DRAFT" }, [F2]: { status: "LIVE" }, [FINAL]: { status: "COMPLETED" } });
      const db = as(ROOT);
      await assertSucceeds(deleteDoc(fx(db, F1)));
      await assertFails(deleteDoc(fx(db, F2)));
      await assertFails(deleteDoc(fx(db, FINAL)));
    });
  });

  describe("audit logs", () => {
    const entry = (actorEmail: string, over: Record<string, unknown> = {}) => ({
      action: "startMatch", actorEmail, targetType: "fixture", targetId: F1, createdAt: "2026-10-02T00:00:00Z", ...over,
    });
    it("an admin can append an entry as themselves, with their real role", async () => {
      await assertSucceeds(setDoc(doc(as(COORD), "auditLogs", "a1"), entry(COORD, { actorRole: "SPORT_COORDINATOR" })));
    });
    it("cannot forge another admin's identity or claim another role", async () => {
      const db = as(COORD);
      await assertFails(setDoc(doc(db, "auditLogs", "a2"), entry(ROOT)));
      await assertFails(setDoc(doc(db, "auditLogs", "a3"), entry(COORD, { actorRole: "SUPER_ADMIN" })));
    });
    it("rejects unknown keys, non-admins, and any edit or delete", async () => {
      await assertFails(setDoc(doc(as(COORD), "auditLogs", "a4"), entry(COORD, { extra: 1 })));
      await assertFails(setDoc(doc(as("nobody@example.com"), "auditLogs", "a5"), entry("nobody@example.com")));
      await assertSucceeds(setDoc(doc(as(ROOT), "auditLogs", "a6"), entry(ROOT)));
      await assertFails(updateDoc(doc(as(ROOT), "auditLogs", "a6"), { action: "other" }));
      await assertFails(deleteDoc(doc(as(ROOT), "auditLogs", "a6")));
    });
    it("only a Super Admin can read them", async () => {
      await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "auditLogs", "a7"), entry(ROOT)));
      await assertSucceeds(getDoc(doc(as(ROOT), "auditLogs", "a7")));
      await assertFails(getDoc(doc(as(COORD), "auditLogs", "a7")));
      await assertFails(getDoc(doc(anon(), "auditLogs", "a7")));
    });
  });

  describe("bracket generation: all fixtures plus the audit entry in one batch", () => {
    const fixtureDoc = (prefix: string, i: number, status = "DRAFT") => ({
      fixtureId: `${prefix}-r1-m${i}`, competitionId: prefix, sportId: "S1", round: 1, matchNumber: i + 1, status,
      slotA: { kind: "TBD" }, slotB: { kind: "TBD" },
    });
    const entry = (prefix: string) => ({
      action: "generateBracket", actorEmail: ROOT, actorRole: "SUPER_ADMIN", targetType: "competition", targetId: prefix,
      createdAt: "2026-10-10T00:00:00Z",
    });
    const generate = (prefix: string, n: number, auditId = `${prefix}-audit`) => {
      const db = as(ROOT);
      const b = writeBatch(db);
      for (let i = 0; i < n; i++) b.set(doc(db, "fixtures", `${prefix}-r1-m${i}`), fixtureDoc(prefix, i));
      b.set(doc(db, "auditLogs", auditId), entry(prefix));
      return b.commit();
    };
    const seedDrafts = async (prefix: string, n: number) =>
      env.withSecurityRulesDisabled(async (ctx) => {
        for (let i = 0; i < n; i++) await setDoc(doc(ctx.firestore(), "fixtures", `${prefix}-r1-m${i}`), fixtureDoc(prefix, i));
      });

    it("an 8-entrant bracket (7 fixtures) and a 16-entrant bracket (15 fixtures) commit atomically, each with its own audit entry", async () => {
      await assertSucceeds(generate("gen7", 7));
      await assertSucceeds(generate("gen15", 15));
    });

    it("an audit entry is append-only: writing the same audit id again is denied and nothing else in that batch persists", async () => {
      await assertSucceeds(generate("gen7", 7));
      await assertFails(generate("gen15", 15, "gen7-audit"));
      await env.withSecurityRulesDisabled(async (ctx) => {
        if ((await getDoc(doc(ctx.firestore(), "fixtures", "gen15-r1-m14"))).exists()) throw new Error("a rejected batch persisted a fixture");
      });
    });

    it("regenerating over DRAFT scaffolding commits: existing fixtures overwritten, new ones created, a leftover deleted, new audit entry", async () => {
      await seedDrafts("regen", 7);
      const db = as(ROOT);
      const b = writeBatch(db);
      for (let i = 0; i < 6; i++) b.set(doc(db, "fixtures", `regen-r1-m${i}`), fixtureDoc("regen", i));
      for (let i = 7; i < 10; i++) b.set(doc(db, "fixtures", `regen-r1-m${i}`), fixtureDoc("regen", i));
      b.delete(doc(db, "fixtures", "regen-r1-m6"));
      b.set(doc(db, "auditLogs", "regen-audit-2"), entry("regen"));
      await assertSucceeds(b.commit());
    });
  });

  describe("import commit: sports plus audit entry in one batch", () => {
    const SPORTS = 9;
    const audit = (actorEmail: string, over: Record<string, unknown> = {}) => ({
      action: "commitImport", actorEmail, actorRole: "SUPER_ADMIN", targetType: "import", targetId: "import-1",
      after: { sports: SPORTS }, createdAt: "2026-10-10T00:00:00Z", ...over,
    });
    const importBatch = (db: ReturnType<typeof as>, entry: Record<string, unknown>) => {
      const b = writeBatch(db);
      for (let i = 0; i < SPORTS; i++) {
        b.set(doc(db, "sports", `import-sport-${i}`), { sportId: `import-sport-${i}`, name: `Sport ${i}`, scoringModel: "RESULT_ONLY", displayOrder: i, active: true });
      }
      b.set(doc(db, "auditLogs", "import-1"), entry);
      return b.commit();
    };
    const sportExists = async (i: number) => {
      let found = false;
      await env.withSecurityRulesDisabled(async (ctx) => {
        found = (await getDoc(doc(ctx.firestore(), "sports", `import-sport-${i}`))).exists();
      });
      return found;
    };

    it("an active Super Admin commits nine new sports and the audit entry together", async () => {
      await assertSucceeds(importBatch(as(ROOT), audit(ROOT)));
      for (let i = 0; i < SPORTS; i++) if (!(await sportExists(i))) throw new Error(`sport ${i} missing after commit`);
    });

    it("a coordinator, a non-admin and an inactive admin cannot commit it", async () => {
      await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "admins", "gone@example.com"), adminDoc("gone@example.com", "SUPER_ADMIN", [], false)));
      await assertFails(importBatch(as(COORD), audit(COORD, { actorRole: "SPORT_COORDINATOR" })));
      await assertFails(importBatch(as("nobody@example.com"), audit("nobody@example.com")));
      await assertFails(importBatch(as("gone@example.com"), audit("gone@example.com")));
      if (await sportExists(0)) throw new Error("a rejected import persisted a sport");
    });

    it("an invalid audit entry rejects the whole batch and no sport persists", async () => {
      await assertFails(importBatch(as(ROOT), audit(ROOT, { extra: 1 })));
      await assertFails(importBatch(as(ROOT), audit(COORD)));
      await assertFails(importBatch(as(ROOT), audit(ROOT, { actorRole: "SPORT_COORDINATOR" })));
      for (let i = 0; i < SPORTS; i++) if (await sportExists(i)) throw new Error(`sport ${i} persisted without its audit entry`);
    });
  });

  describe("admins", () => {
    it("only a Super Admin writes admins, with a valid shape; nobody deletes them", async () => {
      const next = adminDoc("new@example.com", "SPORT_COORDINATOR", ["basketball"]);
      await assertSucceeds(setDoc(doc(as(ROOT), "admins", "new@example.com"), next));
      await assertFails(setDoc(doc(as(COORD), "admins", "new2@example.com"), adminDoc("new2@example.com", "SUPER_ADMIN", [])));
      await assertFails(setDoc(doc(as(ROOT), "admins", "bad@example.com"), adminDoc("bad@example.com", "GOD", [])));
      await assertFails(setDoc(doc(as(ROOT), "admins", "mismatch@example.com"), adminDoc("other@example.com", "SPORT_COORDINATOR", [])));
      await assertFails(deleteDoc(doc(as(ROOT), "admins", COORD)));
    });

    it("there is only one Super Admin: nobody can be created or promoted to it, and it cannot be demoted or deactivated", async () => {
      await assertFails(setDoc(doc(as(ROOT), "admins", "second@example.com"), adminDoc("second@example.com", "SUPER_ADMIN", [])));
      await assertFails(updateDoc(doc(as(ROOT), "admins", COORD), { role: "SUPER_ADMIN", sportIds: [] }));
      await assertFails(updateDoc(doc(as(ROOT), "admins", ROOT), { role: "SPORT_COORDINATOR", sportIds: ["basketball"] }));
      await assertFails(updateDoc(doc(as(ROOT), "admins", ROOT), { active: false }));
      await assertSucceeds(updateDoc(doc(as(ROOT), "admins", ROOT), { displayName: "Root" }));
      await assertSucceeds(updateDoc(doc(as(ROOT), "admins", COORD), { active: false }));
    });
  });

  describe("competitions, sports, entrants", () => {
    const comp = (over: Record<string, unknown> = {}) => ({ competitionId: COMP, sportId: "basketball", name: "M", categoryKey: "open", gender: null, participantType: "TEAM", format: "KNOCKOUT", published: false, displayOrder: 0, ...over });

    it("publish only goes false -> true; cannot create published or unpublish", async () => {
      const db = as(ROOT);
      await assertFails(setDoc(doc(db, "competitions", "born-public"), comp({ competitionId: "born-public", published: true })));
      await assertSucceeds(setDoc(doc(db, "competitions", COMP), comp()));
      await assertSucceeds(updateDoc(doc(db, "competitions", COMP), { published: true }));
      await assertFails(updateDoc(doc(db, "competitions", COMP), { published: false }));
    });

    it("matchConfiguration can only change with a configVersion bump", async () => {
      await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "competitions", COMP), comp({ matchConfiguration: { configVersion: 2, scoringModel: "BASKETBALL_POINTS" } })));
      const ref = doc(as(ROOT), "competitions", COMP);
      await assertFails(updateDoc(ref, { matchConfiguration: { configVersion: 2, scoringModel: "SETS_POINTS" } }));
      await assertFails(updateDoc(ref, { matchConfiguration: { configVersion: 1, scoringModel: "SETS_POINTS" } }));
      await assertSucceeds(updateDoc(ref, { matchConfiguration: { configVersion: 3, scoringModel: "BASKETBALL_POINTS" } }));
    });

    it("entrants move ACTIVE -> WITHDRAWN only; coordinators cannot write entrants", async () => {
      const team = { teamId: "t1", sportId: "basketball", competitionId: COMP, college: "X", captainParticipantId: "p1", memberIds: ["p1"] };
      await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "teams", "t1"), team));
      await assertFails(updateDoc(doc(as(COORD), "teams", "t1"), { college: "Y" }));
      await assertSucceeds(updateDoc(doc(as(ROOT), "teams", "t1"), { status: "WITHDRAWN" }));
      await assertFails(updateDoc(doc(as(ROOT), "teams", "t1"), { status: "ACTIVE" }));
      await assertFails(setDoc(doc(as(ROOT), "teams", "t2"), { ...team, teamId: "t2", status: "WITHDRAWN" }));
    });
  });

  describe("public reads", () => {
    it("DRAFT fixtures and unpublished competitions are hidden from the public; published/scheduled are visible", async () => {
      await seed({ [F1]: { status: "DRAFT" } });
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "competitions", "hidden"), { competitionId: "hidden", published: false });
        await setDoc(doc(ctx.firestore(), "competitions", "shown"), { competitionId: "shown", published: true });
      });
      await assertFails(getDoc(fx(anon(), F1)));
      await assertSucceeds(getDoc(fx(anon(), F2)));
      await assertFails(getDoc(doc(anon(), "competitions", "hidden")));
      await assertSucceeds(getDoc(doc(anon(), "competitions", "shown")));
    });
  });

  describe("siteContent", () => {
    const sc = (db: ReturnType<typeof as>, id: string) => doc(db, "siteContent", id);
    const galleryDoc = (count = 1) => ({ items: Array.from({ length: count }, (_, i) => ({ id: `item-${i}` })), updatedAt: "t", updatedBy: ROOT });
    const committeeDoc = (count = 1) => ({ members: Array.from({ length: count }, (_, i) => ({ id: `member-${i}` })), updatedAt: "t", updatedBy: ROOT });

    it("is readable by anyone, including signed-out visitors", async () => {
      await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "siteContent", "gallery"), galleryDoc()));
      await assertSucceeds(getDoc(sc(anon(), "gallery")));
      await assertSucceeds(getDoc(sc(anon(), "details")));
    });

    it("lets only the Super Admin write the three documents, in the shapes the Worker writes", async () => {
      const db = as(ROOT);
      await assertSucceeds(setDoc(sc(db, "gallery"), galleryDoc(2)));
      await assertSucceeds(updateDoc(sc(db, "gallery"), { items: galleryDoc(3).items, updatedAt: "t2", updatedBy: ROOT }));
      await assertSucceeds(setDoc(sc(db, "committee"), committeeDoc(2)));
      await assertSucceeds(setDoc(sc(db, "details"), { eventLabel: "Annual Sports Meet", contact: { email: "a@b.co" }, updatedAt: "t", updatedBy: ROOT }));
      await assertSucceeds(setDoc(sc(db, "details"), { footerNote: "Annual sports meet.", heroTitle: "KSHITIJ 3.0", updatedAt: "t", updatedBy: ROOT }));
      await assertSucceeds(setDoc(sc(db, "details"), { updatedAt: "t", updatedBy: ROOT }));
    });

    it("refuses writes from coordinators, signed-out visitors and inactive admins", async () => {
      await assertFails(setDoc(sc(as(COORD), "gallery"), galleryDoc()));
      await assertFails(setDoc(sc(anon(), "details"), { eventLabel: "x" }));
      await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "admins", "gone@example.com"), adminDoc("gone@example.com", "SUPER_ADMIN", [], false)));
      await assertFails(setDoc(sc(as("gone@example.com"), "gallery"), galleryDoc()));
    });

    it("refuses unknown document ids, extra keys, wrong field types and oversized lists", async () => {
      const db = as(ROOT);
      await assertFails(setDoc(sc(db, "other"), galleryDoc()));
      await assertFails(setDoc(sc(db, "gallery"), { ...galleryDoc(), extra: true }));
      await assertFails(setDoc(sc(db, "gallery"), { items: "nope" }));
      await assertFails(setDoc(sc(db, "gallery"), committeeDoc()));
      await assertFails(setDoc(sc(db, "gallery"), galleryDoc(201)));
      await assertFails(setDoc(sc(db, "committee"), committeeDoc(101)));
      await assertFails(setDoc(sc(db, "committee"), { members: {} }));
      await assertFails(setDoc(sc(db, "details"), { eventLabel: "x", surprise: 1 }));
      await assertFails(setDoc(sc(db, "details"), { contact: "text" }));
    });

    it("can never be deleted by a client", async () => {
      await assertSucceeds(setDoc(sc(as(ROOT), "gallery"), galleryDoc()));
      await assertFails(deleteDoc(sc(as(ROOT), "gallery")));
      await assertFails(deleteDoc(sc(as(COORD), "gallery")));
    });
  });
});
