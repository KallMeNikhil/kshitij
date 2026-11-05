import { describe, it, expect } from "vitest";
import { resolveScoringModel, sportToScoringModel } from "./registry";
import type { MatchConfiguration } from "../matchConfig";

const basketballConfig = { scoringModel: "BASKETBALL_POINTS" } as MatchConfiguration;
const tennisConfig = { scoringModel: "TENNIS_SETS_GAMES" } as MatchConfiguration;

describe("resolveScoringModel", () => {
  it("prefers the fixture's own matchConfigurationSnapshot over everything else", () => {
    const fixture = { sportId: "football", matchConfigurationSnapshot: basketballConfig };
    const sport = { matchConfiguration: tennisConfig };
    expect(resolveScoringModel(fixture, sport)).toBe("BASKETBALL_POINTS");
  });

  it("falls back to the sport's current configured default when the fixture has no snapshot", () => {
    const fixture = { sportId: "football", matchConfigurationSnapshot: undefined };
    const sport = { matchConfiguration: tennisConfig };
    expect(resolveScoringModel(fixture, sport)).toBe("TENNIS_SETS_GAMES");
  });

  it("falls back to the legacy hardcoded sport map when neither snapshot nor sport config exist", () => {
    const fixture = { sportId: "football", matchConfigurationSnapshot: undefined };
    expect(resolveScoringModel(fixture, null)).toBe(sportToScoringModel("football"));
    expect(resolveScoringModel(fixture, undefined)).toBe(sportToScoringModel("football"));
  });

  it("matches the resolution hierarchy the Worker and LiveScoringPage already use for the same fixture", () => {

    const fixture = { sportId: "chess", matchConfigurationSnapshot: basketballConfig };
    expect(resolveScoringModel(fixture, null)).toBe("BASKETBALL_POINTS");
    expect(resolveScoringModel(fixture, null)).not.toBe(sportToScoringModel("chess"));
  });
});
