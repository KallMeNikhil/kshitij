import { getSportMeta } from "./sportMeta";

export function SportIcon({ slug, size = 22 }: { slug: string; size?: number }) {
  const meta = getSportMeta(slug);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {meta.icon.map((part, i) => (
        <path key={i} d={part.d} fill={part.fill ? "currentColor" : undefined} strokeWidth={part.width} />
      ))}
    </svg>
  );
}
