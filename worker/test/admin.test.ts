import { describe, expect, it, vi } from "vitest";
import { upsertEntity, deleteEntity } from "../src/operations/admin";
import type { AuthContext } from "../src/auth/authorize";

function fakeDb(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    beginTransaction: vi.fn().mockResolvedValue("txn-1"),
    rollback: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    getDocument: vi.fn().mockResolvedValue(null),
    runQuery: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function ctxFor(db: unknown): AuthContext {
  return {
    email: "admin@example.com",
    admin: {
      email: "admin@example.com",
      role: "SUPER_ADMIN",
      sportIds: [],
      active: true,
      createdAt: "",
      createdBy: "",
      updatedAt: "",
      updatedBy: "",
    },
    db: db as AuthContext["db"],
  };
}

describe("upsertEntity", () => {
  it("rejects a sport document that fails the canonical schema", async () => {
    const db = fakeDb();
    await expect(
      upsertEntity(ctxFor(db), { collection: "sports", id: "basketball", data: { name: "Basketball"  } })
    ).rejects.toMatchObject({ code: "INVALID_ENTITY" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("accepts a valid new sport and commits the fully-parsed document", async () => {
    const db = fakeDb();
    const result = (await upsertEntity(ctxFor(db), {
      collection: "sports",
      id: "basketball",
      data: { sportId: "basketball", name: "Basketball", scoringModel: "BASKETBALL_POINTS" },
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    const writes = db.commit.mock.calls[0][1];
    expect(writes[0].data).toMatchObject({ sportId: "basketball", name: "Basketball", active: true });
  });

  it("merges onto the existing document so a partial edit still validates against the full schema", async () => {
    const db = fakeDb({
      getDocument: vi
        .fn()
        .mockResolvedValue({ sportId: "basketball", name: "Basketball", scoringModel: "BASKETBALL_POINTS", displayOrder: 0, active: true }),
    });
    const result = (await upsertEntity(ctxFor(db), {
      collection: "sports",
      id: "basketball",
      data: { name: "Basketball (5x5)" },
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    const writes = db.commit.mock.calls[0][1];
    expect(writes[0].data).toMatchObject({ name: "Basketball (5x5)", scoringModel: "BASKETBALL_POINTS" });
  });

  it("rejects a direct matchConfiguration write and points to the dedicated operation", async () => {
    const db = fakeDb();
    await expect(
      upsertEntity(ctxFor(db), {
        collection: "sports",
        id: "basketball",
        data: { matchConfiguration: { scoringModel: "BASKETBALL_POINTS" } },
      })
    ).rejects.toMatchObject({ code: "USE_DEDICATED_CONFIG_OPERATION" });
    expect(db.beginTransaction).not.toHaveBeenCalled();
  });

  it("rejects a competition whose competitionId does not start with its sportId", async () => {
    const db = fakeDb();
    await expect(
      upsertEntity(ctxFor(db), {
        collection: "competitions",
        id: "mens-open",
        data: {
          competitionId: "mens-open",
          sportId: "basketball",
          name: "Men's Open",
          categoryKey: "open",
          participantType: "TEAM",
          teamSize: { min: 5, max: 8 },
        },
      })
    ).rejects.toMatchObject({ code: "INVALID_ENTITY" });
  });

  const basketballCompetitionWithConfig = {
    competitionId: "basketball-mens",
    sportId: "basketball",
    name: "Men's Basketball",
    categoryKey: "open",
    participantType: "TEAM",
    format: "KNOCKOUT",
    teamSize: { min: 5, max: 8 },
    published: false,
    displayOrder: 0,
    matchConfiguration: {
      configVersion: 1,
      scoringModel: "BASKETBALL_POINTS",
      participantModel: { participantType: "TEAM", teamSize: { min: 5, max: 8 }, substitutesAllowed: 3 },
      structure: { kind: "PERIODS", periodLabel: "QUARTER", periodCount: 4, minutesPerPeriod: 10, drawAllowed: false },
      walkoverBehavior: "OPPONENT_WINS",
      byeBehavior: "AUTO_ADVANCE",
      pending: [],
    },
  };

  const validTeamData = {
    teamId: "basketball-mens-team-a",
    sportId: "basketball",
    competitionId: "basketball-mens",
    college: "JIIT",
    captainParticipantId: "p1",
    memberIds: ["p1", "p2", "p3", "p4", "p5"],
  };

  it("rejects a team roster below the competition's configured minimum", async () => {
    const db = fakeDb({
      getDocument: vi.fn().mockImplementation((collection: string) =>
        collection === "competitions" ? basketballCompetitionWithConfig : null
      ),
    });
    await expect(
      upsertEntity(ctxFor(db), {
        collection: "teams",
        id: "basketball-mens-team-a",
        data: { ...validTeamData, memberIds: ["p1", "p2"], captainParticipantId: "p1" },
      })
    ).rejects.toMatchObject({ code: "TEAM_ROSTER_BELOW_MINIMUM" });
  });

  it("rejects a team roster that exceeds max starters plus configured substitutes", async () => {
    const db = fakeDb({
      getDocument: vi.fn().mockImplementation((collection: string) =>
        collection === "competitions" ? basketballCompetitionWithConfig : null
      ),
    });

    const memberIds = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
    await expect(
      upsertEntity(ctxFor(db), {
        collection: "teams",
        id: "basketball-mens-team-a",
        data: { ...validTeamData, memberIds, captainParticipantId: "p1" },
      })
    ).rejects.toMatchObject({ code: "TEAM_ROSTER_EXCEEDS_MAXIMUM" });
  });

  it("accepts a team roster within the configured starters + substitutes range", async () => {
    const db = fakeDb({
      getDocument: vi.fn().mockImplementation((collection: string, id: string) =>
        collection === "competitions"
          ? basketballCompetitionWithConfig
          : collection === "participants"
            ? { participantId: id, competitionId: basketballCompetitionWithConfig.competitionId }
            : null
      ),
    });
    const memberIds = Array.from({ length: 10 }, (_, i) => `p${i + 1}`);
    const result = (await upsertEntity(ctxFor(db), {
      collection: "teams",
      id: "basketball-mens-team-a",
      data: { ...validTeamData, memberIds, captainParticipantId: "p1" },
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
  });
});

describe("deleteEntity", () => {
  function fakeDbWithReferences(referencedIn: "slotA" | "slotB" | null) {
    return fakeDb({
      getDocument: vi.fn().mockResolvedValue({ participantId: "p1" }),
      runQuery: vi.fn().mockImplementation((_collection: string, filters: Array<{ field: string }>) => {
        const field = filters[0].field;
        if (referencedIn === "slotA" && field === "slotA.participantId") {
          return Promise.resolve([{ id: "fx-1", data: {} }]);
        }
        if (referencedIn === "slotB" && field === "slotB.participantId") {
          return Promise.resolve([{ id: "fx-1", data: {} }]);
        }
        return Promise.resolve([]);
      }),
    });
  }

  it("blocks deletion when the entity is referenced by slotA of a fixture", async () => {
    const db = fakeDbWithReferences("slotA");
    await expect(
      deleteEntity(ctxFor(db), { collection: "participants", id: "p1" })
    ).rejects.toMatchObject({ code: "ENTITY_REFERENCED_BY_FIXTURE" });

    expect(db.commit).not.toHaveBeenCalled();
    expect(db.rollback).toHaveBeenCalledWith("txn-1");
  });

  it("blocks deletion when the entity is referenced by slotB of a fixture", async () => {
    const db = fakeDbWithReferences("slotB");
    await expect(
      deleteEntity(ctxFor(db), { collection: "participants", id: "p1" })
    ).rejects.toMatchObject({ code: "ENTITY_REFERENCED_BY_FIXTURE" });

    expect(db.commit).not.toHaveBeenCalled();
    expect(db.rollback).toHaveBeenCalledWith("txn-1");
  });

  it("allows deletion when the entity is not referenced by any fixture slot", async () => {
    const db = fakeDbWithReferences(null);
    const result = (await deleteEntity(ctxFor(db), {
      collection: "participants",
      id: "p1",
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(db.commit).toHaveBeenCalled();
  });

  it("skips the fixture-slot reference check for non-entrant collections (e.g. sports)", async () => {
    const db = fakeDb({ getDocument: vi.fn().mockResolvedValue({ sportId: "basketball" }) });
    const result = (await deleteEntity(ctxFor(db), {
      collection: "sports",
      id: "basketball",
    })) as { ok: boolean };
    expect(result.ok).toBe(true);

    const queriedFields = db.runQuery.mock.calls.map((c: unknown[]) => (c[1] as Array<{ field: string }>)[0].field);
    expect(queriedFields).toEqual(["sportId"]);
  });
});

describe("upsertEntity applies the import checks", () => {
  const competitionDoc = { competitionId: "badminton-doubles", sportId: "badminton", name: "Doubles", categoryKey: "d", participantType: "PAIR", format: "KNOCKOUT", published: false, displayOrder: 0 };
  const store = (docs: Record<string, unknown>, rows: Record<string, unknown[]> = {}) =>
    fakeDb({
      getDocument: vi.fn().mockImplementation(async (collection: string, id: string) => docs[`${collection}/${id}`] ?? null),
      runQuery: vi.fn().mockImplementation(async (collection: string) => rows[collection] ?? []),
    });
  const pairTeam = { sportId: "badminton", competitionId: "badminton-doubles", college: "NIT X", captainParticipantId: "badminton-doubles-p1", memberIds: ["badminton-doubles-p1", "badminton-doubles-p2"] };
  const member = (id: string, competitionId = "badminton-doubles") => ({ participantId: id, competitionId });

  it("requires pair members to exist in the same competition and not already be on another team", async () => {
    const docs = { "competitions/badminton-doubles": competitionDoc, "participants/badminton-doubles-p1": member("badminton-doubles-p1"), "participants/badminton-doubles-p2": member("badminton-doubles-p2", "badminton-singles") };
    await expect(upsertEntity(ctxFor(store(docs)), { collection: "teams", id: "badminton-doubles-t1", data: pairTeam })).rejects.toMatchObject({ code: "MEMBER_COMPETITION_MISMATCH" });
    const ok = { ...docs, "participants/badminton-doubles-p2": member("badminton-doubles-p2") };
    const taken = store(ok, { teams: [{ id: "badminton-doubles-t9", data: { memberIds: ["badminton-doubles-p2"] } }] });
    await expect(upsertEntity(ctxFor(taken), { collection: "teams", id: "badminton-doubles-t1", data: pairTeam })).rejects.toMatchObject({ code: "PARTICIPANT_ALREADY_ON_TEAM" });
    await expect(upsertEntity(ctxFor(store(ok)), { collection: "teams", id: "badminton-doubles-t1", data: { ...pairTeam, memberIds: ["badminton-doubles-p1"] } })).rejects.toMatchObject({ code: "PAIR_REQUIRES_EXACTLY_TWO_MEMBERS" });
    await expect(upsertEntity(ctxFor(store(ok)), { collection: "teams", id: "badminton-doubles-t1", data: pairTeam })).resolves.toMatchObject({ ok: true });
  });

  it("normalises participant phones and rejects a duplicate in the same competition", async () => {
    const docs = { "competitions/badminton-doubles": competitionDoc };
    const data = { name: "Asha Rao", phone: "98765 43210", college: "NIT X", sportId: "badminton", competitionId: "badminton-doubles" };
    const db = store(docs);
    await upsertEntity(ctxFor(db), { collection: "participants", id: "badminton-doubles-p1", data });
    expect(db.commit.mock.calls[0][1][0].data.phone).toBe("+919876543210");
    const dup = store(docs, { participants: [{ id: "badminton-doubles-p7", data: { phone: "+919876543210" } }] });
    await expect(upsertEntity(ctxFor(dup), { collection: "participants", id: "badminton-doubles-p1", data })).rejects.toMatchObject({ code: "DUPLICATE_PARTICIPANT" });
  });

  it("gives a new sport a URL slug and rejects one already taken", async () => {
    const db = store({});
    await upsertEntity(ctxFor(db), { collection: "sports", id: "kabaddi", data: { name: "Kabaddi", scoringModel: "BASKETBALL_POINTS" } });
    expect(db.commit.mock.calls[0][1][0].data.slug).toBe("kabaddi");
    const taken = store({}, { sports: [{ id: "other", data: {} }] });
    await expect(upsertEntity(ctxFor(taken), { collection: "sports", id: "kabaddi", data: { name: "Kabaddi", scoringModel: "BASKETBALL_POINTS" } })).rejects.toMatchObject({ code: "DUPLICATE_SLUG" });
  });
});
