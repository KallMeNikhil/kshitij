import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { springs } from "../../motion/springs";

export interface ActionMessage {
  kind: "success" | "error";
  text: string;
}

export function ActionStatus({ message }: { message: ActionMessage | null }) {
  const [toast, setToast] = useState<ActionMessage | null>(null);

  useEffect(() => {
    if (message?.kind !== "success") {
      setToast(null);
      return;
    }
    setToast(message);
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (message?.kind === "error") {
    return (
      <p className="admin-alert admin-alert--error" role="alert">
        {message.text}
      </p>
    );
  }

  return createPortal(
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.text}
          className="admin-toast"
          role="status"
          initial={{ y: -16, opacity: 0, scale: 0.97 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={springs.sheet}
        >
          <svg className="admin-toast__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          <span>{toast.text}</span>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
