import type { MatchConfiguration, MatchStructure } from "../matchConfig";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function describeStructure(structure: MatchStructure): string {
  switch (structure.kind) {
    case "SETS_POINTS": {
      const base = `Best of ${structure.bestOf}, ${structure.pointsToWin} points`;
      const cap = structure.capPoints ? `, cap ${structure.capPoints}` : ", win by 2";
      const deciding = structure.decidingSetFormat
        ? `, deciding set to ${structure.decidingSetFormat.pointsToWin}`
        : structure.setPointsBySetIndex && structure.setPointsBySetIndex.length === structure.bestOf
          ? `, deciding set to ${structure.setPointsBySetIndex[structure.bestOf - 1]}`
          : "";
      return `${base}${cap}${deciding}`;
    }
    case "GAMES_SETS": {
      const tieBreak = structure.tieBreakAtGames !== undefined ? `, tie-break at ${structure.tieBreakAtGames}-${structure.tieBreakAtGames}` : "";
      const final = structure.finalSetFormat === "SUPER_TIE_BREAK" ? `, final set ${structure.superTieBreakPoints ?? 10}-point tie-break` : "";
      return `Best of ${plural(structure.bestOfSets, "set")}, ${structure.gamesPerSet} games${tieBreak}${final}${structure.noAd ? ", no-ad" : ""}`;
    }
    case "INNINGS":
      return `${plural(structure.oversPerInnings, "over")} per side${structure.wicketsPerInnings ? `, ${plural(structure.wicketsPerInnings, "wicket")}` : ""}`;
    case "PERIODS": {
      const label = structure.periodLabel === "HALF" ? "half" : structure.periodLabel === "PERIOD" ? "period" : "quarter";
      return `${plural(structure.periodCount, label).replace("halfs", "halves")}${structure.minutesPerPeriod ? ` of ${structure.minutesPerPeriod} min` : ""}`;
    }
    case "EVENTS":
      return `${plural(structure.periodCount, "half").replace("halfs", "halves")}${structure.minutesPerPeriod ? ` of ${structure.minutesPerPeriod} min` : ""}${structure.penaltiesOnDraw ? ", penalties if level" : ""}`;
    case "RESULT_ONLY":
      if (structure.pointDetail === "SCORE_BREAKDOWN") return `Best of ${plural(structure.bestOfBoards ?? 3, "board")}`;
      return structure.drawAllowed ? `Single game${structure.tieBreak ? `, ${structure.tieBreak.toLowerCase()} if drawn` : ""}` : "Single game";
    default:
      return "";
  }
}

export function describeFormat(config: MatchConfiguration | null | undefined): string | null {
  if (!config) return null;
  return describeStructure(config.structure) || null;
}
