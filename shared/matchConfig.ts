import { z } from "zod";
import type { ScoringModel } from "./types";

export const participantModelSchema = z
  .object({
    participantType: z.enum(["INDIVIDUAL", "PAIR", "TEAM"]),
    teamSize: z
      .object({ min: z.number().int().positive(), max: z.number().int().positive() })
      .refine((v) => v.min <= v.max, { message: "TEAM_SIZE_MIN_GT_MAX" })
      .optional(),
    substitutesAllowed: z.number().int().min(0).optional(),
    genderConstraint: z.enum(["MEN", "WOMEN", "MIXED", "OPEN"]).nullable().optional(),
  })
  .strict()
  .refine((v) => (v.participantType === "TEAM" ? !!v.teamSize : true), {
    message: "TEAM_SIZE_REQUIRED_FOR_TEAM_PARTICIPANT_MODEL",
  });

export type ParticipantModel = z.infer<typeof participantModelSchema>;

export const matchStructureSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("PERIODS"),
      periodLabel: z.enum(["QUARTER", "HALF", "PERIOD"]),
      periodCount: z.number().int().positive(),
      minutesPerPeriod: z.number().int().positive().optional(),
      extraTime: z
        .object({ periods: z.number().int().positive(), minutesPerPeriod: z.number().int().positive() })
        .optional(),
      drawAllowed: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("SETS_POINTS"),
      bestOf: z.number().int().positive(),
      pointsToWin: z.number().int().positive(),
      capPoints: z.number().int().positive().optional(),
      setPointsBySetIndex: z.array(z.number().int().positive()).optional(),
      decidingSetFormat: z
        .object({ pointsToWin: z.number().int().positive(), capPoints: z.number().int().positive().optional() })
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("GAMES_SETS"),
      bestOfSets: z.number().int().positive(),
      gamesPerSet: z.number().int().positive().default(6),
      tieBreakAtGames: z.number().int().positive().optional(),
      tieBreakPoints: z.number().int().positive().optional(),
      finalSetFormat: z.enum(["FULL_SET", "SUPER_TIE_BREAK"]).optional(),
      superTieBreakPoints: z.number().int().positive().optional(),
      noAd: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("INNINGS"),
      oversPerInnings: z.number().int().positive(),
      inningsPerSide: z.number().int().positive().default(1),
      wicketsPerInnings: z.number().int().min(1).max(14).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("EVENTS"),
      periodCount: z.number().int().positive().default(2),
      minutesPerPeriod: z.number().int().positive().optional(),
      extraTime: z
        .object({ periods: z.number().int().positive(), minutesPerPeriod: z.number().int().positive() })
        .optional(),
      penaltiesOnDraw: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal("RESULT_ONLY"),
      drawAllowed: z.boolean().default(true),
      tieBreak: z.string().optional(),
      pointDetail: z.enum(["NONE", "SCORE_BREAKDOWN"]).default("NONE"),
      bestOfBoards: z.number().int().positive().optional(),
    })
    .strict(),
]);

export type MatchStructure = z.infer<typeof matchStructureSchema>;

const isOdd = (n: number) => n % 2 === 1;

export function structureIssues(structure: MatchStructure): string[] {
  const issues: string[] = [];
  if (structure.kind === "SETS_POINTS") {
    if (!isOdd(structure.bestOf)) issues.push("BEST_OF_MUST_BE_ODD");
    if (structure.capPoints !== undefined && structure.capPoints <= structure.pointsToWin) issues.push("CAP_MUST_EXCEED_POINTS_TO_WIN");
    if ((structure.setPointsBySetIndex?.length ?? 0) > structure.bestOf) issues.push("TOO_MANY_SET_POINT_ENTRIES");
    const deciding = structure.decidingSetFormat;
    if (deciding?.capPoints !== undefined && deciding.capPoints <= deciding.pointsToWin) issues.push("DECIDING_CAP_MUST_EXCEED_POINTS_TO_WIN");
  }
  if (structure.kind === "GAMES_SETS") {
    if (!isOdd(structure.bestOfSets)) issues.push("BEST_OF_SETS_MUST_BE_ODD");
    if (structure.tieBreakAtGames !== undefined && structure.tieBreakAtGames > structure.gamesPerSet) issues.push("TIE_BREAK_AFTER_SET_END");
  }
  if (structure.kind === "RESULT_ONLY" && structure.bestOfBoards !== undefined && !isOdd(structure.bestOfBoards)) {
    issues.push("BEST_OF_BOARDS_MUST_BE_ODD");
  }
  return issues;
}

