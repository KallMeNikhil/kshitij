import { z } from "zod";
import type { ScoringModel } from "../types";

const setScoreSchema = z.object({ a: z.number().int().min(0), b: z.number().int().min(0), completed: z.boolean() }).strict();

const setsPointsStateSchema = z
  .object({
    sets: z.array(setScoreSchema).min(1),
    currentSet: z.number().int().min(0),
  })
  .strict();

const basketballStateSchema = z
  .object({
    scoreA: z.number().int().min(0),
    scoreB: z.number().int().min(0),
    period: z.number().int().positive(),
    overtime: z.boolean(),
    periodEnds: z
      .array(z.object({ a: z.number().int().min(0), b: z.number().int().min(0) }).strict())
      .max(30)
      .optional(),
  })
  .strict();

const tennisPointSchema = z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(40), z.literal("AD")]);
const tennisSetSchema = z
  .object({ gamesA: z.number().int().min(0), gamesB: z.number().int().min(0), completed: z.boolean() })
  .strict();
const tennisStateSchema = z
  .object({
    sets: z.array(tennisSetSchema).min(1),
    currentGame: z.object({ pointsA: tennisPointSchema, pointsB: tennisPointSchema }).strict(),
    bestOfSets: z.number().int().positive(),
    tiebreak: z.object({ a: z.number().int().min(0), b: z.number().int().min(0) }).strict().optional(),
  })
  .strict();

const inningsStateSchema = z
  .object({
    runs: z.number().int().min(0),
    wickets: z.number().int().min(0).max(14),
    oversCompleted: z.number().int().min(0),
    ballsInOver: z.number().int().min(0).max(5),
    allOut: z.boolean(),
  })
  .strict();
const cricketStateSchema = z
  .object({
    oversPerInnings: z.number().int().positive(),
    battingFirst: z.enum(["A", "B"]),
    innings1: inningsStateSchema,
    innings2: inningsStateSchema,
    currentInnings: z.union([z.literal(1), z.literal(2)]),
  })
  .strict();

const footballEventSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["GOAL", "YELLOW_CARD", "RED_CARD"]),
    side: z.enum(["A", "B"]),
    playerId: z.string().min(1),
    minute: z.number().int().min(0).max(200),
  })
  .strict();
const footballStateSchema = z
  .object({
    events: z.array(footballEventSchema),
    penalties: z.object({ a: z.number().int().min(0), b: z.number().int().min(0) }).strict().optional(),
  })
  .strict();

const resultOnlyStateSchema = z
  .object({ outcome: z.enum(["A", "B", "DRAW"]).nullable() })
  .strict();

export const liveStateSchemaByModel: Record<ScoringModel, z.ZodTypeAny> = {
  SETS_POINTS: setsPointsStateSchema,
  BASKETBALL_POINTS: basketballStateSchema,
  TENNIS_SETS_GAMES: tennisStateSchema,
  CRICKET_INNINGS: cricketStateSchema,
  FOOTBALL_EVENTS: footballStateSchema,
  RESULT_ONLY: resultOnlyStateSchema,
};

export function validateLiveState(scoringModel: ScoringModel, data: unknown): { ok: true } | { ok: false; message: string } {
  const schema = liveStateSchemaByModel[scoringModel];
  const result = schema.safeParse(data);
  if (result.success) return { ok: true };
  return { ok: false, message: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
}
