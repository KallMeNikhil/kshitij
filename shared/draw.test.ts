import { describe, expect, it } from "vitest";
import { sameCollegeClashes, seededRandom, separateColleges, shuffleWith } from "./draw";

describe("random draw", () => {
  it("is reproducible from its stored seed", () => {
    const rows = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(shuffleWith(rows, seededRandom(42))).toEqual(shuffleWith(rows, seededRandom(42)));
    expect(shuffleWith(rows, seededRandom(42))).not.toEqual(shuffleWith(rows, seededRandom(7)));
  });

  it("keeps entrants from the same college apart in round one where possible", () => {
    const rows = [
      { id: "1", college: "NIT A" },
      { id: "2", college: "NIT B" },
      { id: "3", college: "NIT C" },
      { id: "4", college: "NIT D" },
      { id: "5", college: "NIT D" },
      { id: "6", college: "NIT C" },
      { id: "7", college: "NIT B" },
      { id: "8", college: "NIT A" },
    ];
    const collegeOf = (r: { college: string }) => r.college;
    expect(sameCollegeClashes(rows, collegeOf)).toBe(4);
    const separated = separateColleges(rows, collegeOf);
    expect(sameCollegeClashes(separated, collegeOf)).toBe(0);
    expect(separated.map((r) => r.id).sort()).toEqual(rows.map((r) => r.id).sort());
  });
});
