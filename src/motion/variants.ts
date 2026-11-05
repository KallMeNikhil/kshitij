import type { Variants } from "framer-motion";
import { easeOutExpo } from "./easing";
import { durations } from "./durations";

export function fadeUp(distance = 26): Variants {
  return {
    hidden: { opacity: 0, y: distance },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: durations.contentReveal, ease: easeOutExpo },
    },
  };
}

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: durations.contentReveal, ease: easeOutExpo },
  },
};

export function staggerChildren(step: number = durations.staggerStep): Variants {
  return {
    hidden: {},
    visible: { transition: { staggerChildren: step } },
  };
}
