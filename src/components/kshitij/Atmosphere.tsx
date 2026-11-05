const GRAIN_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.5'/></svg>`;
const GRAIN_URL = `url("data:image/svg+xml,${encodeURIComponent(GRAIN_SVG)}")`;

export function Atmosphere({ intensity = "default" }: { intensity?: "default" | "low" }) {
  return (
    <div className={`atmosphere atmosphere--${intensity}`} aria-hidden="true">
      <svg className="atmosphere__lines" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" role="presentation">
        <line x1="0" y1="120" x2="1440" y2="120" />
        <line x1="0" y1="780" x2="1440" y2="780" />
        <line x1="240" y1="0" x2="240" y2="900" />
        <line x1="1200" y1="0" x2="1200" y2="900" />
        <path d="M0 450 L120 450 L120 330 L240 330" fill="none" />
        <path d="M1440 450 L1320 450 L1320 570 L1200 570" fill="none" />
      </svg>
      <div className="atmosphere__glow" />
      <div className="atmosphere__grain" style={{ backgroundImage: GRAIN_URL }} />
    </div>
  );
}
