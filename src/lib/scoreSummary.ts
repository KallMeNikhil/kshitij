import type { MatchStateDoc, ScoringModel } from "../../shared/types";
import { setsSummary, type SetsPointsState } from "../../shared/scoring/sets-points";
import type { CricketInningsState } from "../../shared/scoring/cricket-innings";
import type { FootballState } from "../../shared/scoring/football-events";
import { score as footballScore } from "../../shared/scoring/football-events";
import { periodName, type BasketballState } from "../../shared/scoring/basketball-points";
import { basketballConfigFrom } from "../../shared/scoring/fromMatchConfiguration";
import type { MatchConfiguration } from "../../shared/matchConfig";
import type { TennisState } from "../../shared/scoring/tennis-sets-games";

export interface CompactScore {
  a: string;
  b: string;
  sub?: string;
}

export function compactScore(
  scoringModel: ScoringModel,
  matchState: MatchStateDoc | null | undefined,
  isFinal = false,
  matchConfiguration?: MatchConfiguration | null
): CompactScore | null {
  if (!matchState) return null;
  const data = matchState.data as Record<string, unknown>;

  try {
    switch (scoringModel) {
      case "SETS_POINTS": {
        const s = data as unknown as SetsPointsState;
        const wonA = s.sets.filter((x) => x.completed && x.a > x.b).length;
        const wonB = s.sets.filter((x) => x.completed && x.b > x.a).length;
        if (isFinal) return { a: String(wonA), b: String(wonB), sub: setsSummary(s) || undefined };
        const cur = s.sets[s.currentSet];
        return {
          a: String(cur.a),
          b: String(cur.b),
          sub: `Set ${s.currentSet + 1}${wonA + wonB > 0 ? ` · sets ${wonA}-${wonB}` : ""}`,
        };
      }
      case "CRICKET_INNINGS": {
        const s = data as unknown as CricketInningsState;
        const own = s.battingFirst === "A" ? s.innings1 : s.innings2;
        const other = s.battingFirst === "A" ? s.innings2 : s.innings1;
        const active = s.currentInnings === 2 ? s.innings2 : s.innings1;
        return {
          a: `${own.runs}/${own.wickets}`,
          b: `${other.runs}/${other.wickets}`,
          sub: isFinal ? undefined : `Innings ${s.currentInnings} · ${active.oversCompleted}.${active.ballsInOver} ov`,
        };
      }
      case "FOOTBALL_EVENTS": {
        const state = data as unknown as FootballState;
        const s = footballScore(state);
        return {
          a: String(s.a),
          b: String(s.b),
          sub: state.penalties ? `Penalties ${state.penalties.a}-${state.penalties.b}` : undefined,
        };
      }
      case "BASKETBALL_POINTS": {
        const s = data as unknown as BasketballState;
        return {
          a: String(s.scoreA),
          b: String(s.scoreB),
          sub: isFinal ? undefined : periodName(s.period, basketballConfigFrom(matchConfiguration)),
        };
      }
      case "TENNIS_SETS_GAMES": {
        const s = data as unknown as TennisState;
        const wonA = s.sets.filter((x) => x.completed && x.gamesA > x.gamesB).length;
        const wonB = s.sets.filter((x) => x.completed && x.gamesB > x.gamesA).length;
        if (isFinal) {
          return {
            a: String(wonA),
            b: String(wonB),
            sub: s.sets.filter((x) => x.completed).map((x) => `${x.gamesA}-${x.gamesB}`).join(", ") || undefined,
          };
        }
        const cur = s.sets[s.sets.length - 1];
        return {
          a: String(cur.gamesA),
          b: String(cur.gamesB),
          sub: `Set ${s.sets.length} · ${s.currentGame.pointsA}-${s.currentGame.pointsB}`,
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
