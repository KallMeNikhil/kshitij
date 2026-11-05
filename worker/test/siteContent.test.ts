import { describe, expect, it, vi } from "vitest";
import {
  galleryAdd,
  galleryUpdate,
  galleryDelete,
  galleryReorder,
  gallerySetVisibility,
  committeeAdd,
  committeeUpdate,
  committeeDelete,
  committeeReorder,
  committeeSetVisibility,
  committeeRemovePhoto,
  detailsUpdate,
} from "../src/operations/siteContent";
import { ctxFor, fakeDb } from "./helpers";
import type { AuthContext } from "../src/auth/authorize";
import type { CommitteeMemberDoc, GalleryItemDoc } from "../../shared/types";

const ORIGIN = "https://api.example";

function mediaUrl(kind: "gallery" | "committee", variant: "full" | "thumb" | "photo", n: number): string {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return `${ORIGIN}/media/${kind}/${id}-${variant}.webp`;
}

function galleryItem(n: number, over: Partial<GalleryItemDoc> = {}): GalleryItemDoc {
  return {
    id: `item-${n}`,
    imageUrl: mediaUrl("gallery", "full", n),
    thumbUrl: mediaUrl("gallery", "thumb", n),
    width: 1600,
    height: 1000,
    focus: { x: 50, y: 50 },
    visible: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

function member(n: number, over: Partial<CommitteeMemberDoc> = {}): CommitteeMemberDoc {
  return {
    id: `member-${n}`,
    name: `Member ${n}`,
    role: "Coordinator",
    photoUrl: mediaUrl("committee", "photo", n),
    focus: { x: 50, y: 22 },
    category: "coordinator",
    featured: false,
    visible: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

function setup(doc: Record<string, unknown> | null, withMedia = true) {
  const db = fakeDb({ getDocument: vi.fn().mockResolvedValue(doc) });
  const media = { delete: vi.fn().mockResolvedValue(undefined) };
  const ctx: AuthContext = { ...ctxFor(db), ...(withMedia ? { media } : {}) };
  return { db, media, ctx };
}

function writes(db: ReturnType<typeof fakeDb>) {
  return db.commit.mock.calls[0][1] as Array<{ collection: string; id: string; data: Record<string, any>; mergeFields?: string[] }>;
}

describe("site content operations are Super Admin only", () => {
  it("rejects a coordinator on every operation", async () => {
    const db = fakeDb();
    const coordinator = ctxFor(db, "SPORT_COORDINATOR", ["basketball"]);
    const calls = [
      galleryAdd(coordinator, {}),
      galleryUpdate(coordinator, {}),
      galleryDelete(coordinator, {}),
      galleryReorder(coordinator, {}),
      gallerySetVisibility(coordinator, {}),
      committeeAdd(coordinator, {}),
      committeeUpdate(coordinator, {}),
      committeeDelete(coordinator, {}),
      committeeReorder(coordinator, {}),
      committeeSetVisibility(coordinator, {}),
      committeeRemovePhoto(coordinator, {}),
      detailsUpdate(coordinator, {}),
    ];
    for (const call of calls) await expect(call).rejects.toMatchObject({ code: "SUPER_ADMIN_REQUIRED" });
    expect(db.commit).not.toHaveBeenCalled();
  });
});

describe("gallery", () => {
  it("adds an item at the end with defaults and writes an audit entry", async () => {
    const { db, ctx } = setup({ items: [galleryItem(1)] });
    const result = (await galleryAdd(ctx, {
      imageUrl: mediaUrl("gallery", "full", 2),
      thumbUrl: mediaUrl("gallery", "thumb", 2),
      width: 1200,
      height: 800,
    })) as { item: GalleryItemDoc };

    const [site, audit] = writes(db);
    expect(site).toMatchObject({ collection: "siteContent", id: "gallery", mergeFields: ["items", "updatedAt", "updatedBy"] });
    expect(site.data.items).toHaveLength(2);
    expect(site.data.items[1]).toMatchObject({ id: result.item.id, visible: true, focus: { x: 50, y: 50 } });
    expect(audit).toMatchObject({ collection: "auditLogs", data: { action: "galleryAdd", targetType: "gallery", targetId: result.item.id } });
  });

  it("creates the document when none exists yet", async () => {
    const { db, ctx } = setup(null);
    await galleryAdd(ctx, {
      imageUrl: mediaUrl("gallery", "full", 1),
      thumbUrl: mediaUrl("gallery", "thumb", 1),
      width: 10,
      height: 10,
    });
    expect(writes(db)[0].data.items).toHaveLength(1);
  });

  it("rejects image urls that were not produced by the gallery upload", async () => {
    const { db, ctx } = setup({ items: [] });
    await expect(
      galleryAdd(ctx, { imageUrl: "https://evil.example/x.png", thumbUrl: mediaUrl("gallery", "thumb", 1), width: 10, height: 10 })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      galleryAdd(ctx, { imageUrl: mediaUrl("committee", "photo", 1), thumbUrl: mediaUrl("gallery", "thumb", 1), width: 10, height: 10 })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      galleryAdd(ctx, { imageUrl: mediaUrl("gallery", "thumb", 1), thumbUrl: mediaUrl("gallery", "full", 1), width: 10, height: 10 })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("refuses to grow past the item limit", async () => {
    const items = Array.from({ length: 200 }, (_, i) => galleryItem(i + 1));
    const { db, ctx } = setup({ items });
    await expect(
      galleryAdd(ctx, { imageUrl: mediaUrl("gallery", "full", 999), thumbUrl: mediaUrl("gallery", "thumb", 999), width: 10, height: 10 })
    ).rejects.toMatchObject({ code: "LIST_FULL" });
    expect(db.commit).not.toHaveBeenCalled();
    expect(db.rollback).toHaveBeenCalled();
  });

  it("updates the focal point without touching media", async () => {
    const { db, media, ctx } = setup({ items: [galleryItem(1), galleryItem(2)] });
    await galleryUpdate(ctx, { id: "item-2", focus: { x: 20, y: 80 } });
    const saved = writes(db)[0].data.items as GalleryItemDoc[];
    expect(saved[1]).toMatchObject({ focus: { x: 20, y: 80 } });
    expect(saved[0]).toEqual(galleryItem(1));
    expect(media.delete).not.toHaveBeenCalled();
  });

  it("deletes the old keys when the image is replaced", async () => {
    const { media, ctx } = setup({ items: [galleryItem(1)] });
    await galleryUpdate(ctx, {
      id: "item-1",
      imageUrl: mediaUrl("gallery", "full", 5),
      thumbUrl: mediaUrl("gallery", "thumb", 5),
      width: 900,
      height: 900,
    });
    const keys = media.delete.mock.calls.map((c) => c[0]).sort();
    expect(keys).toEqual([
      "gallery/00000000-0000-4000-8000-000000000001-full.webp",
      "gallery/00000000-0000-4000-8000-000000000001-thumb.webp",
    ]);
  });

  it("drops legacy caption and alt keys on the next write", async () => {
    const legacy = { ...galleryItem(1), caption: "Old", alt: "Old alt" };
    const { db, ctx } = setup({ items: [legacy] });
    await galleryUpdate(ctx, { id: "item-1", focus: { x: 5, y: 5 } });
    const saved = (writes(db)[0].data.items as Array<Record<string, unknown>>)[0];
    expect("caption" in saved).toBe(false);
    expect("alt" in saved).toBe(false);
  });

  it("requires all image fields together when replacing", async () => {
    const { ctx } = setup({ items: [galleryItem(1)] });
    await expect(galleryUpdate(ctx, { id: "item-1", imageUrl: mediaUrl("gallery", "full", 5) })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("returns 404 for an unknown item", async () => {
    const { db, ctx } = setup({ items: [galleryItem(1)] });
    await expect(galleryUpdate(ctx, { id: "item-9", focus: { x: 1, y: 1 } })).rejects.toMatchObject({ status: 404, code: "GALLERY_ITEM_NOT_FOUND" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("deletes several items atomically and removes their media", async () => {
    const { db, media, ctx } = setup({ items: [galleryItem(1), galleryItem(2), galleryItem(3)] });
    const result = (await galleryDelete(ctx, { ids: ["item-1", "item-3"] })) as { deleted: string[] };
    expect(result.deleted).toEqual(["item-1", "item-3"]);
    expect((writes(db)[0].data.items as GalleryItemDoc[]).map((i) => i.id)).toEqual(["item-2"]);
    expect(media.delete).toHaveBeenCalledTimes(4);
    expect(db.commit).toHaveBeenCalledTimes(1);
  });

  it("keeps the data change when media cleanup fails", async () => {
    const { db, media, ctx } = setup({ items: [galleryItem(1)] });
    media.delete.mockRejectedValue(new Error("kv down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(galleryDelete(ctx, { ids: ["item-1"] })).resolves.toMatchObject({ deleted: ["item-1"] });
    expect(db.commit).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("refuses a delete before committing when the media store is not bound", async () => {
    const { db, ctx } = setup({ items: [galleryItem(1)] }, false);
    await expect(galleryDelete(ctx, { ids: ["item-1"] })).rejects.toMatchObject({ code: "MEDIA_NOT_CONFIGURED" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("saves a full reorder in one write and rejects a stale order", async () => {
    const { db, ctx } = setup({ items: [galleryItem(1), galleryItem(2), galleryItem(3)] });
    await galleryReorder(ctx, { ids: ["item-3", "item-1", "item-2"] });
    expect((writes(db)[0].data.items as GalleryItemDoc[]).map((i) => i.id)).toEqual(["item-3", "item-1", "item-2"]);
    expect(db.commit).toHaveBeenCalledTimes(1);

    const stale = setup({ items: [galleryItem(1), galleryItem(2), galleryItem(3)] });
    await expect(galleryReorder(stale.ctx, { ids: ["item-1", "item-2"] })).rejects.toMatchObject({ status: 409, code: "ORDER_MISMATCH" });
    await expect(galleryReorder(stale.ctx, { ids: ["item-1", "item-2", "item-9"] })).rejects.toMatchObject({ code: "ORDER_MISMATCH" });
    await expect(galleryReorder(stale.ctx, { ids: ["item-1", "item-1", "item-2"] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(stale.db.commit).not.toHaveBeenCalled();
  });

  it("hides and shows items in bulk", async () => {
    const { db, ctx } = setup({ items: [galleryItem(1), galleryItem(2)] });
    await gallerySetVisibility(ctx, { ids: ["item-1", "item-2"], visible: false });
    const saved = writes(db)[0].data.items as GalleryItemDoc[];
    expect(saved.every((i) => i.visible === false)).toBe(true);
    expect(writes(db)[1].data.action).toBe("gallerySetVisibility");
  });
});

describe("committee", () => {
  it("adds a member without a photo and keeps the monogram path open", async () => {
    const { db, ctx } = setup({ members: [] });
    const result = (await committeeAdd(ctx, { name: "  Asha Rao ", role: "Convener" })) as { member: CommitteeMemberDoc };
    const saved = writes(db)[0].data.members as CommitteeMemberDoc[];
    expect(saved[0]).toMatchObject({ id: result.member.id, name: "Asha Rao", role: "Convener", featured: false, visible: true });
    expect("photoUrl" in saved[0]).toBe(false);
    expect(writes(db)[0].mergeFields).toEqual(["members", "updatedAt", "updatedBy"]);
  });

  it("rejects a photo that is not a committee upload", async () => {
    const { ctx } = setup({ members: [] });
    await expect(committeeAdd(ctx, { name: "A", role: "B", photoUrl: mediaUrl("gallery", "full", 1) })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("replaces a photo and deletes the previous key", async () => {
    const { db, media, ctx } = setup({ members: [member(1)] });
    await committeeUpdate(ctx, { id: "member-1", photoUrl: mediaUrl("committee", "photo", 7), featured: true });
    const saved = writes(db)[0].data.members as CommitteeMemberDoc[];
    expect(saved[0]).toMatchObject({ photoUrl: mediaUrl("committee", "photo", 7), featured: true });
    expect(media.delete).toHaveBeenCalledWith("committee/00000000-0000-4000-8000-000000000001-photo.webp");
  });

  it("edits text fields and keeps the existing photo", async () => {
    const { db, media, ctx } = setup({ members: [member(1)] });
    await committeeUpdate(ctx, { id: "member-1", name: "New Name", role: "Secretary", focus: { x: 10, y: 10 } });
    const saved = writes(db)[0].data.members as CommitteeMemberDoc[];
    expect(saved[0]).toMatchObject({ name: "New Name", role: "Secretary", photoUrl: mediaUrl("committee", "photo", 1) });
    expect(media.delete).not.toHaveBeenCalled();
  });

  it("removes a photo and its key", async () => {
    const { db, media, ctx } = setup({ members: [member(1)] });
    await committeeRemovePhoto(ctx, { id: "member-1" });
    const saved = writes(db)[0].data.members as CommitteeMemberDoc[];
    expect("photoUrl" in saved[0]).toBe(false);
    expect(media.delete).toHaveBeenCalledTimes(1);
  });

  it("deletes a member and the photo", async () => {
    const { db, media, ctx } = setup({ members: [member(1), member(2, { photoUrl: undefined })] });
    await committeeDelete(ctx, { ids: ["member-1", "member-2"] });
    expect(writes(db)[0].data.members).toEqual([]);
    expect(media.delete).toHaveBeenCalledTimes(1);
  });

  it("reorders and toggles visibility", async () => {
    const reorder = setup({ members: [member(1), member(2)] });
    await committeeReorder(reorder.ctx, { ids: ["member-2", "member-1"] });
    expect((writes(reorder.db)[0].data.members as CommitteeMemberDoc[]).map((m) => m.id)).toEqual(["member-2", "member-1"]);

    const visibility = setup({ members: [member(1), member(2)] });
    await committeeSetVisibility(visibility.ctx, { ids: ["member-2"], visible: false });
    const saved = writes(visibility.db)[0].data.members as CommitteeMemberDoc[];
    expect(saved.map((m) => m.visible)).toEqual([true, false]);
  });

  it("rejects a stale reorder", async () => {
    const { db, ctx } = setup({ members: [member(1), member(2)] });
    await expect(committeeReorder(ctx, { ids: ["member-1"] })).rejects.toMatchObject({ code: "ORDER_MISMATCH" });
    expect(db.commit).not.toHaveBeenCalled();
  });
});

describe("detailsUpdate", () => {
  it("replaces the whole document and drops blank fields so the static fallback applies", async () => {
    const { db, ctx } = setup(null);
    await detailsUpdate(ctx, {
      eventLabel: " Annual Sports Meet 2026 ",
      tagline: "",
      footerNote: " Annual sports meet. ",
      heroTitle: "",
      contact: { email: "meet@college.edu", phone: "" },
    });
    const [site, audit] = writes(db);
    expect(site.mergeFields).toBeUndefined();
    expect(site.data).toMatchObject({ eventLabel: "Annual Sports Meet 2026", footerNote: "Annual sports meet.", contact: { email: "meet@college.edu" } });
    expect("tagline" in site.data).toBe(false);
    expect("heroTitle" in site.data).toBe(false);
    expect("phone" in site.data.contact).toBe(false);
    expect(audit.data.action).toBe("detailsUpdate");
  });

  it("omits the contact map entirely when every contact field is blank", async () => {
    const { db, ctx } = setup(null);
    await detailsUpdate(ctx, { contact: { email: "", phone: "" } });
    expect("contact" in writes(db)[0].data).toBe(false);
  });

  it("rejects unexpected fields at the top level and inside contact", async () => {
    const { db, ctx } = setup(null);
    await expect(detailsUpdate(ctx, { surprise: "x" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(detailsUpdate(ctx, { contact: { email: "a@b.co", fax: "1" } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(detailsUpdate(ctx, { contact: "text" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(db.commit).not.toHaveBeenCalled();
  });

  it("rejects an invalid email or phone", async () => {
    const { db, ctx } = setup(null);
    await expect(detailsUpdate(ctx, { contact: { email: "not-an-email" } })).rejects.toMatchObject({ code: "INVALID_SITE_DETAILS" });
    await expect(detailsUpdate(ctx, { contact: { phone: "call me" } })).rejects.toMatchObject({ code: "INVALID_SITE_DETAILS" });
    expect(db.commit).not.toHaveBeenCalled();
  });
});

describe("media origin", () => {
  it("only accepts images served by this Worker", async () => {
    const { ctx } = setup({ items: [] });
    const own = { ...ctx, origin: ORIGIN };
    const foreign = (url: string) => url.replace(ORIGIN, "https://elsewhere.example");
    await expect(
      galleryAdd(own, { imageUrl: foreign(mediaUrl("gallery", "full", 3)), thumbUrl: mediaUrl("gallery", "thumb", 3), width: 10, height: 10 })
    ).rejects.toMatchObject({ code: "INVALID_MEDIA_URL" });
    await expect(galleryAdd(own, { imageUrl: mediaUrl("gallery", "full", 3), thumbUrl: mediaUrl("gallery", "thumb", 3), width: 10, height: 10 })).resolves.toBeTruthy();
    await expect(committeeAdd(own, { name: "A", role: "B", photoUrl: foreign(mediaUrl("committee", "photo", 4)) })).rejects.toMatchObject({ code: "INVALID_MEDIA_URL" });
  });
});
