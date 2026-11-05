import type { ReactNode } from "react";

export function Marquee({ items, durationSeconds = 40, className }: { items: ReactNode[]; durationSeconds?: number; className?: string }) {
  const group = (hidden: boolean) => (
    <div className="marquee__group" aria-hidden={hidden || undefined}>
      {items.map((item, i) => (
        <span className="marquee__item" key={i}>
          {item}
        </span>
      ))}
    </div>
  );
  return (
    <div className={`marquee ${className ?? ""}`} style={{ "--marquee-duration": `${durationSeconds}s` } as React.CSSProperties}>
      <div className="marquee__track">
        {group(false)}
        {group(true)}
        {group(true)}
      </div>
    </div>
  );
}
