export function GoalIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5 15.8 10.2 14.4 14.6H9.6L8.2 10.2 12 7.5ZM12 3v4.5M15.8 10.2 20 8.8M14.4 14.6 17 18.2M9.6 14.6 7 18.2M8.2 10.2 4 8.8" />
    </svg>
  );
}

export function CardIcon({ tone, size = 18 }: { tone: "yellow" | "red"; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="3" width="12" height="18" rx="2" fill={tone === "yellow" ? "var(--color-postponed)" : "var(--color-live)"} />
    </svg>
  );
}
