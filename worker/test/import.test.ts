import { describe, expect, it } from "vitest";
import { commitImport } from "../src/operations/import";
import { upsertEntity } from "../src/operations/admin";
import { ctxFor, dbWith } from "./helpers";
import { defaultMatchConfigurations } from "../../shared/matchConfig";

const chessConfig = { ...defaultMatchConfigurations.chess!, participantModel: { ...defaultMatchConfigurations.chess!.participantModel, participantType: "INDIVIDUAL" as const } };

const payload = {
  schemaVersion: "kshitij.canonical/1",
  sports: [{ sportId: "chess", name: "Chess", scoringModel: "RESULT_ONLY" }],
  competitions: [{ competitionId: "chess-open", sportId: "chess", name: "Chess Open", categoryKey: "open", participantType: "INDIVIDUAL", gender: null }],
  participants: [
    { participantId: "chess-open-arjun-1234", name: "Arjun Sharma", phone: "9876543210", college: "NIT X", sportId: "chess", competitionId: "chess-open" },
    { participantId: "chess-open-riya-5678", name: "Riya Patel", phone: "9123456780", college: "NIT Y", sportId: "chess", competitionId: "chess-open" },
  ],
  fixtures: [
    {
      fixtureId: "chess-open-r1-m01", competitionId: "chess-open", round: 1, matchNumber: 1,
      slotA: { kind: "PARTICIPANT", participantId: "chess-open-arjun-1234" },
      slotB: { kind: "PARTICIPANT", participantId: "chess-open-riya-5678" },
    },
  ],
};

const rowsFor = (map: Record<string, unknown[]>) => (collection: string) =>
  (map[collection] ?? []).map((data, i) => ({ id: ((data as Record<string, string>)[`${collection.slice(0, -1)}Id`]) ?? `x${i}`, data }));

describe("commitImport fixture stamping", () => {
  it("stamps sportId and the effective config snapshot on NEW imported fixtures", async () => {
    const db = dbWith({
      queries: rowsFor({
        sports: [{ sportId: "chess", name: "Chess", scoringModel: "RESULT_ONLY", displayOrder: 0, active: true, matchConfiguration: chessConfig }],
      }),
    });
    const withoutSports = { ...payload, sports: undefined };
    const result = (await commitImport(ctxFor(db), withoutSports)) as { ok: boolean };
    expect(result.ok).toBe(true);
    const f = db.commit.mock.calls[0][1].find((w: { collection: string }) => w.collection === "fixtures");
    expect(f.data.sportId).toBe("chess");
    expect(f.data.matchConfigurationSnapshot).toEqual(chessConfig);
    expect(f.mergeFields).toEqual(expect.arrayContaining(["sportId", "matchConfigurationSnapshot"]));
  });

  it("adds a missing sportId to an existing DRAFT fixture but never touches its frozen snapshot", async () => {
    const legacy = { ...payload.fixtures[0], status: "DRAFT" };
    const db = dbWith({
      queries: rowsFor({
        sports: [{ sportId: "chess", name: "Chess", scoringModel: "RESULT_ONLY", displayOrder: 0, active: true, matchConfiguration: chessConfig }],
        competitions: [{ competitionId: "chess-open", sportId: "chess", name: "Chess Open", categoryKey: "open", gender: null, participantType: "INDIVIDUAL", format: "KNOCKOUT", published: false, displayOrder: 0 }],
        fixtures: [legacy],
      }),
    });
    await commitImport(ctxFor(db), { ...payload, sports: undefined, competitions: undefined });
    const f = db.commit.mock.calls[0][1].find((w: { collection: string }) => w.collection === "fixtures");
    expect(f.data.sportId).toBe("chess");
    expect(f.data).not.toHaveProperty("matchConfigurationSnapshot");
  });

  it("does not replace an existing sport's/competition's stored matchConfiguration", async () => {
    const stored = { ...chessConfig, configVersion: 4 };
    const { configVersion: _v, ...same } = stored;
    const db = dbWith({
      queries: rowsFor({
        sports: [{ sportId: "chess", name: "Chess", scoringModel: "RESULT_ONLY", displayOrder: 0, active: true, matchConfiguration: stored }],
        competitions: [{ competitionId: "chess-open", sportId: "chess", name: "Chess Open", categoryKey: "open", gender: null, participantType: "INDIVIDUAL", format: "KNOCKOUT", published: false, displayOrder: 0, matchConfiguration: stored }],
      }),
    });
    await commitImport(ctxFor(db), {
      ...payload,
      sports: [{ ...payload.sports[0], matchConfiguration: same }],
      competitions: [{ ...payload.competitions[0], matchConfiguration: same }],
    });
    const writes = db.commit.mock.calls[0][1];
    for (const w of writes.filter((x: { collection: string }) => x.collection === "sports" || x.collection === "competitions")) {
      expect(w.mergeFields).not.toContain("matchConfiguration");
      expect(w.data).not.toHaveProperty("matchConfiguration");
    }
  });

  it("rejects an import that would change protected config, publish state or entrant status", async () => {
    const db = dbWith({
      queries: rowsFor({
        sports: [{ sportId: "chess", name: "Chess", scoringModel: "RESULT_ONLY", displayOrder: 0, active: true }],
      }),
    });
    await expect(
      commitImport(ctxFor(db), { ...payload, sports: [{ ...payload.sports[0], matchConfiguration: chessConfig }] })
    ).rejects.toMatchObject({ code: "IMPORT_HAS_ERRORS" });
    expect(db.commit).not.toHaveBeenCalled();
  });
});

describe("upsertEntity leaves matchConfiguration to the dedicated operations", () => {
  it("masks matchConfiguration out of the write on an edit of a configured sport", async () => {
    const db = dbWith({
      docs: { "sports/chess": { sportId: "chess", name: "Chess", scoringModel: "RESULT_ONLY", displayOrder: 0, active: true, matchConfiguration: { ...chessConfig, configVersion: 2 } } },
    });
    await upsertEntity(ctxFor(db), { collection: "sports", id: "chess", data: { name: "Chess (Open)" } });
    const w = db.commit.mock.calls[0][1][0];
    expect(w.mergeFields).toContain("name");
    expect(w.mergeFields).not.toContain("matchConfiguration");
  });
});

describe("commitImport reads and validates inside the transaction", () => {
  it("opens the transaction before reading, and passes it to every store read (no stale validation)", async () => {
    const db = dbWith({ queries: () => undefined });
    await commitImport(ctxFor(db), { ...payload, fixtures: undefined });
    const order = [db.beginTransaction.mock.invocationCallOrder[0], ...db.runQuery.mock.invocationCallOrder];
    expect(order[0]).toBeLessThan(Math.min(...order.slice(1)));
    expect(db.runQuery.mock.calls.length).toBeGreaterThanOrEqual(5);
    for (const call of db.runQuery.mock.calls) expect(call[2]).toBe("txn-1");
    expect(db.commit.mock.calls[0][0]).toBe("txn-1");
  });

  it("rolls back and writes nothing when validation fails", async () => {
    const db = dbWith({ queries: () => undefined });
    await expect(commitImport(ctxFor(db), { ...payload, competitions: undefined })).rejects.toMatchObject({ code: "IMPORT_HAS_ERRORS" });
    expect(db.rollback).toHaveBeenCalledWith("txn-1");
    expect(db.commit).not.toHaveBeenCalled();
  });
});
