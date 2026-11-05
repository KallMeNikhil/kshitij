import type { ReactNode } from "react";

export function IconChipButton({
  children,
  onClick,
  href,
  icon,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  icon?: ReactNode;
  className?: string;
}) {
  const content = (
    <>
      <span className="icon-chip-btn__sheen" aria-hidden="true" />
      <span className="icon-chip-btn__label">{children}</span>
      <span className="icon-chip-btn__chip" aria-hidden="true">
        <span className="icon-chip-btn__chip-icon icon-chip-btn__chip-icon--a">{icon ?? <ArrowIcon />}</span>
        <span className="icon-chip-btn__chip-icon icon-chip-btn__chip-icon--b">{icon ?? <ArrowIcon />}</span>
      </span>
    </>
  );

  if (href) {
    return (
      <a href={href} className={`kshitij-cta kshitij-cta--primary icon-chip-btn ${className ?? ""}`}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={`kshitij-cta kshitij-cta--primary icon-chip-btn ${className ?? ""}`}>
      {content}
    </button>
  );
}

function ArrowIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
