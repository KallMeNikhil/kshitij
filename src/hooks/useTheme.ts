import { useCallback, useEffect, useState } from "react";

export type Theme = "classic" | "bright";
const KEY = "kshitij-theme";

function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "bright" ? "bright" : "classic";
  } catch {
    return "classic";
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "classic" ? "bright" : "classic")), []);
  return { theme, toggle };
}
