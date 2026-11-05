import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { FocusInput } from "../../../lib/callables";

const KEY_STEP = 2;

function clamp(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

export function FocalPointPicker({
  src,
  value,
  label,
  onChange,
}: {
  src: string;
  value: FocusInput;
  label: string;
  onChange: (next: FocusInput) => void;
}) {
  const place = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    onChange({
      x: clamp(((event.clientX - rect.left) / rect.width) * 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100),
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const deltas: Record<string, FocusInput> = {
      ArrowLeft: { x: -KEY_STEP, y: 0 },
      ArrowRight: { x: KEY_STEP, y: 0 },
      ArrowUp: { x: 0, y: -KEY_STEP },
      ArrowDown: { x: 0, y: KEY_STEP },
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    onChange({ x: clamp(value.x + delta.x), y: clamp(value.y + delta.y) });
  };

  return (
    <div className="focal">
      <div
        className="focal__stage"
        role="application"
        tabIndex={0}
        aria-label={`${label}. Tap the image to set the focal point, or use the arrow keys. Currently ${Math.round(value.x)} percent across and ${Math.round(value.y)} percent down.`}
        onPointerDown={place}
        onKeyDown={onKeyDown}
      >
        <img className="focal__image" src={src} alt="" draggable={false} />
        <span className="focal__dot" style={{ left: `${value.x}%`, top: `${value.y}%` }} aria-hidden="true" />
      </div>
      <p className="admin-hint">Tap the image where the subject is. The public site keeps that spot in frame when it crops.</p>
    </div>
  );
}
