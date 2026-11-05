import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useDialogBehavior } from "../../hooks/useDialogBehavior";
import { describeError } from "../../lib/describeError";
import { springs } from "../../motion/springs";

export function ConfirmSheet({
  title,
  confirmLabel,
  tone = "default",
  confirmDisabled = false,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  confirmDisabled?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useDialogBehavior(ref, () => {
    if (!busy) onClose();
  });

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  };

  return createPortal(
    <motion.div
      className="confirm-sheet__overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !busy && onClose()}
    >
      <motion.div
        ref={ref}
        className="confirm-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={springs.sheet}
      >
        <h2 id={titleId} className="confirm-sheet__title">
          {title}
        </h2>
        <div className="confirm-sheet__body">{children}</div>
        {error && (
          <p className="admin-alert admin-alert--error" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-sheet__actions">
          <button type="button" className="admin-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`admin-btn ${tone === "danger" ? "admin-btn--primary admin-btn--danger" : "admin-btn--primary"}`}
            disabled={busy || confirmDisabled}
            onClick={() => void confirm()}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
