import { siteContent, type CommitteeMember, type FocalPoint, type GalleryImage, type SiteContact } from "../config/siteContent";
import type { CommitteeMemberDoc, GalleryItemDoc, SiteDetailsDoc } from "../../shared/types";
import { COMMITTEE_CATEGORIES, type CommitteeCategory } from "../../shared/media";

export interface SiteDetails {
  eventLabel: string;
  tagline: string;
  footerNote: string;
  heroTitle: string;
  contact: SiteContact;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function focusOf(value: unknown): FocalPoint {
  const v = value as { x?: unknown; y?: unknown } | null | undefined;
  const x = typeof v?.x === "number" && Number.isFinite(v.x) ? Math.min(100, Math.max(0, v.x)) : 50;
  const y = typeof v?.y === "number" && Number.isFinite(v.y) ? Math.min(100, Math.max(0, v.y)) : 50;
  return { x, y };
}

function size(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function parseGallery(raw: unknown): GalleryItemDoc[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && typeof entry === "object" && text((entry as GalleryItemDoc).id) && text((entry as GalleryItemDoc).imageUrl))
    .map((entry) => {
      const item = entry as Partial<GalleryItemDoc>;
      const imageUrl = text(item.imageUrl);
      return {
        id: text(item.id),
        imageUrl,
        thumbUrl: text(item.thumbUrl) || imageUrl,
        width: size(item.width),
        height: size(item.height),
        focus: focusOf(item.focus),
        visible: item.visible !== false,
        createdAt: text(item.createdAt),
        updatedAt: text(item.updatedAt),
      };
    });
}

export function parseCommittee(raw: unknown): CommitteeMemberDoc[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && typeof entry === "object" && text((entry as CommitteeMemberDoc).id) && text((entry as CommitteeMemberDoc).name))
    .map((entry) => {
      const member = entry as Partial<CommitteeMemberDoc>;
      const photoUrl = text(member.photoUrl);
      return {
        id: text(member.id),
        name: text(member.name),
        role: text(member.role),
        category: COMMITTEE_CATEGORIES.includes(member.category as CommitteeCategory) ? (member.category as CommitteeCategory) : "coordinator",
        ...(photoUrl ? { photoUrl } : {}),
        focus: focusOf(member.focus),
        featured: member.featured === true,
        visible: member.visible !== false,
        createdAt: text(member.createdAt),
        updatedAt: text(member.updatedAt),
      };
    });
}

export function toGalleryImages(items: readonly GalleryItemDoc[]): GalleryImage[] {
  return items
    .filter((item) => item.visible)
    .map((item) => ({
      id: item.id,
      src: item.imageUrl,
      thumb: item.thumbUrl,
      width: item.width || undefined,
      height: item.height || undefined,
      focus: item.focus,
    }));
}

export function toCommitteeMembers(members: readonly CommitteeMemberDoc[]): CommitteeMember[] {
  return members
    .filter((member) => member.visible)
    .map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      category: member.category,
      photo: member.photoUrl,
      featured: member.featured,
      focus: member.focus,
    }));
}

function pick(value: string | undefined, fallback: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export function resolveDetails(details: SiteDetailsDoc | null | undefined): SiteDetails {
  return {
    eventLabel: pick(details?.eventLabel, siteContent.eventLabel) ?? siteContent.eventLabel,
    tagline: pick(details?.tagline, siteContent.tagline) ?? siteContent.tagline,
    footerNote: pick(details?.footerNote, siteContent.footerNote) ?? siteContent.footerNote,
    heroTitle: pick(details?.heroTitle, siteContent.heroTitle) ?? siteContent.heroTitle,
    contact: {
      email: pick(details?.contact?.email, siteContent.contact.email),
      phone: pick(details?.contact?.phone, siteContent.contact.phone),
    },
  };
}
