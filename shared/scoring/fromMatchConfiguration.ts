import type { MatchConfiguration } from "../matchConfig";
import type { BasketballConfig } from "./basketball-points";
import type { SetsPointsConfig } from "./sets-points";
import type { TennisRules } from "./tennis-sets-games";

const LEGACY_SETS_POINTS_CONFIG: Record<string, SetsPointsConfig> = {
  badminton: { bestOf: 3, pointsToWin: 21, capPoints: 30 },
  "table-tennis": { bestOf: 5, pointsToWin: 11, capPoints: 21 },
  volleyball: { bestOf: 3, pointsToWin: 25, capPoints: 30 },
};

export function basketballConfigFrom(mc?: MatchConfiguration | null): BasketballConfig {
  if (mc?.structure.kind === "PERIODS") return { quarters: mc.structure.periodCount, periodLabel: mc.structure.periodLabel };
  return { quarters: 4 };
}

export function setsPointsConfigFrom(mc: MatchConfiguration | null | undefined, sportId: string): SetsPointsConfig {
  if (mc?.structure.kind === "SETS_POINTS") {
    return {
      bestOf: mc.structure.bestOf,
      pointsToWin: mc.structure.pointsToWin,
      capPoints: mc.structure.capPoints ?? mc.structure.pointsToWin + 9,
    };
  }
  return LEGACY_SETS_POINTS_CONFIG[sportId] ?? { bestOf: 3, pointsToWin: 21, capPoints: 30 };
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
    return {
      gamesPerSet: mc.structure.gamesPerSet,
      tieBreakAtGames: mc.structure.tieBreakAtGames,
      tieBreakPoints: mc.structure.tieBreakPoints,
    };
  }
  return { gamesPerSet: 6 };
}