export const matchStructureKindByScoringModel: Record<ScoringModel, MatchStructure["kind"]> = {
  BASKETBALL_POINTS: "PERIODS",
  SETS_POINTS: "SETS_POINTS",
  TENNIS_SETS_GAMES: "GAMES_SETS",
  CRICKET_INNINGS: "INNINGS",
  FOOTBALL_EVENTS: "EVENTS",
  RESULT_ONLY: "RESULT_ONLY",
};

export const matchConfigurationSchema = z
  .object({
    configVersion: z.number().int().positive().default(1),
    scoringModel: z.enum([
      "FOOTBALL_EVENTS",
      "CRICKET_INNINGS",
      "BASKETBALL_POINTS",
      "SETS_POINTS",
      "TENNIS_SETS_GAMES",
      "RESULT_ONLY",
    ]),
    participantModel: participantModelSchema,
    structure: matchStructureSchema,
    walkoverBehavior: z.enum(["OPPONENT_WINS", "BOTH_ELIMINATED"]).default("OPPONENT_WINS"),
    byeBehavior: z.enum(["AUTO_ADVANCE"]).default("AUTO_ADVANCE"),

    pending: z.array(z.string()).default([]),
    notes: z.string().max(500).optional(),

    roundOverrides: z
      .array(z.object({ roundsFromEnd: z.number().int().min(0).max(7), structure: matchStructureSchema }).strict())
      .optional(),
  })
  .strict()
  .refine((v) => matchStructureKindByScoringModel[v.scoringModel] === v.structure.kind, {
    message: "STRUCTURE_KIND_DOES_NOT_MATCH_SCORING_MODEL",
  })
  .refine((v) => (v.roundOverrides ?? []).every((o) => o.structure.kind === v.structure.kind), {
    message: "ROUND_OVERRIDE_KIND_DOES_NOT_MATCH_STRUCTURE",
  })
  .refine((v) => new Set((v.roundOverrides ?? []).map((o) => o.roundsFromEnd)).size === (v.roundOverrides ?? []).length, {
    message: "DUPLICATE_ROUND_OVERRIDE",
  })
  .superRefine((v, ctx) => {
    for (const message of structureIssues(v.structure)) ctx.addIssue({ code: "custom", path: ["structure"], message });
    (v.roundOverrides ?? []).forEach((o, i) => {
      for (const message of structureIssues(o.structure)) ctx.addIssue({ code: "custom", path: ["roundOverrides", i, "structure"], message });
    });
    const wickets = v.structure.kind === "INNINGS" ? v.structure.wicketsPerInnings : undefined;
    const maxPlayers = v.participantModel.teamSize?.max;
    if (wickets !== undefined && maxPlayers !== undefined && wickets > maxPlayers - 1) {
      ctx.addIssue({ code: "custom", path: ["structure", "wicketsPerInnings"], message: "WICKETS_EXCEED_TEAM_SIZE" });
    }
  });

export type MatchConfiguration = z.infer<typeof matchConfigurationSchema>;

export function configurationForRound(config: MatchConfiguration, round: number, totalRounds: number): MatchConfiguration {
  const { roundOverrides, ...base } = config;
  const override = roundOverrides?.find((o) => o.roundsFromEnd === totalRounds - round);
  return override ? { ...base, structure: override.structure } : base;
}

