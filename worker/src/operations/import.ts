import { AppError } from "../errors";
import { AuthContext, requireSuperAdmin } from "../auth/authorize";
import { auditWrite } from "../audit";
import { chunk, type WriteOp } from "../firestore/client";
import { validateImport, emptyStore, ExistingStore, type ImportPreview } from "../../../shared/import-validator";
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

interface CommitImportInput {
  sports?: SportDoc[];
  competitions?: CompetitionDoc[];
  participants?: ParticipantDoc[];
  teams?: TeamDoc[];
  fixtures?: FixtureDoc[];
}

function stampNew<T extends { importBatchId?: string }>(row: T, isNew: boolean, importBatchId: string): T {
  const { importBatchId: _supplied, ...rest } = row;
  return (isNew ? { ...rest, importBatchId } : rest) as T;
}

export async function commitImport(ctx: AuthContext, input: unknown) {
  requireSuperAdmin(ctx);
  const payload = input as CommitImportInput;
  const transaction = await ctx.db.beginTransaction();
  const importBatchId = `import-${Date.now()}`;
  let preview: ImportPreview;
  try {
    const store = await loadExistingStore(ctx, input, transaction);
    preview = validateImport(input, store);
    if (!preview.ok) {
      throw new AppError(400, "IMPORT_HAS_ERRORS", "Import has validation errors");
    }
    const writes: WriteOp[] = [];

    const withoutUnchangedConfig = <T extends { matchConfiguration?: unknown }>(doc: T, exists: boolean): T => {
      if (!exists) return doc;
      const { matchConfiguration: _unchanged, ...rest } = doc;
      return rest as T;
    };
    for (const s of payload.sports ?? []) {
      const data = withoutUnchangedConfig(s, store.sports.has(s.sportId));
      writes.push({ collection: "sports", id: s.sportId, data, mergeFields: Object.keys(data) });
    }
    for (const c of payload.competitions ?? []) {
      const data = withoutUnchangedConfig(c, store.competitions.has(c.competitionId));
      writes.push({
        collection: "competitions",
        id: c.competitionId,
        data,
        mergeFields: Object.keys(data),
      });
    }
    for (const p of payload.participants ?? []) {
      const isNew = !store.participants.has(p.participantId);
      const data = stampNew(p, isNew, importBatchId);
      writes.push({
        collection: "participants",
        id: p.participantId,
        data,
        mergeFields: Object.keys(data),
        mustNotExist: isNew,
      });
    }
    for (const t of payload.teams ?? []) {
      const isNew = !store.teams.has(t.teamId);
      const data = stampNew(t, isNew, importBatchId);
      writes.push({
        collection: "teams",
        id: t.teamId,
        data,
        mergeFields: Object.keys(data),
        mustNotExist: isNew,
      });
    }

    const competitionOf = (competitionId: string) =>
      payload.competitions?.find((c) => c.competitionId === competitionId) ?? store.competitions.get(competitionId);
    const sportOf = (sportId: string) =>
      payload.sports?.find((s) => s.sportId === sportId) ?? store.sports.get(sportId);
    for (const f of payload.fixtures ?? []) {
      const prior = store.fixtures.get(f.fixtureId);
      if (prior && (prior.status === "LIVE" || prior.status === "COMPLETED" || prior.status === "POSTPONED" || prior.status === "CANCELLED")) continue;
      const competition = competitionOf(f.competitionId);
      const data: Record<string, unknown> = { ...stampNew(f, !prior, importBatchId) };
      if (competition && !prior?.sportId) data.sportId = competition.sportId;
      if (competition && !prior) {
        const config = competition.matchConfiguration ?? sportOf(competition.sportId)?.matchConfiguration;
        if (config) data.matchConfigurationSnapshot = config;
      }
      writes.push({
        collection: "fixtures",
        id: f.fixtureId,
        data,
        mergeFields: Object.keys(data),
        mustNotExist: !prior,
      });
    }

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
