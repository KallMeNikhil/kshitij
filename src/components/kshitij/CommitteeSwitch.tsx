import { useRef, type KeyboardEvent } from "react";

export interface CommitteeSwitchOption {
  value: string;
  label: string;
}

export function CommitteeSwitch({
  options,
  value,
  onChange,
  label,
  className = "",
}: {
  options: CommitteeSwitchOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !backward) return;
    event.preventDefault();
    const next = (index + (forward ? 1 : -1) + options.length) % options.length;
    onChange(options[next].value);
    tabs.current[next]?.focus();
  };

  return (
    <div className={`cswitch ${className}`} role="tablist" aria-label={label}>
      {options.map((option, i) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              tabs.current[i] = node;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className="cswitch__tab"
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, i)}
          >
            <span className="cswitch__label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
