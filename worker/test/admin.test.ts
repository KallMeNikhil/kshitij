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
      getDocument: vi.fn().mockImplementation((collection: string) =>
        collection === "competitions" ? basketballCompetitionWithConfig : null
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