export const defaultMatchConfigurations: Partial<Record<string, MatchConfiguration>> = {
  badminton: {
    configVersion: 1,
    scoringModel: "SETS_POINTS",
    participantModel: { participantType: "INDIVIDUAL" },
    structure: { kind: "SETS_POINTS", bestOf: 3, pointsToWin: 21, capPoints: 30 },
    walkoverBehavior: "OPPONENT_WINS",
    byeBehavior: "AUTO_ADVANCE",
    pending: [],
  },
  basketball: {
    configVersion: 1,
    scoringModel: "BASKETBALL_POINTS",
    participantModel: { participantType: "TEAM", teamSize: { min: 5, max: 8 }, substitutesAllowed: 3 },
    structure: { kind: "PERIODS", periodLabel: "QUARTER", periodCount: 4, minutesPerPeriod: 10, drawAllowed: false },
    walkoverBehavior: "OPPONENT_WINS",
    byeBehavior: "AUTO_ADVANCE",
    pending: [],
  },
  volleyball: {
    configVersion: 1,
    scoringModel: "SETS_POINTS",
    participantModel: { participantType: "TEAM", teamSize: { min: 6, max: 8 }, substitutesAllowed: 2 },
    structure: {
      kind: "SETS_POINTS",
      bestOf: 3,
      pointsToWin: 25,
      setPointsBySetIndex: [25, 25, 15],
      decidingSetFormat: { pointsToWin: 15 },
    },
    walkoverBehavior: "OPPONENT_WINS",
    byeBehavior: "AUTO_ADVANCE",
    pending: [],
  },
  "table-tennis": {
    configVersion: 1,
    scoringModel: "SETS_POINTS",
    participantModel: { participantType: "INDIVIDUAL" },
    structure: { kind: "SETS_POINTS", bestOf: 3, pointsToWin: 11 },
    roundOverrides: [
      { roundsFromEnd: 1, structure: { kind: "SETS_POINTS", bestOf: 5, pointsToWin: 11 } },
      { roundsFromEnd: 0, structure: { kind: "SETS_POINTS", bestOf: 5, pointsToWin: 11 } },
    ],
    walkoverBehavior: "OPPONENT_WINS",
    byeBehavior: "AUTO_ADVANCE",
    pending: [],
  },
  tennis: {
    configVersion: 1,
    scoringModel: "TENNIS_SETS_GAMES",
    participantModel: { participantType: "INDIVIDUAL" },
    structure: {
      kind: "GAMES_SETS",
      bestOfSets: 3,
      gamesPerSet: 6,
      tieBreakAtGames: 6,
      tieBreakPoints: 7,
      finalSetFormat: "SUPER_TIE_BREAK",
      superTieBreakPoints: 10,
    },
    walkoverBehavior: "OPPONENT_WINS",
    byeBehavior: "AUTO_ADVANCE",
    pending: [],
  },
  cricket: {
    configVersion: 1,
    scoringModel: "CRICKET_INNINGS",
    participantModel: { participantType: "TEAM", teamSize: { min: 11, max: 15 }, substitutesAllowed: 4 },
    structure: { kind: "INNINGS", oversPerInnings: 8, inningsPerSide: 1, wicketsPerInnings: 10 },
    roundOverrides: [
      { roundsFromEnd: 1, structure: { kind: "INNINGS", oversPerInnings: 10, inningsPerSide: 1, wicketsPerInnings: 10 } },
      { roundsFromEnd: 0, structure: { kind: "INNINGS", oversPerInnings: 10, inningsPerSide: 1, wicketsPerInnings: 10 } },
    ],
    walkoverBehavior: "OPPONENT_WINS",
    byeBehavior: "AUTO_ADVANCE",
    pending: [],
  },
  chess: {
    configVersion: 1,
    scoringModel: "RESULT_ONLY",
    participantModel: { participantType: "INDIVIDUAL" },
    structure: { kind: "RESULT_ONLY", drawAllowed: true, tieBreak: "Rapid tie-break game", pointDetail: "NONE" },
    walkoverBehavior: "OPPONENT_WINS",
    byeBehavior: "AUTO_ADVANCE",
    pending: [],
  },
  carrom: {
    configVersion: 1,
    scoringModel: "RESULT_ONLY",
    participantModel: { participantType: "PAIR" },
    structure: { kind: "RESULT_ONLY", drawAllowed: false, pointDetail: "SCORE_BREAKDOWN", bestOfBoards: 3 },
    walkoverBehavior: "OPPONENT_WINS",
    byeBehavior: "AUTO_ADVANCE",
    pending: [],
  },
  football: {
    configVersion: 1,
    scoringModel: "FOOTBALL_EVENTS",
    participantModel: { participantType: "TEAM", teamSize: { min: 11, max: 18 }, substitutesAllowed: 5 },
    structure: { kind: "EVENTS", periodCount: 2, minutesPerPeriod: 45, penaltiesOnDraw: true },
    walkoverBehavior: "OPPONENT_WINS",
    byeBehavior: "AUTO_ADVANCE",
    pending: [],
  },
};
