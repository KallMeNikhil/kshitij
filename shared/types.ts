
import type { CommitteeCategory } from "./media";
import type { MatchConfiguration } from "./matchConfig";
import type { TournamentConfiguration } from "./tournamentConfig";

export type ScoringModel =
  | "FOOTBALL_EVENTS"
  | "CRICKET_INNINGS"
  | "BASKETBALL_POINTS"
  | "SETS_POINTS"
  | "TENNIS_SETS_GAMES"
  | "RESULT_ONLY";

export type ParticipantType = "INDIVIDUAL" | "PAIR" | "TEAM";
export type CompetitionFormat = "KNOCKOUT";
export type Gender = "MEN" | "WOMEN" | "MIXED" | "OPEN" | null;
export type SlotKind = "PARTICIPANT" | "TEAM" | "FIXTURE_WINNER" | "BYE" | "TBD";
export type ImportableFixtureStatus = "DRAFT" | "SCHEDULED";
export type FixtureStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "LIVE"
  | "COMPLETED"
  | "POSTPONED"
  | "CANCELLED";

export type AdminRole = "SUPER_ADMIN" | "SPORT_COORDINATOR";

export interface AuditLogDoc {
  action: string;
  actorEmail: string;
  actorRole?: AdminRole;
  targetType: string;
  targetId: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  createdAt: string;
}

export interface AdminDoc {
  email: string;
  displayName?: string;
  role: AdminRole;
  sportIds: string[];
  active: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface EventDoc {
  name: string;
  edition?: string;
  startDate?: string;
  endDate?: string;
  timezone: string;
  colleges?: string[];
  venues?: string[];
}

export interface ScoringConfig {
  bestOf?: number;
  pointsToWin?: number;
  capPoints?: number;
  quarters?: number;
  quarterMinutes?: number;
  oversPerInnings?: number;
}

export interface SportDoc {
  sportId: string;
  name: string;
  slug: string;
  scoringModel: ScoringModel;
  displayOrder: number;
  active: boolean;
  defaultScoring?: ScoringConfig;

  matchConfiguration?: MatchConfiguration;
}

export interface TeamSize {
  min: number;
  max: number;
}

export interface CompetitionDoc {
  competitionId: string;
  sportId: string;
  name: string;
  categoryKey: string;
  gender: Gender;
  participantType: ParticipantType;
  format: CompetitionFormat;
  teamSize?: TeamSize;
  scoring?: ScoringConfig;

  matchConfiguration?: MatchConfiguration;

  tournamentConfiguration?: TournamentConfiguration;
  published: boolean;
  displayOrder: number;
}

export type EntrantStatus = "ACTIVE" | "WITHDRAWN";

export interface ParticipantDoc {
  participantId: string;
  name: string;
  phone: string;
  college: string;
  sportId: string;
  competitionId: string;

  status?: EntrantStatus;
  importBatchId?: string;
}

export interface TeamDoc {
  teamId: string;
  teamName?: string;
  sportId: string;
  competitionId: string;
  college: string;
  captainParticipantId: string;
  memberIds: string[];

  status?: EntrantStatus;
  importBatchId?: string;
}

export interface Slot {
  kind: SlotKind;
  participantId?: string;
  teamId?: string;
  fromFixtureId?: string;
}

export interface FixtureDoc {
  fixtureId: string;
  competitionId: string;
  sportId: string;
  round: number;
  matchNumber: number;
  slotA: Slot;
  slotB: Slot;
  scheduledDate?: string;
  scheduledTime?: string;
  venue?: string;
  status: FixtureStatus;
  statusReason?: string;
  resumeStatus?: "SCHEDULED" | "LIVE";
  nextFixtureId?: string | null;
  nextSlot?: "A" | "B" | null;
  displaySummary?: {
    labelA: string;
    labelB: string;
  };

  matchConfigurationSnapshot?: MatchConfiguration;
  importBatchId?: string;
}

export interface AnnouncementDoc {
  announcementId: string;
  title: string;
  body: string;
  sportId: string | null;
  createdAt: string;
}

export interface FocalPointDoc {
  x: number;
  y: number;
}

export interface GalleryItemDoc {
  id: string;
  imageUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  focus: FocalPointDoc;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommitteeMemberDoc {
  id: string;
  name: string;
  role: string;
  category: CommitteeCategory;
  photoUrl?: string;
  focus: FocalPointDoc;
  featured: boolean;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SiteContactDoc {
  email?: string;
  phone?: string;
}

export interface SiteDetailsDoc {
  eventLabel?: string;
  tagline?: string;
  footerNote?: string;
  heroTitle?: string;
  contact?: SiteContactDoc;
  updatedAt?: string;
  updatedBy?: string;
}

export interface GallerySiteDoc {
  items: GalleryItemDoc[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface CommitteeSiteDoc {
  members: CommitteeMemberDoc[];
  updatedAt?: string;
  updatedBy?: string;
}

export type SiteContentDocId = "gallery" | "committee" | "details";

export interface MatchStateDoc {
  fixtureId: string;
  scoringModel: ScoringModel;
  version: number;
  data: Record<string, unknown>;
  result?: {
    winnerSlot: "A" | "B" | null;
    decidedBy: string;
    summary: string;
  };
}
