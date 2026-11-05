import { describe, expect, it, vi } from "vitest";
import { updateLiveState } from "../src/operations/match";
import type { AuthContext } from "../src/auth/authorize";
import type { FixtureDoc } from "../../shared/types";

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
    email: "coordinator@example.com",
    admin: {
      email: "coordinator@example.com",
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

const liveBasketballFixture: FixtureDoc = {
  fixtureId: "basketball-mens-r1-m01",
  competitionId: "basketball-mens",
  sportId: "basketball",
  round: 1,
  matchNumber: 1,
  slotA: { kind: "TEAM", teamId: "t1" },
  slotB: { kind: "TEAM", teamId: "t2" },
  status: "LIVE",
};

describe("updateLiveState", () => {
  it("rejects a live-state payload that doesn't match the fixture's scoring model shape", async () => {
    const db = fakeDb({
      getDocument: vi.fn().mockImplementation((collection: string) =>
        collection === "fixtures" ? liveBasketballFixture : null
      ),
    });
    await expect(
      updateLiveState(ctxFor(db), {
        fixtureId: liveBasketballFixture.fixtureId,
        expectedVersion: 0,
        data: { totallyWrong: true },
      })
    ).rejects.toMatchObject({ code: "INVALID_LIVE_STATE" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("accepts a well-shaped payload and stamps the resolved scoringModel onto the matchState doc", async () => {
    const db = fakeDb({
      getDocument: vi.fn().mockImplementation((collection: string) =>
        collection === "fixtures" ? liveBasketballFixture : null
      ),
    });
    const result = (await updateLiveState(ctxFor(db), {
      fixtureId: liveBasketballFixture.fixtureId,
      expectedVersion: 0,
      data: { scoreA: 2, scoreB: 0, period: 1, overtime: false },
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    const writes = db.commit.mock.calls[0][1];
    expect(writes[0].data).toMatchObject({ scoringModel: "BASKETBALL_POINTS", version: 1 });
  });

  it("uses the fixture's matchConfigurationSnapshot scoring model over the legacy sport mapping when present", async () => {
    const fixtureWithSnapshot: FixtureDoc = {
      ...liveBasketballFixture,
      sportId: "basketball",
      matchConfigurationSnapshot: {
        configVersion: 1,
        scoringModel: "RESULT_ONLY",
        participantModel: { participantType: "TEAM" },
        structure: { kind: "RESULT_ONLY", drawAllowed: false, pointDetail: "NONE" },
        walkoverBehavior: "OPPONENT_WINS",
        byeBehavior: "AUTO_ADVANCE",
        pending: [],
      },
    };
    const db = fakeDb({
      getDocument: vi.fn().mockImplementation((collection: string) =>
        collection === "fixtures" ? fixtureWithSnapshot : null
      ),
    });

    const result = (await updateLiveState(ctxFor(db), {
      fixtureId: fixtureWithSnapshot.fixtureId,
      expectedVersion: 0,
      data: { outcome: "A" },
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    const writes = db.commit.mock.calls[0][1];
    expect(writes[0].data).toMatchObject({ scoringModel: "RESULT_ONLY" });
  });
});
