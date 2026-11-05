import { describe, it, expect } from "vitest";
import { validateImport, emptyStore } from "./import-validator";
import { defaultMatchConfigurations } from "./matchConfig";

const basePayload = {
  schemaVersion: "kshitij.canonical/1",
  sports: [{ sportId: "chess", name: "Chess", scoringModel: "RESULT_ONLY" }],
  competitions: [
    {
      competitionId: "chess-open",
      sportId: "chess",
      name: "Chess Open",
      categoryKey: "open",
      participantType: "INDIVIDUAL",
      gender: null,
    },
  ],
  participants: [
    { participantId: "chess-open-arjun-1234", name: "Arjun Sharma", phone: "9876543210", college: "NIT X", sportId: "chess", competitionId: "chess-open" },
    { participantId: "chess-open-riya-5678", name: "Riya Patel", phone: "+91-9123456780", college: "NIT Y", sportId: "chess", competitionId: "chess-open" },
  ],
};

describe("validateImport", () => {
  it("accepts a valid payload with zero issues", () => {
    const result = validateImport(basePayload, emptyStore());
    expect(result.ok).toBe(true);
    expect(result.counts.newParticipants).toBe(2);
  });

  it("rejects unknown fields (e.g. course)", () => {
    const bad = { ...basePayload, participants: [{ ...basePayload.participants[0], course: "CSE" }] };
    const result = validateImport(bad, emptyStore());
    expect(result.ok).toBe(false);
  });

  it("flags duplicate participants by normalized phone within a competition", () => {
    const dup = {
      ...basePayload,
      participants: [
        ...basePayload.participants,
        { participantId: "chess-open-dupe-3210", name: "Dupe Person", phone: "09876543210", college: "NIT X", sportId: "chess", competitionId: "chess-open" },
      ],
    };
    const result = validateImport(dup, emptyStore());
    expect(result.issues.some((i) => i.code === "DUPLICATE_PARTICIPANT")).toBe(true);
  });

  it("rejects invalid phone numbers", () => {
    const bad = { ...basePayload, participants: [{ ...basePayload.participants[0], phone: "12345" }] };
    const result = validateImport(bad, emptyStore());
    expect(result.issues.some((i) => i.code === "INVALID_PHONE")).toBe(true);
  });

  it("rejects a fixtureId that doesn't match the naming convention", () => {
    const bad = {
      ...basePayload,
      fixtures: [
        {
          fixtureId: "chess-open-round1-match1",
          competitionId: "chess-open",
          round: 1,
          matchNumber: 1,
          slotA: { kind: "PARTICIPANT", participantId: basePayload.participants[0].participantId },
          slotB: { kind: "PARTICIPANT", participantId: basePayload.participants[1].participantId },
        },
      ],
    };
    const result = validateImport(bad, emptyStore());
    expect(result.ok).toBe(false);
  });
});

const basketballMatchConfiguration = {
  configVersion: 1,
  scoringModel: "BASKETBALL_POINTS",
  participantModel: { participantType: "TEAM", teamSize: { min: 5, max: 8 }, substitutesAllowed: 3 },
  structure: { kind: "PERIODS", periodLabel: "QUARTER", periodCount: 4, minutesPerPeriod: 10, drawAllowed: false },
  walkoverBehavior: "OPPONENT_WINS",
  byeBehavior: "AUTO_ADVANCE",
  pending: [],
};

function basketballPayload(memberIds: string[]) {
  return {
    schemaVersion: "kshitij.canonical/1",
    sports: [{ sportId: "basketball", name: "Basketball", scoringModel: "BASKETBALL_POINTS" }],
    competitions: [
      {
        competitionId: "basketball-mens",
        sportId: "basketball",
        name: "Men's Basketball",
        categoryKey: "open",
        participantType: "TEAM",
        gender: null,
        teamSize: { min: 5, max: 8 },
        matchConfiguration: basketballMatchConfiguration,
      },
    ],
    participants: memberIds.map((id, i) => ({
      participantId: `basketball-mens-p${i + 1}-${id}`,
      name: `Player ${i + 1}`,
      phone: `98765432${String(i).padStart(2, "0")}`,
      college: "JIIT",
      sportId: "basketball",
      competitionId: "basketball-mens",
    })),
    teams: [
      {
        teamId: "basketball-mens-team-a",
        sportId: "basketball",
        competitionId: "basketball-mens",
        college: "JIIT",
        captainParticipantId: `basketball-mens-p1-${memberIds[0]}`,
        memberIds: memberIds.map((id, i) => `basketball-mens-p${i + 1}-${id}`),
      },
    ],
  };
}

