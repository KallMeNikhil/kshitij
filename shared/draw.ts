import { seedOrder } from "./bracket";

export function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWith<T>(rows: readonly T[], random: () => number): T[] {
  const result = [...rows];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function openingPairs(count: number): Array<[number, number]> {
  const order = seedOrder(nextPowerOfTwo(count));
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < order.length; i += 2) {
    const a = order[i] - 1;
    const b = order[i + 1] - 1;
    if (a < count && b < count) pairs.push([a, b]);
  }
  return pairs;
}

export function sameCollegeClashes<T>(rows: readonly T[], collegeOf: (row: T) => string): number {
  const norm = (row: T) => collegeOf(row).trim().toLowerCase();
  return openingPairs(rows.length).filter(([a, b]) => norm(rows[a]) !== "" && norm(rows[a]) === norm(rows[b])).length;
}

export function separateColleges<T>(rows: readonly T[], collegeOf: (row: T) => string): T[] {
  const result = [...rows];
  const pairs = openingPairs(result.length);
  let clashes = sameCollegeClashes(result, collegeOf);
  for (let pass = 0; pass < 3 && clashes > 0; pass++) {
    for (const [, b] of pairs) {
      for (const [, other] of pairs) {
        if (other === b) continue;
        [result[b], result[other]] = [result[other], result[b]];
        const next = sameCollegeClashes(result, collegeOf);
        if (next < clashes) {
          clashes = next;
          break;
        }
        [result[b], result[other]] = [result[other], result[b]];
      }
    }
  }
  return result;
}
