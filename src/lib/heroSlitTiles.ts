export type LayerKind = "far" | "mid" | "near";

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface TileSpec {
  loop: number;
  dur: number;
  seed: number;
  fwhm: [number, number];
  space: number;
  jitter: number;
  alpha: [number, number];
  smSpace: number;
  smWidth: number;
}

const SPECS: Record<LayerKind, TileSpec> = {
  far: { loop: 1920, dur: 64, seed: 7311, fwhm: [6, 11], space: 34, jitter: 0.2, alpha: [0.8, 1], smSpace: 1.9, smWidth: 1.7 },
  mid: { loop: 1680, dur: 24, seed: 4093, fwhm: [20, 34], space: 150, jitter: 0.2, alpha: [0.8, 1], smSpace: 1.15, smWidth: 1.5 },
  near: { loop: 2400, dur: 16, seed: 9157, fwhm: [70, 110], space: 330, jitter: 0.18, alpha: [0.8, 1], smSpace: 0.75, smWidth: 1.2 },
};

const TOKENS: Record<string, [string, Rgba]> = {
  far: ["--hero-slit-far", { r: 70, g: 120, b: 220, a: 0.3 }],
  mid: ["--hero-slit-mid", { r: 60, g: 150, b: 240, a: 0.42 }],
  near: ["--hero-slit-near", { r: 76, g: 194, b: 255, a: 0.34 }],
  farFlash: ["--hero-slit-far-flash", { r: 110, g: 170, b: 255, a: 0.5 }],
  midFlash: ["--hero-slit-mid-flash", { r: 100, g: 200, b: 255, a: 0.6 }],
  nearFlash: ["--hero-slit-near-flash", { r: 120, g: 225, b: 255, a: 0.5 }],
};

function parseColor(raw: string, fallback: Rgba): Rgba {
  const m = raw.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%?))?/i);
  if (!m) return fallback;
  const a = m[4] === undefined ? 1 : m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { r: parseFloat(m[1]), g: parseFloat(m[2]), b: parseFloat(m[3]), a };
}

function readColor(name: string): Rgba {
  const [token, fallback] = TOKENS[name];
  if (typeof document === "undefined") return fallback;
  return parseColor(getComputedStyle(document.documentElement).getPropertyValue(token), fallback);
}

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (v: number) => v.toFixed(3);
const SIGMA = 1 / 2.3548;

function buildTile(spec: TileSpec, color: Rgba, small: boolean): string {
  const rand = seeded(small ? spec.seed + 101 : spec.seed);
  const spaceScale = small ? spec.smSpace : 1;
  const widthScale = small ? spec.smWidth : 1;
  const count = Math.max(2, Math.round(spec.loop / (spec.space * spaceScale)));
  const steps = Array.from({ length: count }, () => 1 + (rand() * 2 - 1) * spec.jitter);
  const sum = steps.reduce((a, c) => a + c, 0);
  const rgb = `rgb(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)})`;
  const stops = Array.from({ length: 13 }, (_, i) => {
    const t = i / 12;
    const u = (t - 0.5) * 3;
    const v = Math.exp(-0.5 * (u / SIGMA) ** 2);
    return `<stop offset="${n(t)}" stop-color="${rgb}" stop-opacity="${n(v * color.a)}"/>`;
  }).join("");
  const shapes: string[] = [];
  let c = rand() * (spec.loop / count);
  for (let i = 0; i < count; i += 1) {
    const fwhm = (spec.fwhm[0] + rand() * (spec.fwhm[1] - spec.fwhm[0])) * widthScale;
    const w = fwhm * 3;
    const alpha = spec.alpha[0] + rand() * (spec.alpha[1] - spec.alpha[0]);
    const x = c - w / 2;
    const draw = (px: number) => shapes.push(`<rect x="${n(px)}" width="${n(w)}" height="8" fill="url(#b)" opacity="${n(alpha)}"/>`);
    draw(x);
    if (x < 0) draw(x + spec.loop);
    if (x + w > spec.loop) draw(x - spec.loop);
    c += (steps[i] / sum) * spec.loop;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.loop}" height="8" viewBox="0 0 ${spec.loop} 8"><defs><linearGradient id="b">${stops}</linearGradient></defs>${shapes.join("")}</svg>`;
}

function toUrl(svg: string, made: string[]): string {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function" && typeof Blob !== "undefined") {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    made.push(url);
    return `url("${url}")`;
  }
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export const SLIT_BASE_VARS: Record<string, string> = {
  "--slit-far-loop": `${SPECS.far.loop}px`,
  "--slit-far-dur": `${SPECS.far.dur}s`,
  "--slit-mid-loop": `${SPECS.mid.loop}px`,
  "--slit-mid-dur": `${SPECS.mid.dur}s`,
  "--slit-near-loop": `${SPECS.near.loop}px`,
  "--slit-near-dur": `${SPECS.near.dur}s`,
};

export function createSlitTileVars(): { vars: Record<string, string>; release: () => void } {
  const made: string[] = [];
  const vars: Record<string, string> = { ...SLIT_BASE_VARS };
  (["far", "mid", "near"] as const).forEach((kind) => {
    const spec = SPECS[kind];
    const base = readColor(kind);
    const flash = readColor(`${kind}Flash`);
    vars[`--slit-${kind}-tile`] = toUrl(buildTile(spec, base, false), made);
    vars[`--slit-${kind}-tile-sm`] = toUrl(buildTile(spec, base, true), made);
    vars[`--slit-${kind}-flash`] = toUrl(buildTile(spec, flash, false), made);
    vars[`--slit-${kind}-flash-sm`] = toUrl(buildTile(spec, flash, true), made);
  });
  return {
    vars,
    release: () => made.forEach((u) => URL.revokeObjectURL(u)),
  };
}
