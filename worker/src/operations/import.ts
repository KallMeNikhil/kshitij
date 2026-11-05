import { AppError } from "../errors";
import { AuthContext, requireSuperAdmin } from "../auth/authorize";
import { auditWrite } from "../audit";
import { chunk, type WriteOp } from "../firestore/client";
import { analyzeImport, importedTopology, validateImport, emptyStore, ExistingStore, type ImportPreview } from "../../../shared/import-validator";
import { normalizePhone, slug } from "../../../shared/ids";
import type {
  SportDoc,
  CompetitionDoc,
  ParticipantDoc,
  TeamDoc,
  FixtureDoc,
} from "../../../shared/types";

const SCOPE_FILTER_SIZE = 10;

export function importCompetitionScope(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const doc = input as Record<string, unknown>;
  const ids = new Set<string>();
  for (const key of ["competitions", "participants", "teams", "fixtures"]) {
    const rows = doc[key];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const id = row && typeof row === "object" ? (row as Record<string, unknown>).competitionId : undefined;
      if (typeof id === "string") ids.add(id);
    }
  }
  return [...ids];
}

async function loadExistingStore(ctx: AuthContext, input: unknown, transaction?: string): Promise<ExistingStore> {
  const store = emptyStore();
  const scope = chunk(importCompetitionScope(input), SCOPE_FILTER_SIZE);
  const scoped = async <T>(collection: string) => {
    const groups = await Promise.all(
      scope.map((ids) => ctx.db.runQuery<T>(collection, [{ field: "competitionId", op: "IN", value: ids }], transaction))
    );
    return groups.flat();
  };
  const [sports, competitions, participants, teams, fixtures] = await Promise.all([
    ctx.db.runQuery<SportDoc>("sports", [], transaction),
    ctx.db.runQuery<CompetitionDoc>("competitions", [], transaction),
    scoped<ParticipantDoc>("participants"),
    scoped<TeamDoc>("teams"),
    scoped<FixtureDoc>("fixtures"),
  ]);
  sports.forEach((d) => store.sports.set(d.id, d.data));
  competitions.forEach((d) => store.competitions.set(d.id, d.data));
  participants.forEach((d) => store.participants.set(d.id, d.data));
  teams.forEach((d) => store.teams.set(d.id, d.data));
  fixtures.forEach((d) => store.fixtures.set(d.id, d.data));
  return store;
}

export async function previewImport(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const store = await loadExistingStore(ctx, input);
  return validateImport(input, store);
}

type Row = Record<string, unknown>;

