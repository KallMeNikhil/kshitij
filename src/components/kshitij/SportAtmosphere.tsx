import { getSportMeta } from "./sportMeta";

export function SportAtmosphere({ slug, className }: { slug: string; className?: string }) {
  const meta = getSportMeta(slug);
  return (
    <div className={`sport-atmosphere ${className ?? ""}`} aria-hidden="true" style={{ color: meta.accent }}>
      <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" role="presentation">
        {geometryFor(slug)}
      </svg>
    </div>
  );
}

function geometryFor(slug: string) {
  switch (slug) {
    case "football":
      return (
        <g fill="none" stroke="currentColor">
          <rect x="120" y="80" width="1200" height="740" />
          <line x1="720" y1="80" x2="720" y2="820" />
          <circle cx="720" cy="450" r="110" />
          <circle cx="720" cy="450" r="3" fill="currentColor" stroke="none" />
          <rect x="120" y="260" width="180" height="380" />
          <rect x="1140" y="260" width="180" height="380" />
          <rect x="120" y="360" width="70" height="180" />
          <rect x="1250" y="360" width="70" height="180" />
          <path d="M300 260 A 110 110 0 0 1 300 640" />
          <path d="M1140 260 A 110 110 0 0 0 1140 640" />
        </g>
      );
    case "basketball":
      return (
        <g fill="none" stroke="currentColor">
          <rect x="140" y="120" width="1160" height="660" />
          <line x1="720" y1="120" x2="720" y2="780" />
          <circle cx="720" cy="450" r="100" />
          <rect x="140" y="330" width="190" height="240" />
          <rect x="1110" y="330" width="190" height="240" />
          <path d="M140 240 A 300 300 0 0 1 140 660" />
          <path d="M1300 240 A 300 300 0 0 0 1300 660" />
        </g>
      );
    case "badminton":
      return (
        <g fill="none" stroke="currentColor">
          <rect x="260" y="120" width="920" height="660" />
          <line x1="260" y1="450" x2="1180" y2="450" strokeWidth="2.5" />
          <line x1="260" y1="230" x2="1180" y2="230" />
          <line x1="260" y1="670" x2="1180" y2="670" />
          <line x1="720" y1="120" x2="720" y2="780" strokeDasharray="2 10" />
          <path d="M400 780 C 520 560 560 380 640 200" strokeDasharray="4 8" />
          <circle cx="640" cy="200" r="10" />
          <path d="M640 200 L 600 160 M640 200 L 660 155 M640 200 L 685 175" />
        </g>
      );
    case "cricket":
      return (
        <g fill="none" stroke="currentColor">
          <rect x="620" y="70" width="200" height="760" />
          <line x1="620" y1="140" x2="820" y2="140" />
          <line x1="620" y1="760" x2="820" y2="760" />
          <line x1="695" y1="70" x2="695" y2="150" strokeWidth="3" />
          <line x1="720" y1="70" x2="720" y2="150" strokeWidth="3" />
          <line x1="745" y1="70" x2="745" y2="150" strokeWidth="3" />
          <line x1="695" y1="680" x2="695" y2="760" strokeWidth="3" />
          <line x1="720" y1="680" x2="720" y2="760" strokeWidth="3" />
          <line x1="745" y1="680" x2="745" y2="760" strokeWidth="3" />
          <circle cx="720" cy="450" r="380" strokeDasharray="2 12" />
          <path d="M720 760 Q 900 500 1050 250" strokeDasharray="4 8" />
        </g>
      );
    case "volleyball":
      return (
        <g fill="none" stroke="currentColor">
          <rect x="180" y="150" width="1080" height="600" />
          <line x1="720" y1="150" x2="720" y2="750" strokeWidth="2.5" />
          <line x1="480" y1="150" x2="480" y2="750" strokeDasharray="2 10" />
          <line x1="960" y1="150" x2="960" y2="750" strokeDasharray="2 10" />
          <path d="M180 150 L 720 40 L 1260 150" strokeDasharray="3 9" />
        </g>
      );
    case "tennis":
      return (
        <g fill="none" stroke="currentColor">
          <rect x="160" y="110" width="1120" height="680" />
          <rect x="270" y="110" width="900" height="680" />
          <line x1="270" y1="450" x2="1170" y2="450" strokeWidth="2.5" />
          <line x1="720" y1="260" x2="720" y2="640" strokeDasharray="2 10" />
          <line x1="270" y1="260" x2="1170" y2="260" />
          <line x1="270" y1="640" x2="1170" y2="640" />
        </g>
      );
    case "table-tennis":
      return (
        <g fill="none" stroke="currentColor">
          <rect x="270" y="230" width="900" height="440" />
          <line x1="270" y1="450" x2="1170" y2="450" strokeWidth="3" />
          <line x1="720" y1="230" x2="720" y2="670" strokeDasharray="2 8" />
          <path d="M420 670 Q 500 500 620 380" strokeDasharray="3 7" />
        </g>
      );
    case "chess":
      return (
        <g fill="none" stroke="currentColor">
          <rect x="420" y="150" width="600" height="600" />
          {Array.from({ length: 7 }).map((_, i) => (
            <line key={`v${i}`} x1={420 + ((i + 1) * 600) / 8} y1="150" x2={420 + ((i + 1) * 600) / 8} y2="750" />
          ))}
          {Array.from({ length: 7 }).map((_, i) => (
            <line key={`h${i}`} x1="420" y1={150 + ((i + 1) * 600) / 8} x2="1020" y2={150 + ((i + 1) * 600) / 8} />
          ))}
        </g>
      );
    case "carrom":
      return (
        <g fill="none" stroke="currentColor">
          <rect x="330" y="180" width="780" height="540" />
          <circle cx="330" cy="180" r="38" />
          <circle cx="1110" cy="180" r="38" />
          <circle cx="330" cy="720" r="38" />
          <circle cx="1110" cy="720" r="38" />
          <circle cx="720" cy="450" r="120" />
          <circle cx="720" cy="450" r="4" fill="currentColor" stroke="none" />
          <line x1="330" y1="180" x2="1110" y2="720" strokeDasharray="2 10" />
          <line x1="1110" y1="180" x2="330" y2="720" strokeDasharray="2 10" />
        </g>
      );
    default:
      return (
        <g fill="none" stroke="currentColor">
          <circle cx="720" cy="450" r="260" />
          <circle cx="720" cy="450" r="160" />
        </g>
      );
  }
}
