import type { MatchConfiguration } from "../matchConfig";
import type { BasketballConfig } from "./basketball-points";
import type { SetsPointsConfig } from "./sets-points";
import { DEFAULT_TENNIS_RULES, type TennisRules } from "./tennis-sets-games";

const FALLBACK_SETS_POINTS_CONFIG: Record<string, SetsPointsConfig> = {
  badminton: { bestOf: 3, pointsToWin: 21, capPoints: 30 },
  "table-tennis": { bestOf: 3, pointsToWin: 11 },
  volleyball: { bestOf: 3, pointsToWin: 25, setPoints: [25, 25, 15] },
};

export function basketballConfigFrom(mc?: MatchConfiguration | null): BasketballConfig {
  if (mc?.structure.kind === "PERIODS") return { quarters: mc.structure.periodCount, periodLabel: mc.structure.periodLabel };
  return { quarters: 4 };
}

export function setsPointsConfigFrom(mc: MatchConfiguration | null | undefined, sportId: string): SetsPointsConfig {
  if (mc?.structure.kind === "SETS_POINTS") {
    const s = mc.structure;
    return {
      bestOf: s.bestOf,
      pointsToWin: s.pointsToWin,
      ...(s.capPoints !== undefined ? { capPoints: s.capPoints } : {}),
      ...(s.setPointsBySetIndex ? { setPoints: s.setPointsBySetIndex } : {}),
      ...(s.decidingSetFormat ? { decidingSet: s.decidingSetFormat } : {}),
    };
  }
  return FALLBACK_SETS_POINTS_CONFIG[sportId] ?? { bestOf: 3, pointsToWin: 21, capPoints: 30 };
}

export function tennisBestOfSetsFrom(mc?: MatchConfiguration | null): number {
  if (mc?.structure.kind === "GAMES_SETS") return mc.structure.bestOfSets;
  return 3;
}

export function cricketOversFrom(mc?: MatchConfiguration | null): number {
  if (mc?.structure.kind === "INNINGS") return mc.structure.oversPerInnings;
  return 20;
}

export function cricketWicketsFrom(mc?: MatchConfiguration | null): number {
  if (mc?.structure.kind === "INNINGS") return mc.structure.wicketsPerInnings ?? 10;
  return 10;
}

export type { TennisRules };

export function tennisRulesFrom(mc?: MatchConfiguration | null): TennisRules {
  if (mc?.structure.kind === "GAMES_SETS") {
    const s = mc.structure;
    return {
      gamesPerSet: s.gamesPerSet,
      tieBreakAtGames: s.tieBreakAtGames,
      tieBreakPoints: s.tieBreakPoints,
      finalSetFormat: s.finalSetFormat,
      superTieBreakPoints: s.superTieBreakPoints,
      noAd: s.noAd,
    };
  }
  return DEFAULT_TENNIS_RULES;
}

export function penaltiesOnDrawFrom(mc?: MatchConfiguration | null): boolean {
  if (mc?.structure.kind === "EVENTS") return mc.structure.penaltiesOnDraw;
  return true;
}

export interface ResultOnlyRules {
  drawAllowed: boolean;
  tieBreak?: string;
  boards: boolean;
  bestOfBoards: number;
}

export function resultOnlyRulesFrom(mc: MatchConfiguration | null | undefined, sportId: string): ResultOnlyRules {
  if (mc?.structure.kind === "RESULT_ONLY") {
    const s = mc.structure;
    const boards = s.pointDetail === "SCORE_BREAKDOWN";
    return { drawAllowed: s.drawAllowed, tieBreak: s.tieBreak, boards, bestOfBoards: s.bestOfBoards ?? 3 };
  }
  if (sportId === "carrom") return { drawAllowed: false, boards: true, bestOfBoards: 3 };
  return { drawAllowed: sportId === "chess", boards: false, bestOfBoards: 3 };
}
