import type { Transition } from "framer-motion";

export const springs = {
  pointerFollow: { stiffness: 260, damping: 18, mass: 0.35 } satisfies Transition,
  cursorFollow: { stiffness: 380, damping: 34, mass: 0.4 } satisfies Transition,
  smoothProgress: { stiffness: 160, damping: 28, restDelta: 0.001 } satisfies Transition,
  settle: { stiffness: 300, damping: 30, mass: 0.5 } satisfies Transition,
  sheet: { stiffness: 340, damping: 32, mass: 0.6 } satisfies Transition,
} as const;

export type SpringName = keyof typeof springs;
