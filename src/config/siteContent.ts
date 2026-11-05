import type { CommitteeCategory } from "../../shared/media";

export interface FocalPoint {
  x: number;
  y: number;
}

export interface GalleryImage {
  id: string;
  src: string;
  thumb?: string;
  width?: number;
  height?: number;
  focus?: FocalPoint;
}

export interface CommitteeMember {
  id: string;
  name: string;
  role: string;
  category: CommitteeCategory;
  photo?: string;
  featured?: boolean;
  focus?: FocalPoint;
}

export interface SiteContact {
  email?: string;
  phone?: string;
}

export const siteContent: {
  eventName: string;
  tagline: string;
  eventLabel: string;
  footerNote: string;
  heroTitle: string;
  contact: SiteContact;
} = {
  eventName: "KSHITIJ",
  tagline: "Every point is earned",
  eventLabel: "Annual Sports Meet",
  footerNote: "JIIT Annual Sports Meet.",
  heroTitle: "KSHITIJ 3.0",
  contact: {},
};
