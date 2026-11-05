import type { PointerEvent as ReactPointerEvent } from "react";
import type { MoveDirection } from "../../../lib/useOrderDraft";

function Arrow({ kind }: { kind: MoveDirection }) {
  const bar = kind === "top" ? "M5 4h14" : kind === "bottom" ? "M5 20h14" : null;
  const head = kind === "up" || kind === "top" ? "M7 15l5-5 5 5" : "M7 9l5 5 5-5";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {bar && <path d={bar} />}
      <path d={head} />
    </svg>
  );
}

const BUTTONS: { direction: MoveDirection; label: string }[] = [
  { direction: "top", label: "Move to top" },
  { direction: "up", label: "Move up" },
  { direction: "down", label: "Move down" },
  { direction: "bottom", label: "Move to bottom" },
];

export function ReorderControls({
  name,
  index,
  count,
  disabled,
  onMove,
  onDragStart,
}: {
  name: string;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (direction: MoveDirection) => void;
  onDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="reorder" role="group" aria-label={`Order of ${name}`}>
      <button
        type="button"
        className="reorder__handle"
        aria-label={`Drag ${name} to reorder`}
        disabled={disabled || count < 2}
        onPointerDown={onDragStart}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="6" r="1.6" />
          <circle cx="15" cy="6" r="1.6" />
          <circle cx="9" cy="12" r="1.6" />
          <circle cx="15" cy="12" r="1.6" />
          <circle cx="9" cy="18" r="1.6" />
          <circle cx="15" cy="18" r="1.6" />
        </svg>
      </button>
      {BUTTONS.map(({ direction, label }) => {
        const atStart = index === 0 && (direction === "top" || direction === "up");
        const atEnd = index === count - 1 && (direction === "bottom" || direction === "down");
        return (
          <button
            key={direction}
            type="button"
            className="admin-btn admin-btn--icon"
            aria-label={`${label}: ${name}`}
            title={label}
            disabled={disabled || atStart || atEnd}
            onClick={() => onMove(direction)}
          >
            <Arrow kind={direction} />
          </button>
        );
      })}
    </div>
  );
}
