import { callApi } from "./apiClient";
import type { CanonicalImport } from "../../shared/schemas";
import type { ImportPreview } from "../../shared/import-validator";
import type { CommitteeMemberDoc, GalleryItemDoc } from "../../shared/types";
import type { CommitteeCategory } from "../../shared/media";

export function previewImport(payload: unknown) {
  return callApi<ImportPreview>("previewImport", payload);
}

export function commitImport(payload: CanonicalImport) {
  return callApi<ImportPreview & { importBatchId: string }>("commitImport", payload);
}

export interface PurgePreview {
  competitionId: string;
  importBatchId: string | null;
  counts: { fixtures: number; teams: number; participants: number };
  blockers: Array<{ code: string; message: string }>;
  canPurge: boolean;
  backup: Record<string, unknown>;
}

export function previewPurge(input: { competitionId: string; importBatchId?: string }) {
  return callApi<PurgePreview>("previewPurge", input);
}

export function purgeCompetition(input: { competitionId: string; importBatchId?: string; confirm: string }) {
  return callApi<{ deleted: { fixtures: number; teams: number; participants: number }; remaining: number }>("purgeCompetition", input);
}

export interface BulkOutcome {
  id: string;
  code: string;
  message: string;
}

export function deleteEntities(input: { collection: "teams" | "participants"; competitionId: string; ids: string[] }) {
  return callApi<{ deleted: string[]; blocked: BulkOutcome[] }>("deleteEntities", input);
}

export function withdrawEntrants(input: { collection: "teams" | "participants"; competitionId: string; ids: string[]; reason: string }) {
  return callApi<{ withdrawn: string[]; skipped: BulkOutcome[]; affectedFixtureIds: string[] }>("withdrawEntrants", input);
}

export function generateBracket(input: { competitionId: string; entrantIds?: string[] }) {
  return callApi<{ fixtureCount: number; drawSeed?: number }>("generateBracket", input);
}

export function publishBracket(input: { competitionId: string }) {
  return callApi<{ published: boolean }>("publishBracket", input);
}

export function saveFixture(input: {
  fixtureId: string;
  scheduledDate?: string;
  scheduledTime?: string;
  venue?: string;
}) {
  return callApi<{ ok: boolean }>("saveFixture", input);
}

export function startMatch(input: { fixtureId: string }) {
  return callApi<{ ok: boolean }>("startMatch", input);
}

export function updateLiveState(input: {
  fixtureId: string;
  expectedVersion: number;
  data: Record<string, unknown>;
}) {
  return callApi<{ ok: boolean }>("updateLiveState", input);
}

export function undoLiveState(input: { fixtureId: string; expectedVersion: number }) {
  return callApi<{ ok: boolean }>("undoLiveState", input);
}

export function completeMatch(input: {
  fixtureId: string;
  winnerSlot: "A" | "B";
  decidedBy: string;
  resultSummary: string;
  reason?: string;
  penalties?: { a: number; b: number };
}) {
  return callApi<{ ok: boolean }>("completeMatch", input);
}

export function reopenMatch(input: { fixtureId: string; reason: string }) {
  return callApi<{ ok: boolean }>("reopenMatch", input);
}

export function reinstateFixture(input: { fixtureId: string; reason: string; scheduledDate?: string; scheduledTime?: string; venue?: string }) {
  return callApi<{ ok: boolean; status: string }>("reinstateFixture", input);
}

export function correctResult(input: { fixtureId: string; winnerSlot: "A" | "B"; reason: string }) {
  return callApi<{ ok: boolean }>("correctResult", input);
}

export function manageAdmin(input: {
  email: string;
  displayName?: string;
  role: "SUPER_ADMIN" | "SPORT_COORDINATOR";
  sportIds?: string[];
  active: boolean;
}) {
  return callApi<{ ok: boolean }>("manageAdmin", input);
}

export function upsertEntity(input: { collection: string; id: string; data: Record<string, unknown> }) {
  return callApi<{ ok: boolean }>("upsertEntity", input);
}

