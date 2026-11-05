import { AuthContext } from "../auth/authorize";
import { previewImport, commitImport } from "./import";
import { generateBracket, publishBracket } from "./bracket";
import { saveFixture, startMatch, updateLiveState } from "./match";
import { completeMatch, correctResult } from "./result";
import { manageAdmin, upsertEntity, deleteEntity, createAnnouncement, deleteAnnouncement } from "./admin";
import { updateSportConfig, updateCompetitionConfig } from "./config";
import { withdrawEntrant } from "./entrant";
import { postponeFixture, resumeFixture, cancelFixture } from "./lifecycle";
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
} from "./siteContent";
import { previewPurge, purgeCompetition, deleteEntities, withdrawEntrants } from "./purge";

export type OperationHandler = (ctx: AuthContext, input: unknown) => Promise<unknown>;

export const operations: ReadonlyMap<string, OperationHandler> = new Map<string, OperationHandler>([
  ["previewImport", previewImport],
  ["commitImport", commitImport],
  ["generateBracket", generateBracket],
  ["publishBracket", publishBracket],
  ["saveFixture", saveFixture],
  ["startMatch", startMatch],
  ["updateLiveState", updateLiveState],
  ["completeMatch", completeMatch],
  ["correctResult", correctResult],
  ["manageAdmin", manageAdmin],
  ["upsertEntity", upsertEntity],
  ["deleteEntity", deleteEntity],
  ["createAnnouncement", createAnnouncement],
  ["deleteAnnouncement", deleteAnnouncement],
  ["updateSportConfig", updateSportConfig],
  ["updateCompetitionConfig", updateCompetitionConfig],
  ["withdrawEntrant", withdrawEntrant],
  ["postponeFixture", postponeFixture],
  ["resumeFixture", resumeFixture],
  ["cancelFixture", cancelFixture],
  ["previewPurge", previewPurge],
  ["purgeCompetition", purgeCompetition],
  ["deleteEntities", deleteEntities],
  ["withdrawEntrants", withdrawEntrants],
  ["galleryAdd", galleryAdd],
  ["galleryUpdate", galleryUpdate],
  ["galleryDelete", galleryDelete],
  ["galleryReorder", galleryReorder],
  ["gallerySetVisibility", gallerySetVisibility],
  ["committeeAdd", committeeAdd],
  ["committeeUpdate", committeeUpdate],
  ["committeeDelete", committeeDelete],
  ["committeeReorder", committeeReorder],
  ["committeeSetVisibility", committeeSetVisibility],
  ["committeeRemovePhoto", committeeRemovePhoto],
  ["detailsUpdate", detailsUpdate],
]);

export function resolveOperation(name: string): OperationHandler | null {
  if (typeof name !== "string" || name.length === 0) return null;
  return operations.has(name) ? operations.get(name)! : null;
}
