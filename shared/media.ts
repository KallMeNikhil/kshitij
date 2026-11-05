export const MEDIA_KINDS = ["gallery", "committee"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_VARIANTS = ["full", "thumb", "photo"] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];

export const MEDIA_VARIANTS_BY_KIND: Record<MediaKind, readonly MediaVariant[]> = {
  gallery: ["full", "thumb"],
  committee: ["photo"],
};

export const MEDIA_MAX_BYTES: Record<MediaVariant, number> = {
  full: 3 * 1024 * 1024,
  thumb: 512 * 1024,
  photo: 2 * 1024 * 1024,
};

export const MEDIA_PATH_PREFIX = "/media/";

export const IMAGE_MAX_EDGE = 1600;
export const THUMB_EDGE = 480;
export const PHOTO_MAX_EDGE = 1200;
export const FULL_QUALITY = 0.82;
export const THUMB_QUALITY = 0.72;

export const GALLERY_MAX_ITEMS = 200;
export const COMMITTEE_MAX_MEMBERS = 100;
export const COMMITTEE_CATEGORIES = ["faculty", "leadership", "coordinator"] as const;
export type CommitteeCategory = (typeof COMMITTEE_CATEGORIES)[number];
export const COMMITTEE_CATEGORY_LABELS: Record<CommitteeCategory, string> = {
  faculty: "Mentors",
  leadership: "Council",
  coordinator: "Coordinators",
};
export const COMMITTEE_CATEGORY_HINTS: Record<CommitteeCategory, string> = {
  faculty: "Mentors (faculty)",
  leadership: "Council (senior students)",
  coordinator: "Coordinators (students)",
};

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

const EXTENSIONS: Record<ImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const KEY_PATTERN =
  /^(gallery|committee)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(full|thumb|photo)\.(jpg|png|webp)$/;

export function extensionFor(type: ImageType): string {
  return EXTENSIONS[type];
}

export function contentTypeForKey(key: string): ImageType | null {
  if (key.endsWith(".jpg")) return "image/jpeg";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  return null;
}

export function isMediaKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function buildMediaKey(kind: MediaKind, variant: MediaVariant, id: string, type: ImageType): string {
  return `${kind}/${id}-${variant}.${EXTENSIONS[type]}`;
}

export function mediaKeyFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.pathname.startsWith(MEDIA_PATH_PREFIX)) return null;
  let key: string;
  try {
    key = decodeURIComponent(parsed.pathname.slice(MEDIA_PATH_PREFIX.length));
  } catch {
    return null;
  }
  return isMediaKey(key) ? key : null;
}

export function isMediaUrl(url: string): boolean {
  return mediaKeyFromUrl(url) !== null;
}

export function isMediaUrlFor(url: string, kind: MediaKind, variant: MediaVariant): boolean {
  const key = mediaKeyFromUrl(url);
  return key !== null && key.startsWith(`${kind}/`) && key.includes(`-${variant}.`);
}

export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
