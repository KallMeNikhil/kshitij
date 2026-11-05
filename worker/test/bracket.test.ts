import { describe, expect, it, vi } from "vitest";
import { generateBracket } from "../src/operations/bracket";
import type { AuthContext } from "../src/auth/authorize";
import type { CompetitionDoc, TeamDoc } from "../../shared/types";

function fakeDb(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    beginTransaction: vi.fn().mockResolvedValue("txn-1"),
    rollback: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    getDocument: vi.fn(),
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

const competition: CompetitionDoc = {
  competitionId: "basketball-mens",
  sportId: "basketball",
  name: "Men's Basketball",
  categoryKey: "open",
  gender: null,
  participantType: "TEAM",
  format: "KNOCKOUT",
  teamSize: { min: 5, max: 8 },
  published: false,
  displayOrder: 0,
};

function team(id: string): TeamDoc {
  return { teamId: id, sportId: "basketball", competitionId: "basketball-mens", college: id, captainParticipantId: "p1", memberIds: ["p1"] };
}

describe("generateBracket entrant ordering", () => {
  it("seeds entrants in a stable id order, not Firestore query order, when no entrantIds are given", async () => {
    const rows = [team("gamma"), team("alpha"), team("beta"), team("delta")].map((data) => ({ id: data.teamId, data }));
    const db = fakeDb({
      getDocument: vi.fn().mockResolvedValue(competition),
      runQuery: vi.fn().mockImplementation((collection: string) => (collection === "teams" ? rows : [])),
    });
    await generateBracket(ctxFor(db), { competitionId: "basketball-mens" });
    const writes = db.commit.mock.calls[0][1];
    const r1m1 = writes.find((w: { id: string }) => w.id === "basketball-mens-r1-m01");

    expect(r1m1.data.slotA.teamId).toBe("alpha");
    expect(r1m1.data.slotB.teamId).toBe("gamma");
  });

  it("honors entrantIds as the explicit manual seed order, not Firestore query order", async () => {
    const rows = [team("gamma"), team("alpha"), team("beta"), team("delta")].map((data) => ({ id: data.teamId, data }));
    const db = fakeDb({
      getDocument: vi.fn().mockResolvedValue(competition),
      runQuery: vi.fn().mockImplementation((collection: string) => (collection === "teams" ? rows : [])),
    });

    await generateBracket(ctxFor(db), {
      competitionId: "basketball-mens",
      entrantIds: ["alpha", "beta", "gamma", "delta"],
    });
    const writes = db.commit.mock.calls[0][1];
    const r1m1 = writes.find((w: { id: string }) => w.id === "basketball-mens-r1-m01");

    expect(r1m1.data.slotA.teamId).toBe("alpha");
    expect(r1m1.data.slotB.teamId).toBe("delta");
    const r1m2 = writes.find((w: { id: string }) => w.id === "basketball-mens-r1-m02");

    expect(r1m2.data.slotA.teamId).toBe("beta");
    expect(r1m2.data.slotB.teamId).toBe("gamma");
  });

  it("shuffles entrants when tournamentConfiguration.seeding is RANDOM", async () => {
    const rows = [team("gamma"), team("alpha"), team("beta"), team("delta")].map((data) => ({ id: data.teamId, data }));
    const randomCompetition = { ...competition, tournamentConfiguration: { seeding: "RANDOM" as const, byePolicy: "TOP_SEEDS" as const } };
    const db = fakeDb({
      getDocument: vi.fn().mockResolvedValue(randomCompetition),
      runQuery: vi.fn().mockImplementation((collection: string) => (collection === "teams" ? rows : [])),
    });
    await generateBracket(ctxFor(db), { competitionId: "basketball-mens" });
    const writes = db.commit.mock.calls[0][1];
    const fixtureWrites = writes.filter((w: { collection: string }) => w.collection === "fixtures");
    const seededTeamIds = fixtureWrites
      .flatMap((w: { data: { slotA: { teamId?: string }; slotB: { teamId?: string } } }) => [w.data.slotA.teamId, w.data.slotB.teamId])
      .filter((id: string | undefined): id is string => !!id);

    expect(new Set(seededTeamIds)).toEqual(new Set(["gamma", "alpha", "beta", "delta"]));
  });

  it("rejects RANKING seeding as not yet supported instead of guessing a rule", async () => {
    const rows = [team("gamma"), team("alpha")].map((data) => ({ id: data.teamId, data }));
    const rankingCompetition = { ...competition, tournamentConfiguration: { seeding: "RANKING" as const, byePolicy: "TOP_SEEDS" as const } };
    const db = fakeDb({
      getDocument: vi.fn().mockResolvedValue(rankingCompetition),
      runQuery: vi.fn().mockImplementation((collection: string) => (collection === "teams" ? rows : [])),
    });
    await expect(generateBracket(ctxFor(db), { competitionId: "basketball-mens" })).rejects.toMatchObject({
      code: "SEEDING_STRATEGY_NOT_YET_SUPPORTED",
    });
    expect(db.commit).not.toHaveBeenCalled();
  });
});
