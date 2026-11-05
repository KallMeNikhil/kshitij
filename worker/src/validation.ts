import { z } from "zod";
import { AppError } from "./errors";
import { isValidId } from "../../shared/ids";
import { isRealDate, isRealTime, VENUE_MAX_LENGTH } from "../../shared/schedule";
import { REASON_MAX_LENGTH } from "../../shared/fixtureLifecycle";
import { COMMITTEE_CATEGORIES, COMMITTEE_MAX_MEMBERS, GALLERY_MAX_ITEMS, isMediaUrlFor } from "../../shared/media";
import { SITE_TEXT_LIMITS, focalPointSchema, mediaUrlSchema } from "../../shared/schemas";

export function parseInput<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new AppError(
      400,
      "INVALID_INPUT",
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
    );
  }
  return result.data;
}

export const docId = z.string().refine(isValidId, { message: "INVALID_ID_FORMAT" });
export const winnerSlotSchema = z.enum(["A", "B"]);

const dateSchema = z.string().refine(isRealDate, "expected a real calendar date, YYYY-MM-DD");
const timeSchema = z.string().refine(isRealTime, "expected a real time of day, HH:MM");

export const fixtureIdInput = z.object({ fixtureId: docId });

export const lifecycleInput = z.object({
  fixtureId: docId,
  reason: z.string().trim().min(1).max(REASON_MAX_LENGTH),
});

export const resumeInput = z.object({
  fixtureId: docId,
  scheduledDate: dateSchema.optional(),
  scheduledTime: timeSchema.optional(),
  venue: z.string().trim().max(VENUE_MAX_LENGTH).optional(),
});

export const saveFixtureInput = z.object({
  fixtureId: docId,
  scheduledDate: dateSchema.optional(),
  scheduledTime: timeSchema.optional(),
  venue: z.string().trim().max(VENUE_MAX_LENGTH).optional(),
});

export const updateLiveStateInput = z.object({
  fixtureId: docId,
  expectedVersion: z.number().int().min(0),
  data: z.record(z.string(), z.unknown()),
});

export const undoLiveStateInput = z.object({
  fixtureId: docId,
  expectedVersion: z.number().int().min(0),
});

export const completeMatchInput = z.object({
  fixtureId: docId,
  winnerSlot: winnerSlotSchema,
  decidedBy: z.string().min(1).max(40),
  resultSummary: z.string().max(300).default(""),
  reason: z.string().trim().max(300).default(""),
  penalties: z
    .object({ a: z.number().int().min(0), b: z.number().int().min(0) })
    .optional(),
});

export const reopenMatchInput = z.object({
  fixtureId: docId,
  reason: z.string().trim().min(1).max(500),
});

export const reinstateInput = z.object({
  fixtureId: docId,
  reason: z.string().trim().min(1).max(REASON_MAX_LENGTH),
  scheduledDate: dateSchema.optional(),
  scheduledTime: timeSchema.optional(),
  venue: z.string().trim().max(VENUE_MAX_LENGTH).optional(),
});

export const correctResultInput = z.object({
  fixtureId: docId,
  winnerSlot: winnerSlotSchema,
  reason: z.string().max(500),
});

export const withdrawEntrantInput = z.object({
  collection: z.string(),
  id: docId,
  reason: z.string().max(500),
});

const entrantCollection = z.enum(["participants", "teams"]);

export const purgeInput = z.object({
  competitionId: docId,
  importBatchId: z.string().min(1).max(80).optional(),
  confirm: z.string().max(120).optional(),
});

export const deleteEntitiesInput = z.object({
  collection: entrantCollection,
  competitionId: docId,
  ids: z.array(docId).min(1).max(500),
});

export const withdrawEntrantsInput = z.object({
  collection: entrantCollection,
  competitionId: docId,
  ids: z.array(docId).min(1).max(500),
  reason: z.string().trim().min(1).max(500),
});

export const generateBracketInput = z.object({
  competitionId: docId,
  entrantIds: z.array(docId).max(256).optional(),
});

export const publishBracketInput = z.object({ competitionId: docId });

export const manageAdminInput = z.object({
  email: z.string().email().max(254),
  displayName: z.string().max(80).optional(),
  role: z.enum(["SUPER_ADMIN", "SPORT_COORDINATOR"]),
  sportIds: z.array(docId).max(20).optional(),
  active: z.boolean(),
});

export const upsertEntityInput = z.object({
  collection: z.string(),
  id: docId,
  data: z.record(z.string(), z.unknown()),
});