function rowsOf(input: unknown, key: string): Row[] {
  const rows = (input as Record<string, unknown> | null)?.[key];
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

function supplied(parsed: Row, raw: Row | undefined, isNew: boolean): Row {
  if (isNew || !raw) return { ...parsed };
  return Object.fromEntries(Object.keys(raw).filter((k) => k in parsed).map((k) => [k, parsed[k]]));
}

function withoutBatch(row: Row): Row {
  const { importBatchId: _supplied, ...rest } = row;
  return rest;
}

const phoneOf = (value: unknown) => (typeof value === "string" && value.length > 0 ? normalizePhone(value) : value);

export async function commitImport(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const transaction = await ctx.db.beginTransaction();
  const importBatchId = `import-${Date.now()}`;
  let preview: ImportPreview;
  try {
    const store = await loadExistingStore(ctx, input, transaction);
    const analysis = analyzeImport(input, store);
    preview = analysis.preview;
    if (!preview.ok || !analysis.doc) {
      throw new AppError(400, "IMPORT_HAS_ERRORS", "Import has validation errors");
    }
    const doc = analysis.doc;
    const writes: WriteOp[] = [];
    const push = (collection: string, id: string, data: Row, mustNotExist = false) =>
      writes.push({ collection, id, data, mergeFields: Object.keys(data), mustNotExist });

    (doc.sports ?? []).forEach((sport, i) => {
      const exists = store.sports.has(sport.sportId);
      const data = supplied(sport as Row, rowsOf(input, "sports")[i], !exists);
      if (exists) delete data.matchConfiguration;
      if (!exists && !data.slug) data.slug = slug(String(data.name ?? sport.sportId));
      push("sports", sport.sportId, data);
    });
    (doc.competitions ?? []).forEach((competition, i) => {
      const exists = store.competitions.has(competition.competitionId);
      const data = supplied(competition as Row, rowsOf(input, "competitions")[i], !exists);
      if (exists) delete data.matchConfiguration;
      push("competitions", competition.competitionId, data);
    });
    (doc.participants ?? []).forEach((participant, i) => {
      const isNew = !store.participants.has(participant.participantId);
      const data = withoutBatch(supplied(participant as Row, rowsOf(input, "participants")[i], isNew));
      if ("phone" in data) data.phone = phoneOf(data.phone);
      push("participants", participant.participantId, isNew ? { ...data, importBatchId } : data, isNew);
    });
    (doc.teams ?? []).forEach((team, i) => {
      const isNew = !store.teams.has(team.teamId);
      const data = withoutBatch(supplied(team as Row, rowsOf(input, "teams")[i], isNew));
      if ("captainPhone" in data) data.captainPhone = phoneOf(data.captainPhone);
      push("teams", team.teamId, isNew ? { ...data, importBatchId } : data, isNew);
    });

    const competitionOf = (competitionId: string) =>
      doc.competitions?.find((c) => c.competitionId === competitionId) ?? store.competitions.get(competitionId);
    const sportOf = (sportId: string) => doc.sports?.find((s) => s.sportId === sportId) ?? store.sports.get(sportId);
    const fixtures = doc.fixtures ?? [];
    const byCompetition = new Map<string, typeof fixtures>();
    for (const f of fixtures) byCompetition.set(f.competitionId, [...(byCompetition.get(f.competitionId) ?? []), f]);
    const links = new Map<string, { nextFixtureId: string | null; nextSlot: "A" | "B" | null }>();
    for (const [competitionId, rows] of byCompetition) {
      const existing = [...store.fixtures.values()].filter((f) => f.competitionId === competitionId);
      for (const [id, link] of importedTopology(rows, existing)) links.set(id, link);
    }

    fixtures.forEach((f, i) => {
      const prior = store.fixtures.get(f.fixtureId);
      if (prior && ["LIVE", "COMPLETED", "POSTPONED", "CANCELLED"].includes(prior.status)) return;
      const competition = competitionOf(f.competitionId);
      const data = withoutBatch(supplied(f as Row, rowsOf(input, "fixtures")[i], !prior));
      Object.assign(data, links.get(f.fixtureId));
      if (competition && !prior?.sportId) data.sportId = competition.sportId;
      if (competition && !prior) {
        const config = competition.matchConfiguration ?? sportOf(competition.sportId)?.matchConfiguration;
        if (config) data.matchConfigurationSnapshot = config;
      }
      push("fixtures", f.fixtureId, prior ? data : { ...data, importBatchId }, !prior);
    });

    try {
      await ctx.db.commitChunked(transaction, writes, {
        trailer: (index, total) =>
          auditWrite({
            action: "commitImport",
            actorEmail: ctx.email,
            actorRole: ctx.admin.role,
            targetType: "import",
            targetId: importBatchId,
            after: { ...preview.counts, batch: index + 1, batches: total },
          }),
      });
    } catch (err) {
      if (err instanceof AppError && err.code === "ABORTED") {
        throw new AppError(
          409,
          "IMPORT_CONFLICT",
          "The import conflicted with existing data or a change made at the same time. Preview it again, then retry."
        );
      }
      throw err;
    }
  } catch (err) {
    await ctx.db.rollback(transaction);
    throw err;
  }

  return { ...preview, importBatchId };
}
