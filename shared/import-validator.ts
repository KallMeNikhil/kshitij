import { isGenerationOnlyFixture } from "./bracket";
import { expectedNext, feederFixtureIds, validateBracketInvariants } from "./bracketInvariants";
import { canonicalImportSchema, CanonicalImport } from "./schemas";
import { normalizePhone, slug } from "./ids";
import type { SportDoc, CompetitionDoc, ParticipantDoc, TeamDoc, FixtureDoc } from "./types";

export interface ImportIssue {
  code: string;
  message: string;
  path: string;
  severity: "error" | "warning";
}

export interface ExistingStore {
  sports: Map<string, SportDoc>;
  competitions: Map<string, CompetitionDoc>;
  participants: Map<string, ParticipantDoc>;
  teams: Map<string, TeamDoc>;
  fixtures: Map<string, FixtureDoc>;
}

export function emptyStore(): ExistingStore {
  return {
    sports: new Map(),
    competitions: new Map(),
    participants: new Map(),
    teams: new Map(),
    fixtures: new Map(),
  };
}

export interface ImportPreview {
  issues: ImportIssue[];
  counts: {
    newParticipants: number;
    updatedParticipants: number;
    unchangedParticipants: number;
    newTeams: number;
    updatedTeams: number;
    unchangedTeams: number;
    newSports: number;
    newCompetitions: number;
    updatedCompetitions: number;
    newFixtures: number;
    updatedFixtures: number;
    skippedProtectedFixtures: number;
  };
  ok: boolean;
}

function sameFields(prior: object, next: object): boolean {
  const keys = Object.keys(next as Record<string, unknown>);
  const pick = (v: object) => Object.fromEntries(keys.map((k) => [k, (v as Record<string, unknown>)[k]]));
  return stableStringify(pick(prior)) === stableStringify(pick(next));
}

const IMPORTED_FIXTURE_FIELDS = ["round", "matchNumber", "slotA", "slotB", "scheduledDate", "scheduledTime", "venue"] as const;

function sameImportedFixture(prior: FixtureDoc, next: Record<string, unknown>): boolean {
  const pick = (v: Record<string, unknown>) => Object.fromEntries(IMPORTED_FIXTURE_FIELDS.map((k) => [k, v[k]]));
  return stableStringify(pick(prior as unknown as Record<string, unknown>)) === stableStringify(pick(next));
}

export function importedTopology(
  fixtures: Array<Pick<FixtureDoc, "fixtureId" | "competitionId" | "round" | "matchNumber">>,
  existing: Iterable<Pick<FixtureDoc, "fixtureId">>
): Map<string, { nextFixtureId: string | null; nextSlot: "A" | "B" | null }> {
  const known = new Set<string>([...existing].map((f) => f.fixtureId));
  for (const f of fixtures) known.add(f.fixtureId);
  const out = new Map<string, { nextFixtureId: string | null; nextSlot: "A" | "B" | null }>();
  for (const f of fixtures) {
    const next = expectedNext(f);
    out.set(f.fixtureId, known.has(next.fixtureId) ? { nextFixtureId: next.fixtureId, nextSlot: next.slot } : { nextFixtureId: null, nextSlot: null });
  }
  return out;
}