export function deleteEntity(input: { collection: string; id: string }) {
  return callApi<{ ok: boolean }>("deleteEntity", input);
}

export function updateSportConfig(input: { sportId: string; matchConfiguration: unknown }) {
  return callApi<{ ok: boolean; matchConfiguration: unknown }>("updateSportConfig", input);
}

export function updateCompetitionConfig(input: {
  competitionId: string;
  matchConfiguration: unknown;
  acknowledgeExistingFixtures?: boolean;
}) {
  return callApi<{ ok: boolean; matchConfiguration: unknown }>("updateCompetitionConfig", input);
}

export function withdrawEntrant(input: { collection: "teams" | "participants"; id: string; reason: string }) {
  return callApi<{ ok: boolean; affectedFixtureIds: string[] }>("withdrawEntrant", input);
}

export function postponeFixture(input: { fixtureId: string; reason: string }) {
  return callApi<{ ok: boolean; status: string }>("postponeFixture", input);
}

export function cancelFixture(input: { fixtureId: string; reason: string }) {
  return callApi<{ ok: boolean; status: string }>("cancelFixture", input);
}

export function resumeFixture(input: { fixtureId: string; scheduledDate?: string; scheduledTime?: string; venue?: string }) {
  return callApi<{ ok: boolean; status: string }>("resumeFixture", input);
}

export function deleteAnnouncement(input: { id: string }) {
  return callApi<{ id: string }>("deleteAnnouncement", input);
}

export function createAnnouncement(input: { title: string; body: string; sportId?: string }) {
  return callApi<{ id: string }>("createAnnouncement", input);
}

export interface FocusInput {
  x: number;
  y: number;
}

export function galleryAdd(input: {
  imageUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  focus?: FocusInput;
  visible?: boolean;
}) {
  return callApi<{ item: GalleryItemDoc }>("galleryAdd", input);
}

export function galleryUpdate(input: {
  id: string;
  focus?: FocusInput;
  imageUrl?: string;
  thumbUrl?: string;
  width?: number;
  height?: number;
}) {
  return callApi<{ item: GalleryItemDoc }>("galleryUpdate", input);
}

export function galleryDelete(input: { ids: string[] }) {
  return callApi<{ deleted: string[] }>("galleryDelete", input);
}

export function galleryReorder(input: { ids: string[] }) {
  return callApi<{ ok: boolean }>("galleryReorder", input);
}

export function gallerySetVisibility(input: { ids: string[]; visible: boolean }) {
  return callApi<{ updated: string[] }>("gallerySetVisibility", input);
}

export function committeeAdd(input: {
  name: string;
  role: string;
  category?: CommitteeCategory;
  photoUrl?: string;
  focus?: FocusInput;
  featured?: boolean;
  visible?: boolean;
}) {
  return callApi<{ member: CommitteeMemberDoc }>("committeeAdd", input);
}

export function committeeUpdate(input: {
  id: string;
  name?: string;
  role?: string;
  category?: CommitteeCategory;
  photoUrl?: string;
  focus?: FocusInput;
  featured?: boolean;
}) {
  return callApi<{ member: CommitteeMemberDoc }>("committeeUpdate", input);
}

export function committeeDelete(input: { ids: string[] }) {
  return callApi<{ deleted: string[] }>("committeeDelete", input);
}

export function committeeReorder(input: { ids: string[] }) {
  return callApi<{ ok: boolean }>("committeeReorder", input);
}

export function committeeSetVisibility(input: { ids: string[]; visible: boolean }) {
  return callApi<{ updated: string[] }>("committeeSetVisibility", input);
}

export function committeeRemovePhoto(input: { id: string }) {
  return callApi<{ member: CommitteeMemberDoc }>("committeeRemovePhoto", input);
}

export function detailsUpdate(input: {
  eventLabel?: string;
  tagline?: string;
  footerNote?: string;
  heroTitle?: string;
  contact?: { email?: string; phone?: string };
}) {
  return callApi<{ ok: boolean }>("detailsUpdate", input);
}
