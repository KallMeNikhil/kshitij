import { describe, expect, it, vi } from "vitest";
import { updateSportConfig, updateCompetitionConfig } from "../src/operations/config";
import type { AuthContext } from "../src/auth/authorize";
import { defaultMatchConfigurations } from "../../shared/matchConfig";

function fakeDb(overrides: Partial<Record<string, unknown>> = {}) {
  const db = {
    beginTransaction: vi.fn().mockResolvedValue("txn-1"),
    rollback: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    getDocument: vi.fn(),
    runQuery: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  return db;
}

function ctxFor(db: unknown, role: "SUPER_ADMIN" | "SPORT_COORDINATOR" = "SUPER_ADMIN"): AuthContext {
  return {
    email: "admin@example.com",
    admin: { email: "admin@example.com", role, sportIds: [], active: true, createdAt: "", createdBy: "", updatedAt: "", updatedBy: "" },
    db: db as AuthContext["db"],
  };
}

const basketballConfig = defaultMatchConfigurations.basketball!;

describe("updateSportConfig", () => {
  it("rejects non-Super-Admin callers", async () => {
    const db = fakeDb();
    await expect(
      updateSportConfig(ctxFor(db, "SPORT_COORDINATOR"), { sportId: "basketball", matchConfiguration: basketballConfig })
    ).rejects.toMatchObject({ code: "SUPER_ADMIN_REQUIRED" });
  });

  it("rejects an invalid match configuration", async () => {
    const db = fakeDb({ getDocument: vi.fn().mockResolvedValue({ sportId: "basketball" }) });
    await expect(
      updateSportConfig(ctxFor(db), { sportId: "basketball", matchConfiguration: { scoringModel: "NOT_REAL" } })
    ).rejects.toMatchObject({ code: "INVALID_MATCH_CONFIGURATION" });
  });

  it("rejects a structure kind that doesn't match the scoring model", async () => {
    const db = fakeDb({ getDocument: vi.fn().mockResolvedValue({ sportId: "basketball" }) });
    const bad = { ...basketballConfig, structure: { kind: "RESULT_ONLY", drawAllowed: true, pointDetail: "NONE" } };
    await expect(
      updateSportConfig(ctxFor(db), { sportId: "basketball", matchConfiguration: bad })
    ).rejects.toMatchObject({ code: "INVALID_MATCH_CONFIGURATION" });
  });

  it("accepts a valid configuration, bumps configVersion, and audits before/after", async () => {
    const db = fakeDb({ getDocument: vi.fn().mockResolvedValue({ sportId: "basketball", matchConfiguration: { ...basketballConfig, configVersion: 3 } }) });
    const result = (await updateSportConfig(ctxFor(db), {
      sportId: "basketball",
      matchConfiguration: basketballConfig,
    })) as { ok: boolean; matchConfiguration: { configVersion: number } };
    expect(result.ok).toBe(true);
    expect(result.matchConfiguration.configVersion).toBe(4);
    expect(db.commit).toHaveBeenCalledTimes(1);
    const writes = db.commit.mock.calls[0][1];
    expect(writes[0].collection).toBe("sports");
    expect(writes[0].mergeFields).toEqual(["matchConfiguration"]);
    expect(writes[1].collection).toBe("auditLogs");
    expect((writes[1].data as { action: string }).action).toBe("updateSportConfig");
  });
});

describe("updateCompetitionConfig", () => {
  const competition = {
    competitionId: "basketball-mens",
    sportId: "basketball",
    participantType: "TEAM",
    matchConfiguration: basketballConfig,
  };

  it("blocks changes once play has started, but allows them on an unstarted published bracket after acknowledgement", async () => {
    const withFixture = (data: Record<string, unknown>, matchState: unknown = null) =>
      fakeDb({
        getDocument: vi.fn().mockImplementation(async (collection: string) => (collection === "matchStates" ? matchState : competition)),
        runQuery: vi.fn().mockResolvedValue([{ id: "f1", data: { fixtureId: "f1", slotA: { kind: "TEAM" }, slotB: { kind: "TEAM" }, ...data } }]),
      });
    const input = { competitionId: "basketball-mens", matchConfiguration: basketballConfig };
    await expect(updateCompetitionConfig(ctxFor(withFixture({ status: "LIVE" })), input)).rejects.toMatchObject({ code: "CONFIGURATION_LOCKED_OPERATIONAL_FIXTURES_EXIST" });
    await expect(updateCompetitionConfig(ctxFor(withFixture({ status: "SCHEDULED" }, { version: 1 })), input)).rejects.toMatchObject({
      code: "CONFIGURATION_LOCKED_OPERATIONAL_FIXTURES_EXIST",
    });
    await expect(updateCompetitionConfig(ctxFor(withFixture({ status: "SCHEDULED" })), input)).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED_EXISTING_DRAFT_FIXTURES" });
    await expect(updateCompetitionConfig(ctxFor(withFixture({ status: "SCHEDULED" })), { ...input, acknowledgeExistingFixtures: true })).resolves.toMatchObject({ ok: true });
  });

  it("requires explicit acknowledgement when DRAFT fixtures already exist", async () => {
    const db = fakeDb({
      getDocument: vi.fn().mockResolvedValue(competition),
      runQuery: vi.fn().mockResolvedValue([{ id: "f1", data: { status: "DRAFT" } }]),
    });
    await expect(
      updateCompetitionConfig(ctxFor(db), { competitionId: "basketball-mens", matchConfiguration: basketballConfig })
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED_EXISTING_DRAFT_FIXTURES" });

    const result = (await updateCompetitionConfig(ctxFor(db), {
      competitionId: "basketball-mens",
      matchConfiguration: basketballConfig,
      acknowledgeExistingFixtures: true,
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("rejects a participantType mismatch between the competition and the new configuration", async () => {
    const db = fakeDb({ getDocument: vi.fn().mockResolvedValue({ ...competition, participantType: "INDIVIDUAL" }) });
    await expect(
      updateCompetitionConfig(ctxFor(db), { competitionId: "basketball-mens", matchConfiguration: basketballConfig })
    ).rejects.toMatchObject({ code: "MATCH_CONFIGURATION_PARTICIPANT_TYPE_MISMATCH" });
  });

  it("allows a straightforward change when no fixtures exist yet", async () => {
    const db = fakeDb({ getDocument: vi.fn().mockResolvedValue(competition), runQuery: vi.fn().mockResolvedValue([]) });
    const result = (await updateCompetitionConfig(ctxFor(db), {
      competitionId: "basketball-mens",
      matchConfiguration: basketballConfig,
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
  });
});

describe("updateSportConfig with stage-specific round overrides", () => {
  const tt = defaultMatchConfigurations["table-tennis"]!;

  it("accepts, persists and audits round overrides (Super Admin edits them like any other field)", async () => {
    const edited = {
      ...tt,
      roundOverrides: [{ roundsFromEnd: 0, structure: { kind: "SETS_POINTS" as const, bestOf: 7, pointsToWin: 11 } }],
    };
    const db = fakeDb({ getDocument: vi.fn().mockResolvedValue({ sportId: "table-tennis", matchConfiguration: tt }) });
    const result = (await updateSportConfig(ctxFor(db), { sportId: "table-tennis", matchConfiguration: edited })) as {
      matchConfiguration: { roundOverrides: Array<{ structure: { bestOf: number } }> };
    };
    expect(result.matchConfiguration.roundOverrides[0].structure.bestOf).toBe(7);
    const writes = db.commit.mock.calls[0][1];
    expect((writes[0].data as { matchConfiguration: { roundOverrides: unknown[] } }).matchConfiguration.roundOverrides).toHaveLength(1);
    expect((writes[1].data as { before: { roundOverrides: unknown[] } }).before.roundOverrides).toHaveLength(2);
  });

  it("rejects an override whose structure kind differs from the sport's", async () => {
    const bad = { ...tt, roundOverrides: [{ roundsFromEnd: 0, structure: { kind: "GAMES_SETS" as const, bestOfSets: 5 } }] };
    const db = fakeDb({ getDocument: vi.fn().mockResolvedValue({ sportId: "table-tennis" }) });
    await expect(updateSportConfig(ctxFor(db), { sportId: "table-tennis", matchConfiguration: bad })).rejects.toBeTruthy();
    expect(db.commit).not.toHaveBeenCalled();
  });
});

describe("updateCompetitionConfig input strictness", () => {
  const tt = defaultMatchConfigurations["table-tennis"]!;
  it("does not treat a truthy non-boolean as the acknowledgement for existing DRAFT fixtures", async () => {
    const db = fakeDb({ getDocument: vi.fn().mockResolvedValue({ competitionId: "tt-mens", sportId: "table-tennis", participantType: "INDIVIDUAL" }), runQuery: vi.fn().mockResolvedValue([{ id: "f", data: { status: "DRAFT" } }]) });
    for (const bad of ["false", "yes", 1, {}]) {
      await expect(updateCompetitionConfig(ctxFor(db), { competitionId: "tt-mens", matchConfiguration: tt, acknowledgeExistingFixtures: bad })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(db.commit).not.toHaveBeenCalled();
  });
});
