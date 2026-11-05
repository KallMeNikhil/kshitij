import { describe, expect, it } from "vitest";
import rules from "../firebase/firestore.rules?raw";

function block(name: string): string {
  const start = rules.indexOf(`match /${name}`);
  expect(start, `match /${name} exists`).toBeGreaterThan(-1);
  let depth = 0;

  const bodyStart = rules.indexOf("{", start + `match /${name}`.length);
  for (let i = bodyStart; i < rules.length; i++) {
    if (rules[i] === "{") depth++;
    if (rules[i] === "}" && --depth === 0) return rules.slice(start, i + 1);
  }
  throw new Error(`unterminated block ${name}`);
}

describe("firestore.rules static audit", () => {
  it("has no blanket `allow write` on protected domain collections", () => {
    for (const name of ["fixtures/{fixtureId}", "matchStates/{fixtureId}", "auditLogs/{logId}", "admins/{email}", "competitions/{competitionId}", "sports/{sportId}", "participants/{participantId}", "teams/{teamId}", "siteContent/{docId}"]) {
      expect(block(name), name).not.toMatch(/allow\s+write\b/);
    }
  });

  it("never allows a client to delete or edit audit logs, or to delete admins", () => {
    expect(block("auditLogs/{logId}")).toMatch(/allow update, delete: if false;/);
    expect(block("admins/{email}")).toMatch(/allow delete: if false;/);
  });

  it("only lets an admin write audit entries as themselves", () => {
    const b = block("auditLogs/{logId}");
    expect(b).toMatch(/actorEmail == request\.auth\.token\.email\.lower\(\)/);
    expect(b).toMatch(/hasOnly\(\[/);
  });

  it("freezes fixture identity and the configuration snapshot for every role", () => {
    const b = block("fixtures/{fixtureId}");

    const noComments = b.replace(/\/\/[^\n]*/g, "");
    expect(noComments).toMatch(
      /allow update: if \(isSuperAdmin\(\) && fixtureIsGenerationScaffolding\(\)\s*&& !\(request\.resource\.data\.status in \['POSTPONED', 'CANCELLED'\]\)\)\s*\|\|\s*\(fixtureImmutableFieldsUntouched\(\)\s*&& fixtureStatusChangeIsLegal\(\)\s*&& lifecycleChangeIsCoherent\(\)\s*&& \(!changed\(\)\.hasAny\(\['slotA', 'slotB'\]\) \|\| resource\.data\.status in \['DRAFT', 'SCHEDULED'\]\)\s*&& \(isSuperAdmin\(\)/
    );
    const scaffold = rules.slice(rules.indexOf("function fixtureIsGenerationScaffolding"), rules.indexOf("function fixtureStatusChangeIsLegal"));
    expect(scaffold).toMatch(/status == 'DRAFT'/);
    expect(scaffold).toMatch(/status == 'COMPLETED'\s*&& \(resource\.data\.slotA\.kind == 'BYE' \|\| resource\.data\.slotB\.kind == 'BYE'\)/);
    expect(scaffold).not.toMatch(/'LIVE'|'SCHEDULED'/);
    expect(rules).toMatch(/hasAny\(\['fixtureId', 'competitionId', 'matchConfigurationSnapshot'\]\)/);
    expect(rules).toMatch(/!changed\(\)\.hasAny\(\['sportId'\]\) \|\| !\('sportId' in resource\.data\)/);
  });

  it("restricts fixture status to the legal lifecycle and keeps COMPLETED and CANCELLED terminal", () => {
    expect(block("fixtures/{fixtureId}")).toMatch(/fixtureStatusChangeIsLegal\(\)/);
    const fn = rules.slice(rules.indexOf("function fixtureStatusChangeIsLegal"), rules.indexOf("function lifecycleReasonIsValid"));
    expect(fn).toMatch(/resource\.data\.status == 'LIVE' && request\.resource\.data\.status in \['COMPLETED', 'POSTPONED', 'CANCELLED'\]/);
    expect(fn).toMatch(/resource\.data\.status == 'POSTPONED' && request\.resource\.data\.status in \['SCHEDULED', 'LIVE', 'CANCELLED'\]/);
    expect(fn).not.toMatch(/(?<!request\.)resource\.data\.status == '(COMPLETED|CANCELLED)'/);
    expect(fn).not.toMatch(/resource\.data\.status == 'DRAFT' && request\.resource\.data\.status in \[[^\]]*'(POSTPONED|CANCELLED)'/);
  });

  it("mirrors the shared lifecycle matrix exactly", async () => {
    const { LEGAL_STATUS_TRANSITIONS } = await import("./fixtureLifecycle");
    const fn = rules.slice(rules.indexOf("function fixtureStatusChangeIsLegal"), rules.indexOf("function lifecycleReasonIsValid"));
    for (const [from, targets] of Object.entries(LEGAL_STATUS_TRANSITIONS)) {
      const clause = fn.match(new RegExp(`resource\\.data\\.status == '${from}' && request\\.resource\\.data\\.status (?:==|in) ([^|;)]*(?:\\][^|;)]*)?)`));
      if (targets.length === 0) {
        expect(clause, `${from} has no outgoing clause`).toBeNull();
        continue;
      }
      expect(clause, `${from} has an outgoing clause`).not.toBeNull();
      const named = [...(clause![1].match(/'[A-Z]+'/g) ?? [])].map((t) => t.replaceAll("'", "")).sort();
      expect(named, from).toEqual([...targets].sort());
    }
  });

  it("only changes statusReason and resumeStatus together with a lifecycle status change", () => {
    const fn = rules.slice(rules.indexOf("function lifecycleChangeIsCoherent"), rules.indexOf("function feederId"));
    expect(block("fixtures/{fixtureId}")).toMatch(/lifecycleChangeIsCoherent\(\)/);
    expect(fn).toMatch(/!changed\(\)\.hasAny\(\['statusReason', 'resumeStatus'\]\)/);
    expect(fn).toMatch(/request\.resource\.data\.get\('resumeStatus', ''\) == resource\.data\.status/);
    expect(fn).toMatch(/request\.resource\.data\.status == resource\.data\.get\('resumeStatus', 'SCHEDULED'\)/);
    expect(fn).toMatch(/!\('statusReason' in request\.resource\.data\)/);
    const reason = rules.slice(rules.indexOf("function lifecycleReasonIsValid"), rules.indexOf("function lifecycleChangeIsCoherent"));
    expect(reason).toMatch(/size\(\) > 0/);
    expect(reason).toMatch(/size\(\) <= 300/);
  });

  it("limits coordinators to schedule/status/lifecycle/slot fields, not publishing, and only on unfinished fixtures", () => {
    const fn = rules.slice(rules.indexOf("function coordinatorFixtureUpdateIsLegal"), rules.indexOf("match /fixtures/"));
    expect(fn).toMatch(/hasOnly\(\['status', 'statusReason', 'resumeStatus', 'slotA', 'slotB', 'scheduledDate', 'scheduledTime', 'venue', 'displaySummary'\]\)/);
    expect(fn).not.toMatch(/matchConfigurationSnapshot|sportId|competitionId/);
    expect(fn).toMatch(/resource\.data\.status in \['DRAFT', 'SCHEDULED'\]/);
    expect(fn).toMatch(/resource\.data\.status == 'LIVE' && changed\(\)\.hasOnly\(\['status', 'statusReason', 'resumeStatus'\]\)/);
    expect(fn).toMatch(/resource\.data\.status == 'POSTPONED' && changed\(\)\.hasOnly\(\['status', 'statusReason', 'resumeStatus', 'scheduledDate', 'scheduledTime', 'venue'\]\)/);
    expect(fn).not.toMatch(/resource\.data\.status in \[[^\]]*'(COMPLETED|CANCELLED)'/);
    expect(fn).toMatch(/!\(resource\.data\.status == 'DRAFT' && request\.resource\.data\.status == 'SCHEDULED'\)/);
  });

  it("coordinators can neither cancel a fixture nor complete one without a result recorded in the same batch", () => {
    const status = rules.slice(rules.indexOf("function coordinatorResultIsRecorded"), rules.indexOf("function coordinatorFixtureUpdateIsLegal"));
    expect(status).toMatch(/request\.resource\.data\.status != 'CANCELLED'/);
    expect(status).toMatch(/resource\.data\.status == 'LIVE' && coordinatorResultIsRecorded\(resource\.data\.fixtureId\)/);
    expect(status).toMatch(/existsAfter\(/);
    expect(status).toMatch(/getAfter\(.*matchStates.*\.data\.result\.winnerSlot in \['A', 'B'\]/);
    expect(rules.slice(rules.indexOf("function coordinatorFixtureUpdateIsLegal"), rules.indexOf("match /fixtures/"))).toMatch(/&& coordinatorStatusChangeIsAllowed\(\)/);
  });

  it("only a Super Admin may write a result or penalties outside the batch that completes a LIVE fixture", () => {
    const gate = rules.slice(rules.indexOf("function coordinatorMayWriteResult"), rules.indexOf("match /matchStates/"));
    expect(gate).toMatch(/fixtureOf\(fixtureId\)\.status == 'LIVE'/);
    expect(gate).toMatch(/getAfter\(.*fixtures.*\.data\.status == 'COMPLETED'/);
    const b = block("matchStates/{fixtureId}");
    expect(b).toMatch(/isSuperAdmin\(\) \|\| !request\.resource\.data\.keys\(\)\.hasAny\(\['result', 'penalties'\]\) \|\| coordinatorMayWriteResult\(fixtureId\)/);
    expect(b).toMatch(/isSuperAdmin\(\) \|\| !changed\(\)\.hasAny\(\['result', 'penalties'\]\) \|\| coordinatorMayWriteResult\(fixtureId\)/);
  });

  it("keeps a single Super Admin: admins can only be created as coordinators and roles never change", () => {
    const b = block("admins/{email}");
    expect(b).toMatch(/allow create: if isSuperAdmin\(\)\s*&& adminShapeIsLegal\(email\)\s*&& request\.resource\.data\.role == 'SPORT_COORDINATOR';/);
    expect(b).toMatch(/request\.resource\.data\.role == resource\.data\.role/);
    expect(b).toMatch(/resource\.data\.role == 'SPORT_COORDINATOR' \|\| request\.resource\.data\.active == true/);
  });

  it("coordinator access requires the SPORT_COORDINATOR role and sport scope", () => {
    const fn = rules.slice(rules.indexOf("function isSportCoordinatorFor"), rules.indexOf("function changed"));
    expect(fn).toMatch(/role == 'SPORT_COORDINATOR'/);
    expect(fn).toMatch(/sportId in adminDoc\(\)\.sportIds/);
  });

  it("versions match states, restricts their fields, and keeps overrides Super-Admin-only", () => {
    const b = block("matchStates/{fixtureId}");
    expect(b).toMatch(/version == 1/);
    expect(b).toMatch(/version == resource\.data\.version \+ 1/);
    expect(b).toMatch(/allow delete: if false;/);
    expect(rules).toMatch(/hasOnly\(\['fixtureId', 'scoringModel', 'version', 'data', 'result', 'penalties'\]\)/);
    expect(rules).toMatch(/'WALKOVER', 'ADMIN_OVERRIDE'/);
    expect(b).toMatch(/fixtureOf\(fixtureId\)\.status == 'LIVE'/);
  });

  it("requires a configVersion bump for any matchConfiguration change on sports and competitions", () => {
    expect(block("sports/{sportId}")).toMatch(/configChangeIsVersioned\(\)/);
    expect(block("competitions/{competitionId}")).toMatch(/configChangeIsVersioned\(\)/);
  });

  it("prevents un-publishing and creating pre-published competitions", () => {
    const b = block("competitions/{competitionId}");
    expect(b).toMatch(/get\('published', false\) == false/);
    expect(b).toMatch(/resource\.data\.get\('published', false\) == false && request\.resource\.data\.published == true/);
  });

  it("only allows entrants to move ACTIVE -> WITHDRAWN", () => {
    expect(block("participants/{participantId}")).toMatch(/entrantStatusIsLegal\(\)/);
    expect(block("teams/{teamId}")).toMatch(/entrantStatusIsLegal\(\)/);
    const fn = rules.slice(rules.indexOf("function entrantStatusIsLegal"), rules.indexOf("match /sports/"));
    expect(fn).toMatch(/== 'ACTIVE' && request\.resource\.data\.status == 'WITHDRAWN'/);
  });

  it("keeps config and admin management Super-Admin-only", () => {
    for (const name of ["sports/{sportId}", "competitions/{competitionId}", "admins/{email}", "announcements/{announcementId}", "siteContent/{docId}"]) {
      const b = block(name);
      const writes = b.match(/allow (create|update|write|delete)[^;]*;/g) ?? [];
      const nonAdminRead = writes.filter((w) => !w.includes("isSuperAdmin()") && !w.includes("if false"));
      expect(nonAdminRead, name).toEqual([]);
    }
  });

  it("limits a coordinator's slot changes to the feeder fixture's actual winner", () => {
    const fn = rules.slice(rules.indexOf("function feederId"), rules.indexOf("match /fixtures/"));

    expect(fn).toMatch(/side == 'A' \? 2 \* request\.resource\.data\.matchNumber - 1 : 2 \* request\.resource\.data\.matchNumber/);
    expect(fn).toMatch(/'-r' \+ string\(request\.resource\.data\.round - 1\)/);

    expect(fn).toMatch(/nextFixtureId == request\.resource\.data\.fixtureId/);
    expect(fn).toMatch(/nextSlot == side/);
    expect(fn).toMatch(/getAfter\(\/databases\/\$\(database\)\/documents\/matchStates\/\$\(feederId\(side\)\)\)\.data\.result\.winnerSlot/);

    const coord = fn.slice(fn.indexOf("function coordinatorFixtureUpdateIsLegal"));
    expect(coord).toMatch(/&& coordinatorSlotsAreLegal\(\)/);
    expect(fn).toMatch(/request\.resource\.data\.round > 1 && slotIsFeederWinner\('A'\)/);
    expect(fn).toMatch(/request\.resource\.data\.round > 1 && slotIsFeederWinner\('B'\)/);
  });

  it("only lets a Super Admin create a match state for a SCHEDULED fixture, and only as a WALKOVER", () => {
    const create = block("matchStates/{fixtureId}").match(/allow create:[\s\S]*?;\n/)![0];
    expect(create).toMatch(/isSuperAdmin\(\)\s*&& fixtureOf\(fixtureId\)\.status == 'SCHEDULED'\s*&& request\.resource\.data\.get\('result', \{\}\)\.get\('decidedBy', ''\) == 'WALKOVER'/);
    expect(block("matchStates/{fixtureId}").match(/allow update:[\s\S]*?;\n/)![0]).not.toMatch(/SCHEDULED/);
  });

  it("only generation scaffolding fixtures can be deleted; played history and recorded results cannot", () => {
    const b = block("fixtures/{fixtureId}");
    expect(b).toMatch(/allow delete: if isSuperAdmin\(\) && fixtureIsGenerationScaffolding\(\);/);
    expect(b).not.toMatch(/allow create, delete/);
    expect(block("matchStates/{fixtureId}")).toMatch(/allow delete: if false;/);
  });

  it("makes site content publicly readable, Super-Admin-only to write, shape-checked, and never deletable", () => {
    const b = block("siteContent/{docId}");
    expect(b).toMatch(/allow read: if true;/);
    expect(b).toMatch(/allow create, update: if isSuperAdmin\(\) && siteContentShapeIsLegal\(docId\);/);
    expect(b).toMatch(/allow delete: if false;/);
    const fn = rules.slice(rules.indexOf("function siteContentShapeIsLegal"), rules.indexOf("match /siteContent/"));
    expect(fn).toMatch(/docId == 'gallery'/);
    expect(fn).toMatch(/hasOnly\(\['items', 'updatedAt', 'updatedBy'\]\)/);
    expect(fn).toMatch(/items\.size\(\) <= 200/);
    expect(fn).toMatch(/docId == 'committee'/);
    expect(fn).toMatch(/hasOnly\(\['members', 'updatedAt', 'updatedBy'\]\)/);
    expect(fn).toMatch(/members\.size\(\) <= 100/);
    expect(fn).toMatch(/docId == 'details'/);
    expect(fn).toMatch(/hasOnly\(\['eventLabel', 'tagline', 'footerNote', 'heroTitle', 'contact', 'updatedAt', 'updatedBy'\]\)/);
    expect(fn).toMatch(/!\('contact' in request\.resource\.data\) \|\| request\.resource\.data\.contact is map/);
  });
});
