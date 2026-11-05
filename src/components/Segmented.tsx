import { useId, type ReactNode } from "react";
import { motion } from "framer-motion";
import { springs } from "../motion/springs";

export interface SegmentedOption {
  value: string;
  label: string;
  count?: number;
  icon?: ReactNode;
  live?: boolean;
}

export interface SegmentedProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  skin?: "underline" | "pill" | "rail";
  "aria-label": string;
  className?: string;
}

export function Segmented({ options, value, onChange, skin = "pill", className, ...rest }: SegmentedProps) {
  const layoutId = useId();

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const backward = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!forward && !backward) return;
    e.preventDefault();
    const dir = forward ? 1 : -1;
    const next = (index + dir + options.length) % options.length;
    onChange(options[next].value);
    (document.getElementById(`${layoutId}-${options[next].value}`) as HTMLElement | null)?.focus();
  };

  return (
    <div className={`segmented segmented--${skin} ${className ?? ""}`} role="tablist" aria-orientation={skin === "rail" ? "vertical" : "horizontal"} aria-label={rest["aria-label"]}>
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            id={`${layoutId}-${opt.value}`}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={`segmented__item ${active ? "is-active" : ""}`}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {active && skin !== "rail" && (
              <motion.span
                layoutId={`${layoutId}-indicator`}
                className="segmented__indicator"
                transition={springs.settle}
              />
            )}
            <span className="segmented__label">
              {skin === "rail" && <span className="segmented__icon" aria-hidden="true">{active ? opt.icon : null}</span>}
              {opt.label}
              {opt.live && (
                <span className="segmented__live">
                  <span className="visually-hidden">Live</span>
                </span>
              )}
              {typeof opt.count === "number" && <span className="segmented__count">{opt.count}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