export const deleteEntityInput = z.object({ collection: z.string(), id: docId });

export const createAnnouncementInput = z.object({
  title: z.string().max(120),
  body: z.string().max(2000),
  sportId: docId.optional(),
});

export const deleteAnnouncementInput = z.object({ id: docId });

export const updateSportConfigInput = z.object({
  sportId: z.string().optional(),
  matchConfiguration: z.unknown(),
});

export const updateCompetitionConfigInput = z.object({
  competitionId: z.string().optional(),
  matchConfiguration: z.unknown(),

  acknowledgeExistingFixtures: z.boolean().optional(),
});

const uniqueIds = (ids: string[]) => new Set(ids).size === ids.length;

const galleryImageUrl = mediaUrlSchema.refine((u) => isMediaUrlFor(u, "gallery", "full"), "expected an uploaded gallery image");
const galleryThumbUrl = mediaUrlSchema.refine((u) => isMediaUrlFor(u, "gallery", "thumb"), "expected an uploaded gallery thumbnail");
const committeePhotoUrl = mediaUrlSchema.refine((u) => isMediaUrlFor(u, "committee", "photo"), "expected an uploaded committee photo");

const pixelSize = z.number().int().min(1).max(8000);

const galleryIds = z.array(docId).min(1).max(GALLERY_MAX_ITEMS).refine(uniqueIds, "DUPLICATE_IDS");
const committeeIds = z.array(docId).min(1).max(COMMITTEE_MAX_MEMBERS).refine(uniqueIds, "DUPLICATE_IDS");

export const galleryAddInput = z.object({
  imageUrl: galleryImageUrl,
  thumbUrl: galleryThumbUrl,
  width: pixelSize,
  height: pixelSize,
  focus: focalPointSchema.optional(),
  visible: z.boolean().optional(),
});

export const galleryUpdateInput = z
  .object({
    id: docId,
    focus: focalPointSchema.optional(),
    imageUrl: galleryImageUrl.optional(),
    thumbUrl: galleryThumbUrl.optional(),
    width: pixelSize.optional(),
    height: pixelSize.optional(),
  })
  .refine(
    (v) => {
      const supplied = [v.imageUrl, v.thumbUrl, v.width, v.height].filter((x) => x !== undefined).length;
      return supplied === 0 || supplied === 4;
    },
    { message: "imageUrl, thumbUrl, width and height must be supplied together" }
  );

export const galleryIdsInput = z.object({ ids: galleryIds });
export const galleryReorderInput = z.object({ ids: galleryIds });
export const gallerySetVisibilityInput = z.object({ ids: galleryIds, visible: z.boolean() });

export const committeeAddInput = z.object({
  name: z.string().trim().min(1).max(SITE_TEXT_LIMITS.name),
  role: z.string().trim().min(1).max(SITE_TEXT_LIMITS.role),
  category: z.enum(COMMITTEE_CATEGORIES).optional(),
  photoUrl: committeePhotoUrl.optional(),
  focus: focalPointSchema.optional(),
  featured: z.boolean().optional(),
  visible: z.boolean().optional(),
});

export const committeeUpdateInput = z.object({
  id: docId,
  name: z.string().trim().min(1).max(SITE_TEXT_LIMITS.name).optional(),
  role: z.string().trim().min(1).max(SITE_TEXT_LIMITS.role).optional(),
  category: z.enum(COMMITTEE_CATEGORIES).optional(),
  photoUrl: committeePhotoUrl.optional(),
  focus: focalPointSchema.optional(),
  featured: z.boolean().optional(),
});

export const committeeIdsInput = z.object({ ids: committeeIds });
export const committeeReorderInput = z.object({ ids: committeeIds });
export const committeeSetVisibilityInput = z.object({ ids: committeeIds, visible: z.boolean() });
export const committeeRemovePhotoInput = z.object({ id: docId });

export const detailsUpdateInput = z
  .object({
  eventLabel: z.string().trim().max(SITE_TEXT_LIMITS.eventLabel).optional(),
  tagline: z.string().trim().max(SITE_TEXT_LIMITS.tagline).optional(),
  footerNote: z.string().trim().max(SITE_TEXT_LIMITS.footerNote).optional(),
  heroTitle: z.string().trim().max(SITE_TEXT_LIMITS.heroTitle).optional(),
  contact: z
    .object({
      email: z.string().trim().max(SITE_TEXT_LIMITS.email).optional(),
      phone: z.string().trim().max(SITE_TEXT_LIMITS.phone).optional(),
    })
    .strict()
    .optional(),
  })
  .strict();
