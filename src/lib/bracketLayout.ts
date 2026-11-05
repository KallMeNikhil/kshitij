import type { FixtureDoc } from "../../shared/types";

export const MATCH_H = 120;
export const MATCH_GAP = 28;
export const COL_W = 264;
export const COL_GUTTER = 64;
export const HEAD_H = 36;

export interface Positioned {
  fixture: FixtureDoc;
  y: number;
}

export function layoutRounds(fixtures: FixtureDoc[], rounds: number[]): Map<number, Positioned[]> {
  const byRound = new Map<number, FixtureDoc[]>();
  for (const r of rounds) {
    byRound.set(
      r,
      fixtures.filter((f) => f.round === r).sort((x, y) => x.matchNumber - y.matchNumber)
    );
  }

  const layout = new Map<number, Positioned[]>();
  const yById = new Map<string, number>();

  rounds.forEach((r, ri) => {
    const list = byRound.get(r) ?? [];
    const positioned: Positioned[] = list.map((fixture, i) => {
      let y: number;
      if (ri === 0) {
        y = i * (MATCH_H + MATCH_GAP) + MATCH_H / 2;
      } else {
        const feeders = (byRound.get(rounds[ri - 1]) ?? []).filter((f) => f.nextFixtureId === fixture.fixtureId);
        if (feeders.length > 0) {
          const ys = feeders.map((f) => yById.get(f.fixtureId) ?? 0);
          y = ys.reduce((sum, v) => sum + v, 0) / ys.length;
        } else {
          y = i * (MATCH_H + MATCH_GAP) * Math.pow(2, ri) + MATCH_H / 2;
        }
      }
      yById.set(fixture.fixtureId, y);
      return { fixture, y };
    });
    layout.set(r, positioned);
  });

  return layout;
}

export function forwardChain(fixtures: FixtureDoc[], startId: string | null): Set<string> {
  const chain = new Set<string>();
  const byId = new Map(fixtures.map((f) => [f.fixtureId, f]));
  let cursor = startId ? byId.get(startId) : undefined;
  while (cursor) {
    chain.add(cursor.fixtureId);
    cursor = cursor.nextFixtureId ? byId.get(cursor.nextFixtureId) : undefined;
  }
  return chain;
}

