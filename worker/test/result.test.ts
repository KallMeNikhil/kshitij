import { describe, expect, it, vi } from "vitest";
import { completeMatch } from "../src/operations/result";
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

const liveFixture: FixtureDoc = {
  fixtureId: "basketball-mens-r1-m01",
  competitionId: "basketball-mens",
  sportId: "basketball",
  round: 1,
  matchNumber: 1,
  slotA: { kind: "TEAM", teamId: "t1" },
  slotB: { kind: "TEAM", teamId: "t2" },
  status: "LIVE",
};

function dbFor(fixture: FixtureDoc, matchState: { version: number; data: Record<string, unknown> } | null) {
  const fixtureCopy = { ...fixture };
  return fakeDb({
    getDocument: vi.fn().mockImplementation((collection: string, id: string) => {
      if (collection === "fixtures") return fixtureCopy;
      if (collection === "matchStates") return matchState;
      if (collection === "teams") {
        return { teamId: id, sportId: "basketball", competitionId: "basketball-mens", college: id, captainParticipantId: "p1", memberIds: [] };
      }
      return null;
    }),
    runQuery: vi
      .fn()
      .mockImplementation((collection: string) => (collection === "fixtures" ? [{ id: fixtureCopy.fixtureId, data: fixtureCopy }] : [])),
  });
}

describe("completeMatch winner cross-check", () => {
  it("rejects a submitted winner that contradicts the recorded score for a normal completion", async () => {
    const db = dbFor(liveFixture, { version: 3, data: { scoreA: 90, scoreB: 70, period: 4, overtime: false } });
    await expect(
      completeMatch(ctxFor(db), {
        fixtureId: liveFixture.fixtureId,
        winnerSlot: "B",
        decidedBy: "BASKETBALL_POINTS",
        resultSummary: "90-70",
      })
    ).rejects.toMatchObject({ code: "WINNER_DOES_NOT_MATCH_RECORDED_SCORE" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("accepts a submitted winner that matches the recorded score", async () => {
    const db = dbFor(liveFixture, { version: 3, data: { scoreA: 90, scoreB: 70, period: 4, overtime: false } });
    const result = (await completeMatch(ctxFor(db), {
      fixtureId: liveFixture.fixtureId,
      winnerSlot: "A",
      decidedBy: "BASKETBALL_POINTS",
      resultSummary: "90-70",
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("skips the cross-check for an explicit override (e.g. walkover) decidedBy value", async () => {
    const db = dbFor(liveFixture, { version: 3, data: { scoreA: 90, scoreB: 70, period: 4, overtime: false } });
    const result = (await completeMatch(ctxFor(db), {
      fixtureId: liveFixture.fixtureId,
      winnerSlot: "B",
      decidedBy: "WALKOVER",
      resultSummary: "Opponent no-show",
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it("rejects a level score for a score-decided result and points to the admin override", async () => {
    const db = dbFor(liveFixture, { version: 3, data: { scoreA: 80, scoreB: 80, period: 5, overtime: true } });
    await expect(
      completeMatch(ctxFor(db), {
        fixtureId: liveFixture.fixtureId,
        winnerSlot: "A",
        decidedBy: "BASKETBALL_POINTS",
        resultSummary: "80-80",
      })
    ).rejects.toMatchObject({ code: "WINNER_DOES_NOT_MATCH_RECORDED_SCORE" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("does not block completion when there is no recorded live state yet", async () => {
    const db = dbFor(liveFixture, null);
    const result = (await completeMatch(ctxFor(db), {
      fixtureId: liveFixture.fixtureId,
      winnerSlot: "A",
      decidedBy: "BASKETBALL_POINTS",
      resultSummary: "walkover",
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
  });
});
