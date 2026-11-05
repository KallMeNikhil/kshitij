export const BREAKPOINTS = {
  tablet: 720,
  nav: 900,
  desktop: 1024,
  wide: 1280,
} as const;

export const minWidth = (key: keyof typeof BREAKPOINTS) => `(min-width: ${BREAKPOINTS[key]}px)`;
