import { describe, expect, it } from "vitest";
import { resolveOperation, operations } from "../src/operations/registry";

describe("operation registry", () => {
  it("exposes exactly the 39 canonical operations", () => {
    expect(operations.size).toBe(39);
    expect([...operations.keys()]).toEqual(
      expect.arrayContaining([
        "previewImport",
        "commitImport",
        "generateBracket",
        "publishBracket",
        "saveFixture",
        "startMatch",
        "updateLiveState",
        "completeMatch",
        "correctResult",
        "manageAdmin",
        "upsertEntity",
        "deleteEntity",
        "createAnnouncement",
        "deleteAnnouncement",
        "updateSportConfig",
        "updateCompetitionConfig",
        "withdrawEntrant",
        "postponeFixture",
        "resumeFixture",
        "cancelFixture",
        "previewPurge",
        "purgeCompetition",
        "deleteEntities",
        "withdrawEntrants",
        "galleryAdd",
        "galleryUpdate",
        "galleryDelete",
        "galleryReorder",
        "gallerySetVisibility",
        "committeeAdd",
        "committeeUpdate",
        "committeeDelete",
        "committeeReorder",
        "committeeSetVisibility",
        "committeeRemovePhoto",
        "detailsUpdate",
      ])
    );
  });

  it("resolves a known operation", () => {
    expect(resolveOperation("startMatch")).toBeTypeOf("function");
  });

  it("rejects unknown and dunder-like operation names", () => {
    expect(resolveOperation("doesNotExist")).toBeNull();
    expect(resolveOperation("__proto__")).toBeNull();
    expect(resolveOperation("constructor")).toBeNull();
    expect(resolveOperation("prototype")).toBeNull();
    expect(resolveOperation("toString")).toBeNull();
    expect(resolveOperation("")).toBeNull();
  });
});
