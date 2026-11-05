import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { easeOutExpo } from "../../motion/easing";
import { durations } from "../../motion/durations";

export type RevealVariant = "fade-up" | "fade" | "mask";

export interface RevealProps {
  children: ReactNode;
  variant?: RevealVariant;
  delay?: number;
  y?: number;
  repeat?: boolean;
  onMount?: boolean;
  viewportMargin?: string;
  className?: string;
}

export function Reveal({
  children,
  variant = "fade-up",
  delay = 0,
  y = 26,
  repeat = false,
  onMount = false,
  viewportMargin = "-80px",
  className,
}: RevealProps) {
  const initial =
    variant === "mask"
      ? { clipPath: "inset(0% 0% 100% 0%)", y }
      : variant === "fade-up"
        ? { opacity: 0, y }
        : { opacity: 0 };
  const animate =
    variant === "mask"
      ? { clipPath: "inset(0% 0% -15% 0%)", y: 0 }
      : variant === "fade-up"
        ? { opacity: 1, y: 0 }
        : { opacity: 1 };

  return (
    <motion.div
      className={className}
      initial={initial}
      animate={onMount ? animate : undefined}
      whileInView={onMount ? undefined : animate}
      viewport={onMount ? undefined : { once: !repeat, margin: viewportMargin }}
      transition={{ duration: durations.contentReveal, delay, ease: easeOutExpo }}
    >
      {children}
    </motion.div>
  );
}
