import { useState } from "react";
import type { MatchStateDoc } from "../../../../shared/types";
import type { CompleteHandler } from "./types";

export function ResultOnlyControl({
  labelA,
  labelB,
  onComplete,
}: {
  fixtureId: string;
  labelA: string;
  labelB: string;
  matchState: MatchStateDoc | null;
  onComplete: CompleteHandler;
}) {
  const [selected, setSelected] = useState<"A" | "B" | null>(null);
  const selectedLabel = selected === "A" ? labelA : selected === "B" ? labelB : null;

  return (
    <div className="control">
      <p className="control__context">Select the winner.</p>
      <div className="control__pair">
        {(["A", "B"] as const).map((side) => (
          <button
            key={side}
            type="button"
            className={`control__tap control__tap--short ${selected === side ? "is-selected" : ""}`}
            aria-pressed={selected === side}
            onClick={() => setSelected(side)}
          >
            <span className="control__tap-name">{side === "A" ? labelA : labelB}</span>
            <span className="control__tap-hint">{selected === side ? "Selected" : "Winner"}</span>
          </button>
        ))}
      </div>
      {selected && (
        <button type="button" className="admin-btn admin-btn--primary admin-btn--block" onClick={() => onComplete(selected, `${selectedLabel} wins`)}>
          Complete match · {selectedLabel} wins
        </button>
      )}
    </div>
  );
}
