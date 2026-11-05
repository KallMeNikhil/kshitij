import type { FixtureDoc } from "../../shared/types";
import type { WriteOp } from "./firestore/client";

export function snapshotFixtures(fixtures: FixtureDoc[]): Map<string, FixtureDoc> {
  return new Map(fixtures.map((f) => [f.fixtureId, structuredClone(f)]));
}

export function changedFixtureWrites(before: Map<string, FixtureDoc>, after: FixtureDoc[]): WriteOp[] {
  const writes: WriteOp[] = [];
  for (const f of after) {
    const prior = before.get(f.fixtureId);
    if (!prior) continue;
    const keys = (Object.keys(f) as Array<keyof FixtureDoc>).filter(
      (k) => JSON.stringify(f[k]) !== JSON.stringify(prior[k])
    );
    if (keys.length === 0) continue;
    const data: Record<string, unknown> = {};
    for (const k of keys) data[k] = f[k];
    writes.push({ collection: "fixtures", id: f.fixtureId, data, mergeFields: keys as string[] });
  }
  return writes;
}
