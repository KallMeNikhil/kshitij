import { vi } from "vitest";
import type { AuthContext } from "../src/auth/authorize";
import type { FixtureDoc } from "../../shared/types";

export function fakeDb(overrides: Partial<Record<string, unknown>> = {}) {
  const commit = vi.fn().mockResolvedValue(undefined);
  const db: Record<string, unknown> = {
    beginTransaction: vi.fn().mockResolvedValue("txn-1"),
    rollback: vi.fn().mockResolvedValue(undefined),
    commit,
    commitChunked: vi.fn().mockImplementation(async (transaction: string, writes: unknown[], options?: { trailer?: (i: number, n: number) => unknown }) => {
      const all = options?.trailer ? [...writes, options.trailer(0, 1)] : writes;
      await commit(transaction, all);
      return 1;
    }),
    getDocument: vi.fn().mockResolvedValue(null),
    runQuery: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  return db as Record<string, ReturnType<typeof vi.fn>>;
}

export function ctxFor(
  db: unknown,
  role: "SUPER_ADMIN" | "SPORT_COORDINATOR" = "SUPER_ADMIN",
  sportIds: string[] = []
): AuthContext {
  return {
    email: role === "SUPER_ADMIN" ? "root@example.com" : "coord@example.com",
    admin: {
      email: role === "SUPER_ADMIN" ? "root@example.com" : "coord@example.com",
      role,
      sportIds,
      active: true,
      createdAt: "",
      createdBy: "",
      updatedAt: "",
      updatedBy: "",
    },
    db: db as AuthContext["db"],
  };
}

export function fixture(overrides: Partial<FixtureDoc> = {}): FixtureDoc {
  return {
    fixtureId: "basketball-mens-r1-m01",
    competitionId: "basketball-mens",
    sportId: "basketball",
    round: 1,
    matchNumber: 1,
    slotA: { kind: "TEAM", teamId: "t1" },
    slotB: { kind: "TEAM", teamId: "t2" },
    status: "SCHEDULED",
    nextFixtureId: null,
    nextSlot: null,
    ...overrides,
  };
}

export function entrantStub(collection: "teams" | "participants", id: string, over: Record<string, unknown> = {}) {
  return collection === "teams"
    ? { teamId: id, teamName: id, sportId: "basketball", competitionId: "basketball-mens", college: id, captainParticipantId: "p1", memberIds: [], ...over }
    : { participantId: id, name: id, phone: "", college: id, sportId: "basketball", competitionId: "basketball-mens", ...over };
}

export function dbWith(opts: {
  docs?: Record<string, unknown>;
  fixtures?: FixtureDoc[];
  queries?: (collection: string, filters: Array<{ field: string; value: unknown }>) => unknown[] | undefined;
}) {
  return fakeDb({
    getDocument: vi.fn().mockImplementation(async (collection: string, id: string) => {
      if (collection === "fixtures") {
        const f = (opts.fixtures ?? []).find((x) => x.fixtureId === id);
        return f ? structuredClone(f) : null;
      }
      const listed = opts.docs?.[`${collection}/${id}`];
      if (listed !== undefined) return listed;
      if (collection === "teams" || collection === "participants") return entrantStub(collection, id);
      return null;
    }),
    runQuery: vi.fn().mockImplementation(async (collection: string, filters: Array<{ field: string; value: unknown }>) => {
      const custom = opts.queries?.(collection, filters);
      if (custom) return custom;
      if (collection === "fixtures") {
        return (opts.fixtures ?? []).map((f) => ({ id: f.fixtureId, data: structuredClone(f) }));
      }
      return [];
    }),
  });
}
