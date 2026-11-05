import { motion, useScroll, useSpring, type MotionValue } from "framer-motion";
import type { RefObject } from "react";
import { springs } from "../../motion/springs";

export interface ScrollProgressProps {
  background?: string;
  height?: number;
  className?: string;
  container?: RefObject<HTMLElement>;
}

export function ScrollProgress({
  background = "linear-gradient(to right, var(--color-accent), var(--color-accent-strong))",
  height = 2,
  className,
  container,
}: ScrollProgressProps) {
  const { scrollYProgress } = useScroll(container ? { container } : undefined);
  const scaleX: MotionValue<number> = useSpring(scrollYProgress, springs.smoothProgress);

  return (
    <motion.div
      aria-hidden="true"
      style={{
        scaleX,
        background,
        height,
        position: "fixed",
        insetInline: 0,
        top: "var(--safe-top)",
        zIndex: 100,
        transformOrigin: "0% 50%",
      }}
      className={className}
    />
  );
}