describe("validateImport: team roster size against matchConfiguration", () => {
  it("accepts a roster within the configured starters + substitutes range", () => {
    const payload = basketballPayload(Array.from({ length: 8 }, (_, i) => `x${i}`));
    const result = validateImport(payload, emptyStore());
    expect(result.issues.filter((i) => i.code.startsWith("TEAM_ROSTER"))).toHaveLength(0);
  });

  it("flags a roster below the configured minimum", () => {
    const payload = basketballPayload(["x0", "x1"]);
    const result = validateImport(payload, emptyStore());
    expect(result.issues.some((i) => i.code === "TEAM_ROSTER_BELOW_MINIMUM")).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("flags a roster exceeding max starters plus configured substitutes", () => {
    const payload = basketballPayload(Array.from({ length: 12 }, (_, i) => `x${i}`));
    const result = validateImport(payload, emptyStore());
    expect(result.issues.some((i) => i.code === "TEAM_ROSTER_EXCEEDS_MAXIMUM")).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("falls back to the competition's legacy teamSize when no matchConfiguration is present", () => {
    const payload = basketballPayload(["x0", "x1"]);
    delete (payload.competitions[0] as { matchConfiguration?: unknown }).matchConfiguration;
    const result = validateImport(payload, emptyStore());

    expect(result.issues.some((i) => i.code === "TEAM_ROSTER_BELOW_MINIMUM")).toBe(true);
  });
});

describe("validateImport: fields owned by dedicated operations", () => {
  const codes = (payload: unknown, store = emptyStore()) => validateImport(payload, store).issues.map((i) => i.code);
  const cfg = defaultMatchConfigurations.basketball!;

  const storeWith = (over: {
    sportConfig?: unknown;
    competition?: Record<string, unknown>;
    participant?: Record<string, unknown>;
  }) => {
    const store = emptyStore();
    store.sports.set("chess", { sportId: "chess", name: "Chess", scoringModel: "RESULT_ONLY", displayOrder: 0, active: true, ...(over.sportConfig ? { matchConfiguration: over.sportConfig } : {}) } as never);
    store.competitions.set("chess-open", { competitionId: "chess-open", sportId: "chess", name: "Chess Open", categoryKey: "open", gender: null, participantType: "INDIVIDUAL", format: "KNOCKOUT", published: false, displayOrder: 0, ...over.competition } as never);
    store.participants.set("chess-open-arjun-1234", { ...basePayload.participants[0], ...over.participant } as never);
    return store;
  };

  it("rejects re-importing an existing competition with a different matchConfiguration", () => {
    const payload = { ...basePayload, competitions: [{ ...basePayload.competitions[0], matchConfiguration: { ...cfg, participantModel: { ...cfg.participantModel, participantType: "INDIVIDUAL" } } }] };
    const store = storeWith({ competition: { matchConfiguration: undefined } });
    expect(codes(payload, store)).toContain("IMPORT_USE_DEDICATED_CONFIG_OPERATION");
  });

  it("does not flag an unchanged matchConfiguration (configVersion bookkeeping ignored)", () => {
    const stored = { ...cfg, participantModel: { ...cfg.participantModel, participantType: "INDIVIDUAL" }, configVersion: 3 };
    const { configVersion: _ignored, ...same } = stored;
    const payload = { ...basePayload, competitions: [{ ...basePayload.competitions[0], matchConfiguration: same }] };
    expect(codes(payload, storeWith({ competition: { matchConfiguration: stored } }))).not.toContain("IMPORT_USE_DEDICATED_CONFIG_OPERATION");
  });

  it("allows an initial matchConfiguration for a brand-new competition", () => {
    const payload = { ...basePayload, competitions: [{ ...basePayload.competitions[0], matchConfiguration: { ...cfg, participantModel: { ...cfg.participantModel, participantType: "INDIVIDUAL" } } }] };
    expect(codes(payload)).not.toContain("IMPORT_USE_DEDICATED_CONFIG_OPERATION");
  });

  it("rejects changing a sport's matchConfiguration via import", () => {
    const payload = { ...basePayload, sports: [{ ...basePayload.sports[0], matchConfiguration: cfg }] };
    expect(codes(payload, storeWith({}))).toContain("IMPORT_USE_DEDICATED_CONFIG_OPERATION");
  });

  it("rejects publishing a competition via import, but tolerates omitting the flag on a published one", () => {
    const publish = { ...basePayload, competitions: [{ ...basePayload.competitions[0], published: true }] };
    expect(codes(publish)).toContain("IMPORT_USE_DEDICATED_PUBLISH_OPERATION");
    const store = storeWith({ competition: { published: true } });
    expect(codes(basePayload, store)).not.toContain("IMPORT_USE_DEDICATED_PUBLISH_OPERATION");
  });

  it("rejects un-withdrawing or pre-withdrawing an entrant via import", () => {
    const unwithdraw = { ...basePayload, participants: [{ ...basePayload.participants[0], status: "ACTIVE" }, basePayload.participants[1]] };
    expect(codes(unwithdraw, storeWith({ participant: { status: "WITHDRAWN" } }))).toContain("IMPORT_USE_WITHDRAWAL_OPERATION");
    const prewithdrawn = { ...basePayload, participants: [{ ...basePayload.participants[0], status: "WITHDRAWN" }, basePayload.participants[1]] };
    expect(codes(prewithdrawn)).toContain("IMPORT_USE_WITHDRAWAL_OPERATION");
  });

  it("leaves a withdrawn entrant alone when the import does not mention status", () => {
    expect(codes(basePayload, storeWith({ participant: { status: "WITHDRAWN" } }))).not.toContain("IMPORT_USE_WITHDRAWAL_OPERATION");
  });
});

describe("validateImport: fixture content mirrors the dedicated-operation invariants", () => {
  const A = "chess-open-arjun-1234";
  const B = "chess-open-riya-5678";
  const fx = (over: Record<string, unknown> = {}) => ({
    fixtureId: "chess-open-r1-m01", competitionId: "chess-open", round: 1, matchNumber: 1,
    slotA: { kind: "PARTICIPANT", participantId: A }, slotB: { kind: "PARTICIPANT", participantId: B }, ...over,
  });
  const withFixtures = (fixtures: unknown[]) => ({ ...basePayload, fixtures });
  const codes = (payload: unknown, store = emptyStore()) => validateImport(payload, store).issues.map((i) => i.code);

  it("accepts well-formed fixtures between real, active, in-scope entrants", () => {
    expect(validateImport(withFixtures([fx()]), emptyStore()).ok).toBe(true);
  });

  it("rejects a slot that references a non-existent entrant", () => {
    expect(codes(withFixtures([fx({ slotB: { kind: "PARTICIPANT", participantId: "chess-open-ghost-0000" } })]))).toContain("FIXTURE_ENTRANT_NOT_FOUND");
  });

  it("rejects an entrant that belongs to another competition", () => {
    const store = emptyStore();
    store.competitions.set("chess-junior", { competitionId: "chess-junior", sportId: "chess", name: "Junior", categoryKey: "junior", gender: null, participantType: "INDIVIDUAL", format: "KNOCKOUT", published: false, displayOrder: 0 } as never);
    store.participants.set("chess-junior-kid-1111", { participantId: "chess-junior-kid-1111", name: "Kid", phone: "9000000001", college: "Z", sportId: "chess", competitionId: "chess-junior" } as never);
    expect(codes(withFixtures([fx({ slotB: { kind: "PARTICIPANT", participantId: "chess-junior-kid-1111" } })]), store)).toContain("FIXTURE_ENTRANT_OUT_OF_SCOPE");
  });

  it("rejects the wrong slot kind for the competition's participant type", () => {
    expect(codes(withFixtures([fx({ slotA: { kind: "TEAM", teamId: "chess-open-team-a" } })]))).toContain("FIXTURE_SLOT_KIND_MISMATCH");
  });

  it("never seats a withdrawn entrant (stored status, or withdrawn in the same payload)", () => {
    const store = emptyStore();
    store.participants.set(A, { ...basePayload.participants[0], status: "WITHDRAWN" } as never);
    expect(codes(withFixtures([fx()]), store)).toContain("FIXTURE_ENTRANT_WITHDRAWN");
  });

  it("rejects a winner slot that does not follow its conventional feeder, and one in round 1", () => {
    const r2 = (fromFixtureId: string) => ({
      fixtureId: "chess-open-r2-m01", competitionId: "chess-open", round: 2, matchNumber: 1,
      slotA: { kind: "FIXTURE_WINNER", fromFixtureId }, slotB: { kind: "FIXTURE_WINNER", fromFixtureId: "chess-open-r1-m02" },
    });
    expect(codes(withFixtures([r2("chess-open-r1-m01")]))).not.toContain("FIXTURE_WINNER_SLOT_INVALID");
    expect(codes(withFixtures([r2("chess-open-r1-m03")]))).toContain("FIXTURE_WINNER_SLOT_INVALID");
    expect(codes(withFixtures([fx({ slotA: { kind: "FIXTURE_WINNER", fromFixtureId: "chess-open-r1-m01" } })]))).toContain("FIXTURE_WINNER_SLOT_INVALID");
  });

  it("rejects the same entrant seated twice in one round", () => {
    const second = fx({ fixtureId: "chess-open-r1-m02", matchNumber: 2, slotB: { kind: "PARTICIPANT", participantId: A } });
    expect(codes(withFixtures([fx(), second]))).toContain("IMPORT_BREAKS_BRACKET_STRUCTURE");
  });

  it("does not let import publish fixtures (status belongs to publishBracket)", () => {
    expect(codes(withFixtures([fx({ status: "SCHEDULED" })]))).toContain("IMPORT_USE_DEDICATED_PUBLISH_OPERATION");
    expect(codes(withFixtures([fx({ status: "DRAFT" })]))).not.toContain("IMPORT_USE_DEDICATED_PUBLISH_OPERATION");
  });

  it("does not let import rewire a generated bracket: an existing fixture's slot cannot be pointed at the wrong feeder", () => {
    const store = emptyStore();
    store.competitions.set("chess-open", { ...basePayload.competitions[0], format: "KNOCKOUT", published: false, displayOrder: 0 } as never);
    const generated = [
      { fixtureId: "chess-open-r1-m01", competitionId: "chess-open", sportId: "chess", round: 1, matchNumber: 1, slotA: { kind: "PARTICIPANT", participantId: A }, slotB: { kind: "PARTICIPANT", participantId: B }, status: "DRAFT", nextFixtureId: "chess-open-r2-m01", nextSlot: "A" },
      { fixtureId: "chess-open-r1-m02", competitionId: "chess-open", sportId: "chess", round: 1, matchNumber: 2, slotA: { kind: "BYE" }, slotB: { kind: "BYE" }, status: "DRAFT", nextFixtureId: "chess-open-r2-m01", nextSlot: "B" },
      { fixtureId: "chess-open-r2-m01", competitionId: "chess-open", sportId: "chess", round: 2, matchNumber: 1, slotA: { kind: "FIXTURE_WINNER", fromFixtureId: "chess-open-r1-m01" }, slotB: { kind: "FIXTURE_WINNER", fromFixtureId: "chess-open-r1-m02" }, status: "DRAFT", nextFixtureId: null, nextSlot: null },
    ];
    for (const f of generated) store.fixtures.set(f.fixtureId, f as never);
    store.participants.set(A, basePayload.participants[0] as never);
    store.participants.set(B, basePayload.participants[1] as never);
    const tamper = { ...generated[2], slotA: { kind: "FIXTURE_WINNER", fromFixtureId: "chess-open-r1-m02" } };
    const { sportId: _s, nextFixtureId: _n, nextSlot: _ns, ...importable } = tamper;
    expect(codes(withFixtures([importable]), store)).toEqual(expect.arrayContaining(["FIXTURE_WINNER_SLOT_INVALID"]));
  });
});
