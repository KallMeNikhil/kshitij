import { z } from "zod";
import { isValidId, normalizePhone } from "./ids";
import { matchConfigurationSchema } from "./matchConfig";
import { tournamentConfigurationSchema } from "./tournamentConfig";
import { COMMITTEE_CATEGORIES, COMMITTEE_MAX_MEMBERS, GALLERY_MAX_ITEMS, isMediaUrl } from "./media";

export { matchConfigurationSchema, tournamentConfigurationSchema };

const idSchema = z.string().refine(isValidId, { message: "INVALID_ID_FORMAT" });

export const scoringModelEnum = z.enum([
  "FOOTBALL_EVENTS",
  "CRICKET_INNINGS",
  "BASKETBALL_POINTS",
  "SETS_POINTS",
  "TENNIS_SETS_GAMES",
  "RESULT_ONLY",
]);

export const participantTypeEnum = z.enum(["INDIVIDUAL", "PAIR", "TEAM"]);
export const formatEnum = z.enum(["KNOCKOUT"]);
export const genderEnum = z.enum(["MEN", "WOMEN", "MIXED", "OPEN"]).nullable();
export const slotKindEnum = z.enum(["PARTICIPANT", "TEAM", "FIXTURE_WINNER", "BYE", "TBD"]);
export const importableFixtureStatusEnum = z.enum(["DRAFT", "SCHEDULED"]);

export const scoringConfigSchema = z
  .object({
    bestOf: z.number().int().positive().optional(),
    pointsToWin: z.number().int().positive().optional(),
    capPoints: z.number().int().positive().optional(),
    quarters: z.number().int().positive().optional(),
    quarterMinutes: z.number().int().positive().optional(),
    oversPerInnings: z.number().int().positive().optional(),
  })
  .strict();

export const eventSchema = z
  .object({
    name: z.string().min(1),
    edition: z.string().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    timezone: z.string().default("Asia/Kolkata"),
    colleges: z.array(z.string()).optional(),
    venues: z.array(z.string()).optional(),
  })
  .strict()
  .refine(
    (v) => !(v.startDate && v.endDate) || v.endDate >= v.startDate,
    { message: "END_DATE_BEFORE_START_DATE" }
  );

export const sportSchema = z
  .object({
    sportId: idSchema,
    name: z.string().min(1).max(40),
    slug: z.string().optional(),
    scoringModel: scoringModelEnum,
    displayOrder: z.number().int().default(0),
    active: z.boolean().default(true),
    defaultScoring: scoringConfigSchema.optional(),
    matchConfiguration: matchConfigurationSchema.optional(),
  })
  .strict();

export const competitionSchema = z
  .object({
    competitionId: idSchema,
    sportId: idSchema,
    name: z.string().min(1),
    categoryKey: z.string().min(1),
    gender: genderEnum.optional(),
    participantType: participantTypeEnum,
    format: formatEnum.default("KNOCKOUT"),
    teamSize: z
      .object({ min: z.number().int().positive(), max: z.number().int().positive() })
      .refine((v) => v.min <= v.max, { message: "TEAM_SIZE_MIN_GT_MAX" })
      .optional(),
    scoring: scoringConfigSchema.optional(),
    matchConfiguration: matchConfigurationSchema.optional(),
    tournamentConfiguration: tournamentConfigurationSchema.optional(),
    published: z.boolean().default(false),
    displayOrder: z.number().int().default(0),
  })
  .strict()
  .refine((v) => v.competitionId.startsWith(`${v.sportId}-`), {
    message: "COMPETITION_ID_MUST_START_WITH_SPORT_ID",
  })
  .refine((v) => (v.participantType === "TEAM" ? !!v.teamSize : true), {
    message: "TEAM_SIZE_REQUIRED_FOR_TEAM_COMPETITION",
  })
  .refine((v) => (v.participantType !== "TEAM" ? !v.teamSize : true), {
    message: "TEAM_SIZE_FORBIDDEN_FOR_NON_TEAM_COMPETITION",
  })
  .refine(
    (v) => (v.matchConfiguration ? v.matchConfiguration.participantModel.participantType === v.participantType : true),
    { message: "MATCH_CONFIGURATION_PARTICIPANT_TYPE_MISMATCH" }
  );

export const entrantStatusSchema = z.enum(["ACTIVE", "WITHDRAWN"]);
export const importBatchIdSchema = z.string().min(1).max(80);

export const participantSchema = z
  .object({
    participantId: idSchema,
    name: z.string().trim().min(2).max(80),
    phone: z.string(),
    college: z.string().min(2).max(80),
    sportId: idSchema,
    competitionId: idSchema,
    status: entrantStatusSchema.default("ACTIVE"),
    importBatchId: importBatchIdSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    try {
      normalizePhone(v.phone);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["phone"], message: "INVALID_PHONE" });
    }
  });

export const teamSchema = z
  .object({
    teamId: idSchema,
    teamName: z.string().min(2).max(60).optional(),
    sportId: idSchema,
    competitionId: idSchema,
    college: z.string().min(2).max(80),
    captainParticipantId: idSchema,
    captainPhone: z.string().optional(),
    memberIds: z.array(idSchema).min(1),
    status: entrantStatusSchema.default("ACTIVE"),
    importBatchId: importBatchIdSchema.optional(),
  })
  .strict()
  .refine((v) => v.memberIds.includes(v.captainParticipantId), {
    message: "CAPTAIN_NOT_IN_MEMBER_IDS",
  })
  .refine((v) => new Set(v.memberIds).size === v.memberIds.length, {
    message: "DUPLICATE_MEMBER_ID",
  })
  .superRefine((v, ctx) => {
    if (v.captainPhone) {
      try {
        normalizePhone(v.captainPhone);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["captainPhone"], message: "INVALID_PHONE" });
      }
    }
  });

