import type { z } from "zod";
import { AppError } from "../errors";
import { AuthContext, requireSuperAdmin } from "../auth/authorize";
import { auditWrite } from "../audit";
import { deleteMediaUrls } from "../media";
import {
  parseInput,
  galleryAddInput,
  galleryUpdateInput,
  galleryIdsInput,
  galleryReorderInput,
  gallerySetVisibilityInput,
  committeeAddInput,
  committeeUpdateInput,
  committeeIdsInput,
  committeeReorderInput,
  committeeSetVisibilityInput,
  committeeRemovePhotoInput,
  detailsUpdateInput,
} from "../validation";
import { committeeSiteDocSchema, gallerySiteDocSchema, siteDetailsSchema } from "../../../shared/schemas";
import { COMMITTEE_MAX_MEMBERS, GALLERY_MAX_ITEMS } from "../../../shared/media";
import type { CommitteeMemberDoc, GalleryItemDoc, SiteDetailsDoc } from "../../../shared/types";

const SITE_COLLECTION = "siteContent";
const DEFAULT_FOCUS = { x: 50, y: 50 };

interface Listed {
  id: string;
}

interface Channel {
  doc: "gallery" | "committee";
  field: "items" | "members";
  schema: z.ZodType<object>;
  max: number;
  notFound: string;
}

interface Outcome<I, T> {
  items: I[];
  targetId: string;
  before: unknown;
  after: unknown;
  removedUrls: string[];
  result: T;
}

const GALLERY: Channel = {
  doc: "gallery",
  field: "items",
  schema: gallerySiteDocSchema,
  max: GALLERY_MAX_ITEMS,
  notFound: "GALLERY_ITEM_NOT_FOUND",
};

const COMMITTEE: Channel = {
  doc: "committee",
  field: "members",
  schema: committeeSiteDocSchema,
  max: COMMITTEE_MAX_MEMBERS,
  notFound: "COMMITTEE_MEMBER_NOT_FOUND",
};

async function inTransaction<T>(ctx: AuthContext, work: (transaction: string) => Promise<T>): Promise<T> {
  const transaction = await ctx.db.beginTransaction();
  try {
    return await work(transaction);
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }
}

function targetIdFor(channel: Channel, ids: string[]): string {
  return ids.length === 1 ? ids[0] : channel.doc;
}

