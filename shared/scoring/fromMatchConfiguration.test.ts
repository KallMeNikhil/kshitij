import { describe, it, expect } from "vitest";
import {
  basketballConfigFrom,
  setsPointsConfigFrom,
  tennisBestOfSetsFrom,
  cricketOversFrom,
} from "./fromMatchConfiguration";
import { defaultMatchConfigurations } from "../matchConfig";

describe("fromMatchConfiguration adapters", () => {
  it("reads basketball quarters from configuration, defaults to 4 without one", () => {
    expect(basketballConfigFrom(defaultMatchConfigurations.basketball)).toEqual({ quarters: 4, periodLabel: "QUARTER" });
    expect(basketballConfigFrom(null)).toEqual({ quarters: 4 });
  });

  it("reads volleyball's configured bestOf/pointsToWin instead of the table-tennis default", () => {
    const config = setsPointsConfigFrom(defaultMatchConfigurations.volleyball, "volleyball");
    expect(config).toEqual({ bestOf: 3, pointsToWin: 25, setPoints: [25, 25, 15], decidingSet: { pointsToWin: 15 } });
  });

  it("falls back to the legacy per-sport constant when no configuration is present", () => {
    expect(setsPointsConfigFrom(null, "table-tennis")).toEqual({ bestOf: 3, pointsToWin: 11 });
    expect(setsPointsConfigFrom(null, "badminton")).toEqual({ bestOf: 3, pointsToWin: 21, capPoints: 30 });
  });

  it("reads tennis bestOfSets from configuration", () => {
    expect(tennisBestOfSetsFrom(defaultMatchConfigurations.tennis)).toBe(3);
    expect(tennisBestOfSetsFrom(null)).toBe(3);
  });

  it("reads cricket overs-per-innings from configuration instead of the old 20-over default", () => {
    expect(cricketOversFrom(defaultMatchConfigurations.cricket)).toBe(8);
    expect(cricketOversFrom(null)).toBe(20);
  });
});
