import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useDialogBehavior } from "../hooks/useDialogBehavior";
import { springs } from "../motion/springs";

export interface SheetOption {
  value: string;
  label: string;
  hint?: string;
}

function SheetBody({
  title,
  options,
  value,
  onSelect,
  onClose,
}: {
  title: string;
  options: SheetOption[];
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogBehavior(ref, onClose);

  return createPortal(
    <motion.div className="option-sheet__overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        ref={ref}
        className="option-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={springs.sheet}
      >
        <div className="option-sheet__header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="option-sheet__close" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <ul className="option-sheet__list">
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                className={`option-sheet__option ${o.value === value ? "is-current" : ""}`}
                aria-pressed={o.value === value}
                onClick={() => {
                  onSelect(o.value);
                  onClose();
                }}
              >
                <span>{o.label}</span>
                {o.hint && <small>{o.hint}</small>}
              </button>
            </li>
          ))}
        </ul>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

export function OptionPicker({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: SheetOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);

  const close = () => {
    setOpen(false);
    window.setTimeout(() => trigger.current?.focus(), 0);
  };

  return (
    <>
      <button ref={trigger} type="button" className="option-picker" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span className="option-picker__label">{title}</span>
        <span className="option-picker__value">{current?.label ?? "Select"}</span>
        <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <AnimatePresence>
        {open && <SheetBody title={title} options={options} value={value} onSelect={onChange} onClose={close} />}
      </AnimatePresence>
    </>
  );
}