export const slotSchema = z
  .object({
    kind: slotKindEnum,
    participantId: idSchema.optional(),
    teamId: idSchema.optional(),
    fromFixtureId: idSchema.optional(),
  })
  .strict()
  .refine((v) => (v.kind === "PARTICIPANT" ? !!v.participantId : true), {
    message: "PARTICIPANT_ID_REQUIRED_FOR_PARTICIPANT_SLOT",
  })
  .refine((v) => (v.kind === "TEAM" ? !!v.teamId : true), {
    message: "TEAM_ID_REQUIRED_FOR_TEAM_SLOT",
  })
  .refine((v) => (v.kind === "FIXTURE_WINNER" ? !!v.fromFixtureId : true), {
    message: "FROM_FIXTURE_ID_REQUIRED_FOR_FIXTURE_WINNER_SLOT",
  });

export const fixtureSchema = z
  .object({
    fixtureId: idSchema,
    competitionId: idSchema,
    round: z.number().int().positive(),
    matchNumber: z.number().int().positive(),
    slotA: slotSchema,
    slotB: slotSchema,
    scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    scheduledTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    venue: z.string().max(80).optional(),
    status: importableFixtureStatusEnum.default("DRAFT"),
  })
  .strict()
  .refine((v) => v.fixtureId === `${v.competitionId}-r${v.round}-m${String(v.matchNumber).padStart(2, "0")}`, {
    message: "FIXTURE_ID_DOES_NOT_MATCH_CONVENTION",
  })
  .refine((v) => (v.scheduledDate ? !!v.scheduledTime : true) && (v.scheduledTime ? !!v.scheduledDate : true), {
    message: "SCHEDULED_DATE_AND_TIME_MUST_BE_TOGETHER",
  });

export const canonicalImportSchema = z
  .object({
    schemaVersion: z.literal("kshitij.canonical/1"),
    event: eventSchema.optional(),
    sports: z.array(sportSchema).optional(),
    competitions: z.array(competitionSchema).optional(),
    participants: z.array(participantSchema).optional(),
    teams: z.array(teamSchema).optional(),
    fixtures: z.array(fixtureSchema).optional(),
  })
  .strict();

export type CanonicalImport = z.infer<typeof canonicalImportSchema>;

export const SITE_TEXT_LIMITS = {
  name: 80,
  role: 80,
  eventLabel: 60,
  tagline: 120,
  footerNote: 120,
  heroTitle: 60,
  email: 120,
  phone: 24,
} as const;

const PHONE_PATTERN = /^\+?[0-9][0-9\s\-()]{3,23}$/;

export const mediaUrlSchema = z
  .string()
  .max(600)
  .refine(isMediaUrl, { message: "INVALID_MEDIA_URL" });

export const focalPointSchema = z
  .object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
  })
  .strict();

const timestampSchema = z.string().min(1).max(40);

export const galleryItemSchema = z
  .object({
    id: idSchema,
    imageUrl: mediaUrlSchema,
    thumbUrl: mediaUrlSchema,
    width: z.number().int().min(1).max(8000),
    height: z.number().int().min(1).max(8000),
    focus: focalPointSchema,
    visible: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  });

export const committeeMemberSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(SITE_TEXT_LIMITS.name),
    role: z.string().trim().min(1).max(SITE_TEXT_LIMITS.role),
    category: z.enum(COMMITTEE_CATEGORIES).default("coordinator"),
    photoUrl: mediaUrlSchema.optional(),
    focus: focalPointSchema,
    featured: z.boolean(),
    visible: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  });

export const siteContactSchema = z
  .object({
    email: z.string().trim().email().max(SITE_TEXT_LIMITS.email).optional(),
    phone: z.string().trim().regex(PHONE_PATTERN, "INVALID_PHONE").optional(),
  });

export const siteDetailsSchema = z
  .object({
    eventLabel: z.string().trim().min(1).max(SITE_TEXT_LIMITS.eventLabel).optional(),
    tagline: z.string().trim().min(1).max(SITE_TEXT_LIMITS.tagline).optional(),
    footerNote: z.string().trim().min(1).max(SITE_TEXT_LIMITS.footerNote).optional(),
    heroTitle: z.string().trim().min(1).max(SITE_TEXT_LIMITS.heroTitle).optional(),
    contact: siteContactSchema.optional(),
    updatedAt: timestampSchema.optional(),
    updatedBy: z.string().max(254).optional(),
  })
  .strict();

export const gallerySiteDocSchema = z
  .object({
    items: z.array(galleryItemSchema).max(GALLERY_MAX_ITEMS),
    updatedAt: timestampSchema.optional(),
    updatedBy: z.string().max(254).optional(),
  })
  .strict();

export const committeeSiteDocSchema = z
  .object({
    members: z.array(committeeMemberSchema).max(COMMITTEE_MAX_MEMBERS),
    updatedAt: timestampSchema.optional(),
    updatedBy: z.string().max(254).optional(),
  })
  .strict();
