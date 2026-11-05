import { AppError } from "../errors";
import {
  FirestoreDocument,
  FirestoreValue,
  decodeDocument,
  decodeFields,
  encodeFields,
} from "./values";

export interface WriteOp {
  collection: string;
  id: string;
  data?: object;
  mergeFields?: string[];
  delete?: boolean;
  mustNotExist?: boolean;
}

export interface QueryFilter {
  field: string;
  op: string;
  value: unknown;
}

export const COMMIT_CHUNK_SIZE = 400;
export const MAX_COMMIT_CHUNKS = 25;

export interface ChunkedCommitOptions {
  chunkSize?: number;
  maxChunks?: number;
  verifyQueries?: boolean;
  trailer?: (index: number, total: number) => WriteOp;
}

export function chunk<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

interface StructuredQueryFilter {
  fieldFilter?: { field: { fieldPath: string }; op: string; value: FirestoreValue };
  compositeFilter?: { op: "AND"; filters: StructuredQueryFilter[] };
}

interface TrackedQuery {
  collection: string;
  filters: QueryFilter[];
  signature: string;
}

interface TransactionReads {
  documents: Map<string, string | null>;
  collections: Set<string>;
  queries: TrackedQuery[];
}

interface QueryRow<T> {
  id: string;
  data: T;
  updateTime?: string;
}

function signatureOf(rows: Array<{ id: string; updateTime?: string }>): string {
  return rows
    .map((r) => `${r.id}@${r.updateTime ?? ""}`)
    .sort()
    .join("|");
}

export class FirestoreRestClient {
  private baseUrl: string;
  private documentsName: string;
  private idToken: string;
  private transactions = new Map<string, TransactionReads>();
  private transactionCounter = 0;

  constructor(projectId: string, idToken: string, emulatorHost?: string) {
    const origin = emulatorHost ? `http://${emulatorHost}` : "https://firestore.googleapis.com";
    this.documentsName = `projects/${projectId}/databases/(default)/documents`;
    this.baseUrl = `${origin}/v1/${this.documentsName}`;
    this.idToken = idToken;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.idToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    return res;
  }

  private async requestRoot(path: string, init: RequestInit = {}): Promise<Response> {
    const rootUrl = this.baseUrl.slice(0, this.baseUrl.lastIndexOf("/documents"));
    const res = await fetch(`${rootUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.idToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    return res;
  }

  async beginTransaction(): Promise<string> {
    const transaction = `local-${++this.transactionCounter}`;
    this.transactions.set(transaction, { documents: new Map(), collections: new Set(), queries: [] });
    return transaction;
  }

  async rollback(transaction: string): Promise<void> {
    this.transactions.delete(transaction);
  }

  async getDocument<T>(collection: string, id: string, transaction?: string): Promise<T | null> {
    const res = await this.request(`/${collection}/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      this.transactionReads(transaction)?.documents.set(`${collection}/${id}`, null);
      return null;
    }
    if (!res.ok) {
      await throwFirestoreError(res, { phase: "getDocument", collection });
    }
    const doc = (await res.json()) as FirestoreDocument;
    if (doc.updateTime) this.transactionReads(transaction)?.documents.set(`${collection}/${id}`, doc.updateTime);
    return decodeDocument<T>(doc);
  }