async function mutateList<I extends Listed, T>(
  ctx: AuthContext,
  channel: Channel,
  action: string,
  mutate: (items: I[], now: string) => Outcome<I, T>
): Promise<T> {
  const outcome = await inTransaction(ctx, async (transaction) => {
    const current = await ctx.db.getDocument<Record<string, unknown>>(SITE_COLLECTION, channel.doc, transaction);
    const stored = current?.[channel.field];
    const existing = Array.isArray(stored) ? (stored as I[]) : [];
    const now = new Date().toISOString();
    const next = mutate(existing, now);

    if (next.items.length > channel.max) {
      throw new AppError(400, "LIST_FULL", `At most ${channel.max} entries are allowed`);
    }
    if (next.removedUrls.length > 0 && !ctx.media) {
      throw new AppError(500, "MEDIA_NOT_CONFIGURED", "The MEDIA KV namespace is not bound to this Worker");
    }

    const parsed = channel.schema.safeParse({ [channel.field]: next.items, updatedAt: now, updatedBy: ctx.email });
    if (!parsed.success) {
      throw new AppError(400, "INVALID_SITE_CONTENT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }

    await ctx.db.commit(transaction, [
      {
        collection: SITE_COLLECTION,
        id: channel.doc,
        data: parsed.data,
        mergeFields: [channel.field, "updatedAt", "updatedBy"],
      },
      auditWrite({
        action,
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: channel.doc,
        targetId: next.targetId,
        before: next.before,
        after: next.after,
      }),
    ]);
    return next;
  });

  try {
    await deleteMediaUrls(ctx.media, outcome.removedUrls);
  } catch (err) {
    console.error("Media cleanup failed", err);
  }
  return outcome.result;
}

function reorderOutcome<I extends Listed>(items: I[], ids: string[]): Outcome<I, { ok: true }> {
  const byId = new Map(items.map((i) => [i.id, i]));
  if (ids.length !== items.length || ids.some((id) => !byId.has(id))) {
    throw new AppError(409, "ORDER_MISMATCH", "The list changed since it was loaded. Reload and try again.");
  }
  return {
    items: ids.map((id) => byId.get(id) as I),
    targetId: "order",
    before: items.map((i) => i.id),
    after: ids,
    removedUrls: [],
    result: { ok: true },
  };
}

function deleteOutcome<I extends Listed>(
  channel: Channel,
  items: I[],
  ids: string[],
  urlsOf: (item: I) => Array<string | undefined>
): Outcome<I, { deleted: string[] }> {
  const wanted = new Set(ids);
  const found = items.filter((i) => wanted.has(i.id));
  if (found.length !== wanted.size) throw new AppError(404, channel.notFound, "One or more entries no longer exist");
  return {
    items: items.filter((i) => !wanted.has(i.id)),
    targetId: targetIdFor(channel, ids),
    before: found,
    after: null,
    removedUrls: found.flatMap(urlsOf).filter((u): u is string => typeof u === "string"),
    result: { deleted: ids },
  };
}

function visibilityOutcome<I extends Listed & { visible: boolean; updatedAt: string }>(
  channel: Channel,
  items: I[],
  ids: string[],
  visible: boolean,
  now: string
): Outcome<I, { updated: string[] }> {
  const wanted = new Set(ids);
  if (items.filter((i) => wanted.has(i.id)).length !== wanted.size) {
    throw new AppError(404, channel.notFound, "One or more entries no longer exist");
  }
  return {
    items: items.map((i) => (wanted.has(i.id) ? { ...i, visible, updatedAt: now } : i)),
    targetId: targetIdFor(channel, ids),
    before: { ids, visible: !visible },
    after: { ids, visible },
    removedUrls: [],
    result: { updated: ids },
  };
}

function indexOrThrow<I extends Listed>(channel: Channel, items: I[], id: string): number {
  const index = items.findIndex((i) => i.id === id);
  if (index < 0) throw new AppError(404, channel.notFound, "Entry not found");
  return index;
}

function replaceAt<I>(items: I[], index: number, next: I): I[] {
  return items.map((item, i) => (i === index ? next : item));
}

export async function galleryAdd(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const body = parseInput(galleryAddInput, input);
  return mutateList<GalleryItemDoc, { item: GalleryItemDoc }>(ctx, GALLERY, "galleryAdd", (items, now) => {
    const item: GalleryItemDoc = {
      id: crypto.randomUUID(),
      imageUrl: body.imageUrl,
      thumbUrl: body.thumbUrl,
      width: body.width,
      height: body.height,
      focus: body.focus ?? DEFAULT_FOCUS,
      visible: body.visible ?? true,
      createdAt: now,
      updatedAt: now,
    };
    return {
      items: [...items, item],
      targetId: item.id,
      before: null,
      after: item,
      removedUrls: [],
      result: { item },
    };
  });
}

export async function galleryUpdate(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const body = parseInput(galleryUpdateInput, input);
  return mutateList<GalleryItemDoc, { item: GalleryItemDoc }>(ctx, GALLERY, "galleryUpdate", (items, now) => {
    const index = indexOrThrow(GALLERY, items, body.id);
    const prev = items[index];
    const next: GalleryItemDoc = {
      ...prev,
      focus: body.focus ?? prev.focus,
      imageUrl: body.imageUrl ?? prev.imageUrl,
      thumbUrl: body.thumbUrl ?? prev.thumbUrl,
      width: body.width ?? prev.width,
      height: body.height ?? prev.height,
      updatedAt: now,
    };
    const removedUrls = [prev.imageUrl, prev.thumbUrl].filter((u) => u !== next.imageUrl && u !== next.thumbUrl);
    return {
      items: replaceAt(items, index, next),
      targetId: prev.id,
      before: prev,
      after: next,
      removedUrls,
      result: { item: next },
    };
  });
}

export async function galleryDelete(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { ids } = parseInput(galleryIdsInput, input);
  return mutateList<GalleryItemDoc, { deleted: string[] }>(ctx, GALLERY, "galleryDelete", (items) =>
    deleteOutcome(GALLERY, items, ids, (i) => [i.imageUrl, i.thumbUrl])
  );
}

export async function galleryReorder(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { ids } = parseInput(galleryReorderInput, input);
  return mutateList<GalleryItemDoc, { ok: true }>(ctx, GALLERY, "galleryReorder", (items) => reorderOutcome(items, ids));
}

export async function gallerySetVisibility(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { ids, visible } = parseInput(gallerySetVisibilityInput, input);
  return mutateList<GalleryItemDoc, { updated: string[] }>(ctx, GALLERY, "gallerySetVisibility", (items, now) =>
    visibilityOutcome(GALLERY, items, ids, visible, now)
  );
}

export async function committeeAdd(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const body = parseInput(committeeAddInput, input);
  return mutateList<CommitteeMemberDoc, { member: CommitteeMemberDoc }>(ctx, COMMITTEE, "committeeAdd", (members, now) => {
    const member: CommitteeMemberDoc = {
      id: crypto.randomUUID(),
      name: body.name,
      role: body.role,
      category: body.category ?? "coordinator",
      ...(body.photoUrl ? { photoUrl: body.photoUrl } : {}),
      focus: body.focus ?? { x: 50, y: 22 },
      featured: body.featured ?? false,
      visible: body.visible ?? true,
      createdAt: now,
      updatedAt: now,
    };
    return {
      items: [...members, member],
      targetId: member.id,
      before: null,
      after: member,
      removedUrls: [],
      result: { member },
    };
  });
}

export async function committeeUpdate(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const body = parseInput(committeeUpdateInput, input);
  return mutateList<CommitteeMemberDoc, { member: CommitteeMemberDoc }>(ctx, COMMITTEE, "committeeUpdate", (members, now) => {
    const index = indexOrThrow(COMMITTEE, members, body.id);
    const prev = members[index];
    const photoUrl = body.photoUrl ?? prev.photoUrl;
    const next: CommitteeMemberDoc = {
      ...prev,
      name: body.name ?? prev.name,
      role: body.role ?? prev.role,
      category: body.category ?? prev.category ?? "coordinator",
      focus: body.focus ?? prev.focus,
      featured: body.featured ?? prev.featured,
      ...(photoUrl ? { photoUrl } : {}),
      updatedAt: now,
    };
    const removedUrls = prev.photoUrl && prev.photoUrl !== next.photoUrl ? [prev.photoUrl] : [];
    return {
      items: replaceAt(members, index, next),
      targetId: prev.id,
      before: prev,
      after: next,
      removedUrls,
      result: { member: next },
    };
  });
}

export async function committeeDelete(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { ids } = parseInput(committeeIdsInput, input);
  return mutateList<CommitteeMemberDoc, { deleted: string[] }>(ctx, COMMITTEE, "committeeDelete", (members) =>
    deleteOutcome(COMMITTEE, members, ids, (m) => [m.photoUrl])
  );
}

export async function committeeReorder(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { ids } = parseInput(committeeReorderInput, input);
  return mutateList<CommitteeMemberDoc, { ok: true }>(ctx, COMMITTEE, "committeeReorder", (members) => reorderOutcome(members, ids));
}

export async function committeeSetVisibility(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { ids, visible } = parseInput(committeeSetVisibilityInput, input);
  return mutateList<CommitteeMemberDoc, { updated: string[] }>(ctx, COMMITTEE, "committeeSetVisibility", (members, now) =>
    visibilityOutcome(COMMITTEE, members, ids, visible, now)
  );
}

export async function committeeRemovePhoto(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const { id } = parseInput(committeeRemovePhotoInput, input);
  return mutateList<CommitteeMemberDoc, { member: CommitteeMemberDoc }>(ctx, COMMITTEE, "committeeRemovePhoto", (members, now) => {
    const index = indexOrThrow(COMMITTEE, members, id);
    const { photoUrl, ...rest } = members[index];
    const next: CommitteeMemberDoc = { ...rest, updatedAt: now };
    return {
      items: replaceAt(members, index, next),
      targetId: id,
      before: members[index],
      after: next,
      removedUrls: photoUrl ? [photoUrl] : [],
      result: { member: next },
    };
  });
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export async function detailsUpdate(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const body = parseInput(detailsUpdateInput, input);
  const eventLabel = nonEmpty(body.eventLabel);
  const tagline = nonEmpty(body.tagline);
  const footerNote = nonEmpty(body.footerNote);
  const heroTitle = nonEmpty(body.heroTitle);
  const email = nonEmpty(body.contact?.email);
  const phone = nonEmpty(body.contact?.phone);
  const contact = {
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
  };
  const now = new Date().toISOString();

  const parsed = siteDetailsSchema.safeParse({
    ...(eventLabel ? { eventLabel } : {}),
    ...(tagline ? { tagline } : {}),
    ...(footerNote ? { footerNote } : {}),
    ...(heroTitle ? { heroTitle } : {}),
    ...(Object.keys(contact).length > 0 ? { contact } : {}),
    updatedAt: now,
    updatedBy: ctx.email,
  });
  if (!parsed.success) {
    throw new AppError(400, "INVALID_SITE_DETAILS", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }

  await inTransaction(ctx, async (transaction) => {
    const before = await ctx.db.getDocument<SiteDetailsDoc>(SITE_COLLECTION, "details", transaction);
    await ctx.db.commit(transaction, [
      { collection: SITE_COLLECTION, id: "details", data: parsed.data },
      auditWrite({
        action: "detailsUpdate",
        actorEmail: ctx.email,
        actorRole: ctx.admin.role,
        targetType: "details",
        targetId: "details",
        before,
        after: parsed.data,
      }),
    ]);
  });

  return { ok: true, details: parsed.data };
}
