import { describe, expect, it } from "vitest";
import {
  buildMediaKey,
  contentTypeForKey,
  isMediaKey,
  isMediaUrl,
  isMediaUrlFor,
  mediaKeyFromUrl,
  sniffImageType,
} from "./media";
import {
  committeeMemberSchema,
  committeeSiteDocSchema,
  galleryItemSchema,
  gallerySiteDocSchema,
  siteDetailsSchema,
  SITE_TEXT_LIMITS,
} from "./schemas";

const ID = "00000000-0000-4000-8000-000000000001";
const FULL = `https://api.example/media/gallery/${ID}-full.webp`;
const THUMB = `https://api.example/media/gallery/${ID}-thumb.webp`;
const PHOTO = `https://api.example/media/committee/${ID}-photo.jpg`;

const item = {
  id: "item-1",
  imageUrl: FULL,
  thumbUrl: THUMB,
  width: 1600,
  height: 900,
  focus: { x: 50, y: 50 },
  visible: true,
  createdAt: "2026-10-18T00:00:00.000Z",
  updatedAt: "2026-10-18T00:00:00.000Z",
};

const member = {
  id: "member-1",
  name: "Asha Rao",
  role: "Convener",
  focus: { x: 50, y: 22 },
  category: "faculty" as const,
  featured: true,
  visible: true,
  createdAt: "2026-10-18T00:00:00.000Z",
  updatedAt: "2026-10-18T00:00:00.000Z",
};

describe("media keys and urls", () => {
  it("builds keys that pass the key check and round-trips them through a url", () => {
    const key = buildMediaKey("gallery", "full", ID, "image/webp");
    expect(key).toBe(`gallery/${ID}-full.webp`);
    expect(isMediaKey(key)).toBe(true);
    expect(mediaKeyFromUrl(`https://x.example/media/${key}`)).toBe(key);
    expect(contentTypeForKey(key)).toBe("image/webp");
  });

  it("rejects keys and urls that are not uploads", () => {
    expect(isMediaKey("gallery/../x.webp")).toBe(false);
    expect(isMediaKey(`other/${ID}-full.webp`)).toBe(false);
    expect(isMediaKey(`gallery/${ID}-huge.webp`)).toBe(false);
    expect(isMediaKey(`gallery/${ID}-full.gif`)).toBe(false);
    expect(isMediaUrl("https://x.example/other/gallery/a.webp")).toBe(false);
    expect(isMediaUrl("not a url")).toBe(false);
    expect(isMediaUrl(`https://x.example/media/gallery%2F..%2Fsecret`)).toBe(false);
  });

  it("matches urls to their kind and variant", () => {
    expect(isMediaUrlFor(FULL, "gallery", "full")).toBe(true);
    expect(isMediaUrlFor(FULL, "gallery", "thumb")).toBe(false);
    expect(isMediaUrlFor(THUMB, "gallery", "thumb")).toBe(true);
    expect(isMediaUrlFor(PHOTO, "committee", "photo")).toBe(true);
    expect(isMediaUrlFor(PHOTO, "gallery", "photo")).toBe(false);
  });

  it("sniffs only JPEG, PNG and WebP", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
  });
});

describe("site content schemas", () => {
  it("accepts a complete gallery item and rejects bad focus, urls and sizes", () => {
    expect(galleryItemSchema.safeParse(item).success).toBe(true);
    expect(galleryItemSchema.safeParse({ ...item, focus: { x: 120, y: 0 } }).success).toBe(false);
    expect(galleryItemSchema.safeParse({ ...item, imageUrl: "https://evil.example/a.png" }).success).toBe(false);
    expect(galleryItemSchema.safeParse({ ...item, width: 0 }).success).toBe(false);
  });

  it("strips legacy caption, alt and description keys instead of failing", () => {
    const gallery = galleryItemSchema.safeParse({ ...item, caption: "Old", alt: "Old alt" });
    expect(gallery.success).toBe(true);
    expect(gallery.success && "caption" in gallery.data).toBe(false);
    expect(gallery.success && "alt" in gallery.data).toBe(false);
    const committee = committeeMemberSchema.safeParse({ ...member, description: "Old" });
    expect(committee.success).toBe(true);
    expect(committee.success && "description" in committee.data).toBe(false);
    const details = siteDetailsSchema.safeParse({ contact: { email: "a@b.co", venue: "Old" } });
    expect(details.success).toBe(true);
    expect(details.success && details.data.contact && "venue" in details.data.contact).toBe(false);
  });

  it("makes the committee photo optional", () => {
    expect(committeeMemberSchema.safeParse(member).success).toBe(true);
    expect(committeeMemberSchema.safeParse({ ...member, photoUrl: PHOTO }).success).toBe(true);
    expect(committeeMemberSchema.safeParse({ ...member, photoUrl: "https://evil.example/a.png" }).success).toBe(false);
    expect(committeeMemberSchema.safeParse({ ...member, name: "" }).success).toBe(false);
    expect(committeeMemberSchema.safeParse({ ...member, featured: "yes" }).success).toBe(false);
  });

  it("bounds the list documents", () => {
    expect(gallerySiteDocSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(gallerySiteDocSchema.safeParse({ items: Array.from({ length: 201 }, () => item) }).success).toBe(false);
    expect(committeeSiteDocSchema.safeParse({ members: [member] }).success).toBe(true);
    expect(committeeSiteDocSchema.safeParse({ members: Array.from({ length: 101 }, () => member) }).success).toBe(false);
  });

  it("treats every details field as optional and validates contact values", () => {
    expect(siteDetailsSchema.safeParse({}).success).toBe(true);
    expect(siteDetailsSchema.safeParse({ eventLabel: "Meet", tagline: "Go", footerNote: "Note", heroTitle: "Title", contact: { email: "a@b.co", phone: "+91 98765 43210" } }).success).toBe(true);
    expect(siteDetailsSchema.safeParse({ contact: { email: "nope" } }).success).toBe(false);
    expect(siteDetailsSchema.safeParse({ contact: { phone: "abc" } }).success).toBe(false);
    expect(siteDetailsSchema.safeParse({ eventLabel: "" }).success).toBe(false);
  });

  it("rejects unexpected top-level fields, a non-object contact and over-long text", () => {
    expect(siteDetailsSchema.safeParse({ surprise: 1 }).success).toBe(false);
    expect(siteDetailsSchema.safeParse({ contact: "text" }).success).toBe(false);
    expect(siteDetailsSchema.safeParse({ footerNote: "x".repeat(SITE_TEXT_LIMITS.footerNote + 1) }).success).toBe(false);
    expect(siteDetailsSchema.safeParse({ heroTitle: "x".repeat(SITE_TEXT_LIMITS.heroTitle + 1) }).success).toBe(false);
  });
});
