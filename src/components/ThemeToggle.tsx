import { useTheme } from "../hooks/useTheme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isBright = theme === "bright";
  const label = isBright ? "Switch to classic dark theme" : "Switch to bright theme";
  return (
    <button
      type="button"
      className={`theme-switch ${isBright ? "is-bright" : ""}`}
      role="switch"
      aria-checked={isBright}
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      <span className="theme-switch__glyph theme-switch__glyph--dark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" /></svg>
      </span>
      <span className="theme-switch__glyph theme-switch__glyph--bright" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" fill="currentColor" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      </span>
      <span className="theme-switch__knob" aria-hidden="true" />
    </button>
  );
}