export function teamRosterSizeIssue(
  competition: CompetitionDoc,
  rosterSize: number
): Omit<ImportIssue, "path"> | null {
  const mc = competition.matchConfiguration;
  const min = mc?.participantModel.teamSize?.min ?? competition.teamSize?.min;
  const maxStarters = mc?.participantModel.teamSize?.max ?? competition.teamSize?.max;
  const substitutesAllowed = mc?.participantModel.substitutesAllowed ?? 0;
  if (min === undefined && maxStarters === undefined) return null;

  if (min !== undefined && rosterSize < min) {
    return {
      code: "TEAM_ROSTER_BELOW_MINIMUM",
      message: `roster has ${rosterSize} member(s); competition requires at least ${min}`,
      severity: "error",
    };
  }
  if (maxStarters !== undefined && rosterSize > maxStarters + substitutesAllowed) {
    return {
      code: "TEAM_ROSTER_EXCEEDS_MAXIMUM",
      message: `roster has ${rosterSize} member(s); competition allows at most ${
        maxStarters + substitutesAllowed
      } (${maxStarters} starters + ${substitutesAllowed} substitute(s))`,
      severity: "error",
    };
  }
  return null;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameConfiguration(a: unknown, b: unknown): boolean {
  const strip = (v: unknown) =>
    v && typeof v === "object" ? { ...(v as Record<string, unknown>), configVersion: undefined } : v;
  return stableStringify(strip(a)) === stableStringify(strip(b));
}

function checkProtectedImportFields(raw: unknown, existing: ExistingStore, issues: ImportIssue[]): void {
  const doc = raw as Record<string, Array<Record<string, unknown>> | undefined>;
  const push = (code: string, message: string, path: string) =>
    issues.push({ code, message, path, severity: "error" });

  (doc.sports ?? []).forEach((s, i) => {
    const prior = existing.sports.get(s.sportId as string);
    if (prior && s.matchConfiguration !== undefined && !sameConfiguration(prior.matchConfiguration, s.matchConfiguration)) {
      push("IMPORT_USE_DEDICATED_CONFIG_OPERATION", `${s.sportId}: change matchConfiguration with updateSportConfig`, `sports[${i}].matchConfiguration`);
    }
  });

  (doc.competitions ?? []).forEach((c, i) => {
    const prior = existing.competitions.get(c.competitionId as string);
    if (prior && c.matchConfiguration !== undefined && !sameConfiguration(prior.matchConfiguration, c.matchConfiguration)) {
      push("IMPORT_USE_DEDICATED_CONFIG_OPERATION", `${c.competitionId}: change matchConfiguration with updateCompetitionConfig`, `competitions[${i}].matchConfiguration`);
    }
    if (c.published !== undefined && c.published !== (prior?.published ?? false)) {
      push("IMPORT_USE_DEDICATED_PUBLISH_OPERATION", `${c.competitionId}: use publishBracket`, `competitions[${i}].published`);
    }
  });

  for (const [key, priorMap] of [["participants", existing.participants], ["teams", existing.teams]] as const) {
    (doc[key] ?? []).forEach((e, i) => {
      const id = (key === "participants" ? e.participantId : e.teamId) as string;
      const prior = (priorMap as Map<string, { status?: string }>).get(id);
      if (e.status !== undefined && e.status !== (prior?.status ?? "ACTIVE")) {
        push("IMPORT_USE_WITHDRAWAL_OPERATION", `${id}: entrant status is changed with withdrawEntrant`, `${key}[${i}].status`);
      }
    });
  }
}

type EntrantInfo = { competitionId: string; sportId: string; status?: string };

function checkImportFixtures(doc: CanonicalImport, raw: unknown, existing: ExistingStore, issues: ImportIssue[]): void {
  const fixtures = doc.fixtures ?? [];
  if (fixtures.length === 0) return;
  const rawFixtures = (raw as { fixtures?: Array<Record<string, unknown>> }).fixtures ?? [];
  const push = (code: string, message: string, path: string) => issues.push({ code, message, path, severity: "error" });

  const competitions = new Map<string, { participantType: string; sportId: string }>();
  for (const c of existing.competitions.values()) competitions.set(c.competitionId, c);
  for (const c of doc.competitions ?? []) competitions.set(c.competitionId, c);

  const rawEntrants = raw as { participants?: Array<Record<string, unknown>>; teams?: Array<Record<string, unknown>> };
  const participants = new Map<string, EntrantInfo>();
  for (const p of existing.participants.values()) participants.set(p.participantId, p);
  (doc.participants ?? []).forEach((p, i) => {
    const prior = existing.participants.get(p.participantId);
    const stated = rawEntrants.participants?.[i]?.status as string | undefined;
    participants.set(p.participantId, { ...p, status: stated ?? prior?.status });
  });
  const teams = new Map<string, EntrantInfo>();
  for (const t of existing.teams.values()) teams.set(t.teamId, t);
  (doc.teams ?? []).forEach((t, i) => {
    const prior = existing.teams.get(t.teamId);
    const stated = rawEntrants.teams?.[i]?.status as string | undefined;
    teams.set(t.teamId, { ...t, status: stated ?? prior?.status });
  });

  fixtures.forEach((f, i) => {
    const path = `fixtures[${i}]`;
    const competition = competitions.get(f.competitionId);
    if (!competition) {
      push("UNKNOWN_COMPETITION", `${f.fixtureId}: competition ${f.competitionId} not found`, path);
      return;
    }
    const prior = existing.fixtures.get(f.fixtureId);
    const rawStatus = rawFixtures[i]?.status;
    if (rawStatus !== undefined && rawStatus !== (prior?.status ?? "DRAFT")) {
      push("IMPORT_USE_DEDICATED_PUBLISH_OPERATION", `${f.fixtureId}: fixture status is changed by publishBracket / the match operations, not import`, `${path}.status`);
    }

    for (const side of ["A", "B"] as const) {
      const slot = side === "A" ? f.slotA : f.slotB;
      const slotPath = `${path}.slot${side}`;
      if (slot.kind === "FIXTURE_WINNER") {
        const feeder = feederFixtureIds(f)?.[side];
        if (!feeder || slot.fromFixtureId !== feeder) {
          push("FIXTURE_WINNER_SLOT_INVALID", `${f.fixtureId}: slot ${side} ${feeder ? `must follow ${feeder}` : "cannot follow a fixture in round 1"}`, slotPath);
        }
        continue;
      }
      if (slot.kind !== "PARTICIPANT" && slot.kind !== "TEAM") continue;
      const wantKind = competition.participantType === "INDIVIDUAL" ? "PARTICIPANT" : "TEAM";
      if (slot.kind !== wantKind) {
        push("FIXTURE_SLOT_KIND_MISMATCH", `${f.fixtureId}: a ${competition.participantType} competition seats ${wantKind} entrants, not ${slot.kind}`, slotPath);
        continue;
      }
      const id = slot.kind === "PARTICIPANT" ? slot.participantId : slot.teamId;
      const entrant = id ? (slot.kind === "PARTICIPANT" ? participants : teams).get(id) : undefined;
      if (!entrant) {
        push("FIXTURE_ENTRANT_NOT_FOUND", `${f.fixtureId}: entrant ${id} does not exist`, slotPath);
      } else if (entrant.competitionId !== f.competitionId || entrant.sportId !== competition.sportId) {
        push("FIXTURE_ENTRANT_OUT_OF_SCOPE", `${f.fixtureId}: entrant ${id} does not belong to ${f.competitionId}`, slotPath);
      } else if (entrant.status === "WITHDRAWN") {
        push("FIXTURE_ENTRANT_WITHDRAWN", `${f.fixtureId}: entrant ${id} has withdrawn and cannot be seated in a fixture`, slotPath);
      }
    }
  });

  const touched = new Set(fixtures.map((f) => f.competitionId));
  for (const competitionId of touched) {
    const current = [...existing.fixtures.values()].filter((f) => f.competitionId === competitionId);
    const merged = new Map(current.map((f) => [f.fixtureId, f]));
    const imported = fixtures.filter((x) => x.competitionId === competitionId);
    const topology = importedTopology(imported, current);
    for (const f of imported) {
      const prior = merged.get(f.fixtureId);
      const links = topology.get(f.fixtureId)!;
      merged.set(
        f.fixtureId,
        prior
          ? { ...prior, round: f.round, matchNumber: f.matchNumber, slotA: f.slotA, slotB: f.slotB, ...links }
          : {
              fixtureId: f.fixtureId, competitionId, sportId: competitions.get(competitionId)?.sportId ?? "",
              round: f.round, matchNumber: f.matchNumber, slotA: f.slotA, slotB: f.slotB,
              status: "DRAFT", ...links,
            }
      );
    }
    const known = new Set(validateBracketInvariants(current).map((i) => `${i.code}|${i.fixtureId}|${i.message}`));
    for (const issue of validateBracketInvariants([...merged.values()])) {
      if (!known.has(`${issue.code}|${issue.fixtureId}|${issue.message}`)) {
        push("IMPORT_BREAKS_BRACKET_STRUCTURE", `${issue.fixtureId}: ${issue.message}`, "fixtures");
      }
    }
  }
}

export function validateImport(raw: unknown, existing: ExistingStore): ImportPreview {
  return analyzeImport(raw, existing).preview;
}

export function analyzeImport(raw: unknown, existing: ExistingStore): { preview: ImportPreview; doc: CanonicalImport | null } {
  const issues: ImportIssue[] = [];
  const counts: ImportPreview["counts"] = {
    newParticipants: 0,
    updatedParticipants: 0,
    unchangedParticipants: 0,
    newTeams: 0,
    updatedTeams: 0,
    unchangedTeams: 0,
    newSports: 0,
    newCompetitions: 0,
    updatedCompetitions: 0,
    newFixtures: 0,
    updatedFixtures: 0,
    skippedProtectedFixtures: 0,
  };

  const parsed = canonicalImportSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const code = issue.code === "custom" ? issue.message : String(issue.code).toUpperCase();
      issues.push({
        code,
        message: issue.message,
        path: issue.path.join("."),
        severity: "error",
      });
    }
    return { preview: { issues, counts, ok: false }, doc: null };
  }

  const doc: CanonicalImport = parsed.data;

  checkProtectedImportFields(raw, existing, issues);
  checkImportFixtures(doc, raw, existing, issues);

  const sportIds = new Set<string>([...existing.sports.keys(), ...(doc.sports ?? []).map((s) => s.sportId)]);
  const competitionIds = new Set<string>([
    ...existing.competitions.keys(),
    ...(doc.competitions ?? []).map((c) => c.competitionId),
  ]);

  (doc.sports ?? []).forEach((s) => {
    const isNew = !existing.sports.has(s.sportId);
    if (isNew) counts.newSports++;
  });

  const competitionParticipantType = new Map<string, string>();
  for (const [id, c] of existing.competitions) competitionParticipantType.set(id, c.participantType);
  for (const c of doc.competitions ?? []) competitionParticipantType.set(c.competitionId, c.participantType);

  const competitionById = new Map<string, CompetitionDoc>();
  for (const [id, c] of existing.competitions) competitionById.set(id, c);
  for (const c of doc.competitions ?? []) competitionById.set(c.competitionId, c as CompetitionDoc);

  (doc.competitions ?? []).forEach((c, i) => {
    const path = `competitions[${i}]`;
    if (!sportIds.has(c.sportId)) {
      issues.push({ code: "UNKNOWN_SPORT", message: `sportId ${c.sportId} not found`, path, severity: "error" });
    }
    const prior = existing.competitions.get(c.competitionId);
    if (!prior) counts.newCompetitions++;
    else if (!sameFields(prior, c)) counts.updatedCompetitions++;
  });

  const seenPhoneByCompetition = new Map<string, Set<string>>();
  const participantById = new Map<string, ParticipantDoc>();
  for (const [id, p] of existing.participants) participantById.set(id, p);

  const importedParticipantIds = new Set((doc.participants ?? []).map((p) => p.participantId));
  for (const stored of existing.participants.values()) {
    if (importedParticipantIds.has(stored.participantId)) continue;
    try {
      const bucket = seenPhoneByCompetition.get(stored.competitionId) ?? new Set<string>();
      bucket.add(normalizePhone(stored.phone));
      seenPhoneByCompetition.set(stored.competitionId, bucket);
    } catch {
      continue;
    }
  }

  (doc.participants ?? []).forEach((p, i) => {
    const path = `participants[${i}]`;
    if (!competitionIds.has(p.competitionId)) {
      issues.push({ code: "UNKNOWN_COMPETITION", message: `competitionId ${p.competitionId} not found`, path, severity: "error" });
      return;
    }
    let normalized: string;
    try {
      normalized = normalizePhone(p.phone);
    } catch {
      issues.push({ code: "INVALID_PHONE", message: p.phone, path: `${path}.phone`, severity: "error" });
      return;
    }
    const key = `${p.competitionId}:${normalized}`;
    const bucket = seenPhoneByCompetition.get(p.competitionId) ?? new Set<string>();
    if (bucket.has(normalized)) {
      issues.push({ code: "DUPLICATE_PARTICIPANT", message: key, path, severity: "error" });
    }
    bucket.add(normalized);
    seenPhoneByCompetition.set(p.competitionId, bucket);

    const prior = existing.participants.get(p.participantId);
    if (!prior) counts.newParticipants++;
    else if (!sameFields(prior, { ...p, phone: normalized })) counts.updatedParticipants++;
    else counts.unchangedParticipants++;

    participantById.set(p.participantId, { ...p, phone: normalized });
  });

  const teamSlugByCompetition = new Map<string, Set<string>>();
  const participantTeamMembership = new Map<string, string>();

  const importedTeamIds = new Set((doc.teams ?? []).map((t) => t.teamId));
  for (const stored of existing.teams.values()) {
    if (importedTeamIds.has(stored.teamId)) continue;
    if (stored.teamName) {
      const bucket = teamSlugByCompetition.get(stored.competitionId) ?? new Set<string>();
      bucket.add(slug(stored.teamName));
      teamSlugByCompetition.set(stored.competitionId, bucket);
    }
    for (const memberId of stored.memberIds) participantTeamMembership.set(memberId, stored.teamId);
  }

  (doc.teams ?? []).forEach((t, i) => {
    const path = `teams[${i}]`;
    if (!competitionIds.has(t.competitionId)) {
      issues.push({ code: "UNKNOWN_COMPETITION", message: t.competitionId, path, severity: "error" });
      return;
    }
    const pType = competitionParticipantType.get(t.competitionId);
    if (pType !== "PAIR" && pType !== "TEAM") {
      issues.push({ code: "INVALID_COMPETITION_FOR_TEAM", message: t.competitionId, path, severity: "error" });
    }
    if (pType === "PAIR" && t.memberIds.length !== 2) {
      issues.push({ code: "PAIR_REQUIRES_EXACTLY_TWO_MEMBERS", message: String(t.memberIds.length), path, severity: "error" });
    }
    const competitionForRosterCheck = competitionById.get(t.competitionId);
    if (competitionForRosterCheck) {
      const rosterIssue = teamRosterSizeIssue(competitionForRosterCheck, t.memberIds.length);
      if (rosterIssue) issues.push({ ...rosterIssue, path });
    }
    for (const memberId of t.memberIds) {
      const member = participantById.get(memberId);
      if (!member) {
        issues.push({ code: "UNKNOWN_PARTICIPANT", message: memberId, path: `${path}.memberIds`, severity: "error" });
        continue;
      }
      if (member.competitionId !== t.competitionId) {
        issues.push({ code: "MEMBER_COMPETITION_MISMATCH", message: memberId, path: `${path}.memberIds`, severity: "error" });
      }
      if (participantTeamMembership.has(memberId)) {
        issues.push({ code: "PARTICIPANT_ALREADY_ON_TEAM", message: memberId, path: `${path}.memberIds`, severity: "error" });
      }
      participantTeamMembership.set(memberId, t.teamId);
    }
    if (t.teamName) {
      const teamSlug = slug(t.teamName);
      const bucket = teamSlugByCompetition.get(t.competitionId) ?? new Set<string>();
      if (bucket.has(teamSlug)) {
        issues.push({ code: "DUPLICATE_TEAM", message: `${t.competitionId}:${teamSlug}`, path, severity: "error" });
      }
      bucket.add(teamSlug);
      teamSlugByCompetition.set(t.competitionId, bucket);
    }

    const prior = existing.teams.get(t.teamId);
    if (!prior) counts.newTeams++;
    else if (!sameFields(prior, t)) counts.updatedTeams++;
    else counts.unchangedTeams++;
  });

  const fixturesByCompetition = new Map<string, FixtureDoc[]>();
  for (const f of existing.fixtures.values()) {
    const bucket = fixturesByCompetition.get(f.competitionId) ?? [];
    bucket.push(f);
    fixturesByCompetition.set(f.competitionId, bucket);
  }

  const importedByCompetition = new Map<string, number>();
  (doc.fixtures ?? []).forEach((f) => {
    importedByCompetition.set(f.competitionId, (importedByCompetition.get(f.competitionId) ?? 0) + 1);
  });

  for (const competitionId of importedByCompetition.keys()) {
    const existingForComp = fixturesByCompetition.get(competitionId) ?? [];
    const hasNonDraft = existingForComp.some((f) => !isGenerationOnlyFixture(f));
    const existingById = new Map(existingForComp.map((f) => [f.fixtureId, f]));
    const changesFixtures = (doc.fixtures ?? []).some((f) => {
      if (f.competitionId !== competitionId) return false;
      const prior = existingById.get(f.fixtureId);
      return !prior || !sameImportedFixture(prior, f);
    });
    if (existingForComp.length > 0 && hasNonDraft && changesFixtures) {
      issues.push({
        code: "COMPETITION_FIXTURES_NOT_REPLACEABLE",
        message: `${competitionId} has non-DRAFT fixtures; import for this competition rejected`,
        path: "fixtures",
        severity: "error",
      });
    }
  }

  (doc.fixtures ?? []).forEach((f, i) => {
    const path = `fixtures[${i}]`;
    const prior = existing.fixtures.get(f.fixtureId);
    if (prior && (prior.status === "LIVE" || prior.status === "COMPLETED" || prior.status === "POSTPONED" || prior.status === "CANCELLED")) {
      if (!sameImportedFixture(prior, f)) {
        issues.push({ code: "FIXTURE_PROTECTED", message: f.fixtureId, path, severity: "error" });
      } else {
        counts.skippedProtectedFixtures++;
      }
      return;
    }
    if (!prior) counts.newFixtures++;
    else if (!sameImportedFixture(prior, f)) counts.updatedFixtures++;
  });

  const ok = issues.every((iss) => iss.severity !== "error");
  return { preview: { issues, counts, ok }, doc };
}

export function formatImportSummary(preview: ImportPreview): string {
  const c = preview.counts;
  return [
    `New participants: ${c.newParticipants}        Updated participants: ${c.updatedParticipants}      Unchanged participants: ${c.unchangedParticipants}`,
    `New teams: ${c.newTeams}               Updated teams: ${c.updatedTeams}             Unchanged teams: ${c.unchangedTeams}`,
    `New sports: ${c.newSports}              New competitions: ${c.newCompetitions}             Updated competitions: ${c.updatedCompetitions}`,
    `New fixtures: ${c.newFixtures}            Updated fixtures: ${c.updatedFixtures}           Skipped/protected fixtures: ${c.skippedProtectedFixtures}`,
    `Errors: ${preview.issues.filter((i) => i.severity === "error").length}                  Warnings: ${preview.issues.filter((i) => i.severity === "warning").length}`,
  ].join("\n");
}