  private async queryRows<T>(
    collection: string,
    filters: QueryFilter[],
    context: Record<string, unknown>
  ): Promise<Array<QueryRow<T>>> {
    const structuredFilters: StructuredQueryFilter[] = filters.map((f) => ({
      fieldFilter: {
        field: { fieldPath: f.field },
        op: f.op,
        value: encodeFilterValue(f.value),
      },
    }));

    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId: collection }],
    };
    if (structuredFilters.length === 1) {
      structuredQuery.where = structuredFilters[0];
    } else if (structuredFilters.length > 1) {
      structuredQuery.where = { compositeFilter: { op: "AND", filters: structuredFilters } };
    }

    const res = await this.request(":runQuery", { method: "POST", body: JSON.stringify({ structuredQuery }) });
    if (!res.ok) {
      await throwFirestoreError(res, { phase: "runQuery", collection, ...context });
    }
    const rows = (await res.json()) as Array<{ document?: FirestoreDocument }>;
    const out: Array<QueryRow<T>> = [];
    for (const row of rows) {
      if (!row.document) continue;
      const id = row.document.name!.split("/").pop()!;
      out.push({ id, data: decodeFields(row.document.fields) as T, updateTime: row.document.updateTime });
    }
    return out;
  }

  async runQuery<T>(
    collection: string,
    filters: QueryFilter[],
    transaction?: string
  ): Promise<Array<{ id: string; data: T }>> {
    const rows = await this.queryRows<T>(collection, filters, { inTransaction: Boolean(transaction) });
    const reads = this.transactionReads(transaction);
    if (reads) {
      if (filters.length === 0) reads.collections.add(collection);
      else reads.queries.push({ collection, filters, signature: signatureOf(rows) });
      for (const row of rows) {
        if (row.updateTime) reads.documents.set(`${collection}/${row.id}`, row.updateTime);
      }
    }
    return rows.map((r) => ({ id: r.id, data: r.data }));
  }

  private async verifyQueries(reads: TransactionReads): Promise<void> {
    for (const query of reads.queries) {
      const rows = await this.queryRows(query.collection, query.filters, { inRecheck: true });
      if (signatureOf(rows) !== query.signature) {
        throw new AppError(409, "ABORTED", "Concurrent update, please retry", {
          phase: "verifyQueries",
          collection: query.collection,
        });
      }
    }
  }

  async commit(transaction: string, writes: WriteOp[], options: { verifyQueries?: boolean } = {}): Promise<void> {
    const reads = this.transactionReads(transaction);
    if (!reads) {
      throw new AppError(500, "INTERNAL", "Unknown transaction", { phase: "commit", transaction });
    }
    if (writes.length > 500) {
      this.transactions.delete(transaction);
      throw new AppError(413, "OPERATION_TOO_LARGE", "Too many writes for one atomic commit", {
        phase: "commit",
        writeCounts: countWrites(writes),
      });
    }
    if (options.verifyQueries) {
      try {
        await this.verifyQueries(reads);
      } catch (err) {
        this.transactions.delete(transaction);
        throw err;
      }
    }
    const body = {
      writes: writes.map((w) => toFirestoreWrite(this.documentsName, w, writePrecondition(reads, w))),
    };
    const res = await this.requestRoot("/documents:commit", {
      method: "POST",
      body: JSON.stringify(body),
    });
    this.transactions.delete(transaction);
    if (!res.ok) {
      await throwFirestoreError(res, { phase: "commit", writeCounts: countWrites(writes) });
    }
  }

  async commitChunked(transaction: string, writes: WriteOp[], options: ChunkedCommitOptions = {}): Promise<number> {
    const reads = this.transactionReads(transaction);
    if (!reads) {
      throw new AppError(500, "INTERNAL", "Unknown transaction", { phase: "commitChunked", transaction });
    }
    const size = options.chunkSize ?? COMMIT_CHUNK_SIZE;
    const groups = writes.length === 0 ? [[]] : chunk(writes, size);
    const total = groups.length;
    try {
      if (total > (options.maxChunks ?? MAX_COMMIT_CHUNKS)) {
        throw new AppError(
          413,
          "OPERATION_TOO_LARGE",
          `This needs ${total} batches, more than one request can safely save. Split the work into smaller parts.`,
          { phase: "commitChunked", writeCounts: countWrites(writes) }
        );
      }
      if (options.verifyQueries) await this.verifyQueries(reads);

      let saved = 0;
      for (let i = 0; i < total; i++) {
        const batch = options.trailer ? [...groups[i], options.trailer(i, total)] : groups[i];
        const body = {
          writes: batch.map((w) => toFirestoreWrite(this.documentsName, w, writePrecondition(reads, w))),
        };
        const res = await this.requestRoot("/documents:commit", { method: "POST", body: JSON.stringify(body) });
        if (!res.ok) {
          try {
            await throwFirestoreError(res, {
              phase: "commitChunked",
              batch: i + 1,
              batches: total,
              savedBatches: saved,
              writeCounts: countWrites(batch),
            });
          } catch (err) {
            if (saved > 0 && err instanceof AppError) {
              throw new AppError(
                err.status,
                "PARTIAL_COMMIT",
                `${saved} of ${total} batches were saved before this failed (${err.message}). Run the same operation again to finish.`,
                err.diagnostics
              );
            }
            throw err;
          }
        }
        saved++;
      }
      return total;
    } finally {
      this.transactions.delete(transaction);
    }
  }

  private transactionReads(transaction?: string): TransactionReads | undefined {
    return transaction ? this.transactions.get(transaction) : undefined;
  }
}

function writePrecondition(reads: TransactionReads, w: WriteOp): Record<string, unknown> | undefined {
  if (w.mustNotExist) return { exists: false };
  const seen = reads.documents.get(`${w.collection}/${w.id}`);
  if (seen) return { updateTime: seen };
  if (w.delete) return undefined;
  if (seen === null || reads.collections.has(w.collection)) return { exists: false };
  return undefined;
}

function countWrites(writes: WriteOp[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const w of writes) counts[w.collection] = (counts[w.collection] ?? 0) + 1;
  return counts;
}

function toFirestoreWrite(
  documentsName: string,
  w: WriteOp,
  currentDocument?: Record<string, unknown>
): Record<string, unknown> {
  const name = `${documentsName}/${w.collection}/${w.id}`;
  const write: Record<string, unknown> = w.delete
    ? { delete: name }
    : { update: { name, fields: encodeFields((w.data ?? {}) as Record<string, unknown>) } };
  if (!w.delete && w.mergeFields) {
    write.updateMask = { fieldPaths: w.mergeFields };
  }
  if (currentDocument) write.currentDocument = currentDocument;
  return write;
}

function encodeFilterValue(value: unknown): FirestoreValue {
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFilterValue) } };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  throw new Error("UNSUPPORTED_FILTER_VALUE");
}

async function throwFirestoreError(res: Response, context: Record<string, unknown>): Promise<never> {
  let status = "";
  let message = "";
  try {
    const body = (await res.json()) as { error?: { status?: string; message?: string } };
    status = body.error?.status ?? "";
    message = (body.error?.message ?? "").slice(0, 300);
  } catch {
    status = "";
  }
  const diagnostics = { ...context, httpStatus: res.status, firestoreStatus: status, firestoreMessage: message };
  const detail = status || message;
  if (res.status === 403 || detail === "PERMISSION_DENIED") {
    throw new AppError(403, "FORBIDDEN", "Firestore denied the request", diagnostics);
  }
  if (res.status === 404) {
    throw new AppError(404, "NOT_FOUND", "Document not found", diagnostics);
  }
  if (res.status === 409 || detail === "ABORTED" || (detail === "FAILED_PRECONDITION" && context.phase === "commit")) {
    throw new AppError(409, "ABORTED", "Concurrent update, please retry", diagnostics);
  }
  throw new AppError(500, "INTERNAL", "Firestore request failed", diagnostics);
}
