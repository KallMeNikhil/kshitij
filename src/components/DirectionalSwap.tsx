import { useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { easeOutExpo } from "../motion/easing";
import { durations } from "../motion/durations";

const OFFSET = 24;

export function DirectionalSwap({
  stateKey,
  index,
  children,
  className,
}: {
  stateKey: string | number;
  index: number;
  children: ReactNode;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const previous = useRef({ index, key: stateKey });
  const direction = useRef(0);
  if (previous.current.index !== index) {
    direction.current = index > previous.current.index ? 1 : -1;
    previous.current = { index, key: stateKey };
  } else if (previous.current.key !== stateKey) {
    direction.current = 0;
    previous.current = { index, key: stateKey };
  }

  if (reduced) {
    return (
      <div key={stateKey} className={className}>
        {children}
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false} custom={direction.current}>
      <motion.div
        key={stateKey}
        className={className}
        custom={direction.current}
        variants={{
          enter: (d: number) => ({ opacity: 0, x: d * OFFSET }),
          center: { opacity: 1, x: 0 },
          exit: (d: number) => ({ opacity: 0, x: d * -OFFSET }),
        }}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{ duration: durations.microInteraction, ease: easeOutExpo }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
