import { RATINGS, ZONE_COLORS, ZONE_ORDER, type Rating } from "./ratings";

// Five-zone needle dial. Ported from gauge's `gaugeSvg()` (public/app.js),
// re-rendered as React. Geometry is unchanged: a 200x124 viewBox, five 36-degree
// arcs, and a needle positioned from the net-vote score blended with the
// categorical verdict.

const CX = 100;
const CY = 100;
const R = 78;

// Where the needle sits for each verdict on the -1..1 scale.
const ZONE_CENTER: Record<Rating, number> = {
  strong_sell: -0.8,
  sell: -0.4,
  neutral: 0,
  buy: 0.4,
  strong_buy: 0.8,
};

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

function pos(angle: number): [number, number] {
  const rad = (angle * Math.PI) / 180;
  return [CX + R * Math.cos(rad), CY - R * Math.sin(rad)];
}

/** Map (score, verdict, strongRatio) to a -1..1 needle position. */
export function needlePosition(score: number, rating: Rating, strongRatio: number): number {
  const ratio = strongRatio || 0.25;
  let d = ZONE_CENTER[rating] ?? 0;
  if (rating === "neutral") {
    // Inside the neutral zone, lean on the score so a near-miss still shows
    // which way it leaned rather than sitting dead centre.
    d += clamp(score || 0, -0.18, 0.18) * 0.9;
  } else {
    const mag = Math.abs(score || 0);
    const extra = Math.max(0, mag - ratio);
    const span = Math.max(0.0001, 1 - ratio);
    d += Math.sign(score || 1) * (extra / span) * 0.18;
  }
  return clamp(d, -1, 1);
}

export function RatingDial({
  score,
  rating,
  strongRatio = 0.25,
  size = "md",
}: {
  score: number;
  rating: Rating;
  strongRatio?: number;
  size?: "sm" | "md";
}) {
  const d = needlePosition(score, rating, strongRatio);
  const angle = 90 - d * 90;

  const arcs = ZONE_ORDER.map((r, i) => {
    const a0 = 180 - 36 * i;
    const a1 = 180 - 36 * (i + 1);
    const [x0, y0] = pos(a0);
    const [x1, y1] = pos(a1);
    const active = r === rating;
    return (
      <path
        key={r}
        d={`M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`}
        stroke={ZONE_COLORS[i]}
        strokeWidth={active ? 17 : 12}
        fill="none"
        strokeLinecap="round"
        opacity={active ? 1 : 0.3}
      />
    );
  });

  const rad = (angle * Math.PI) / 180;
  const nx = CX + (R - 14) * Math.cos(rad);
  const ny = CY - (R - 14) * Math.sin(rad);
  const color = RATINGS[rating]?.color ?? RATINGS.neutral.color;

  return (
    <svg
      viewBox="0 0 200 124"
      role="img"
      aria-label={RATINGS[rating]?.label ?? rating}
      className={size === "sm" ? "w-full" : "w-full max-w-[200px]"}
    >
      {arcs}
      <line
        x1={CX}
        y1={CY}
        x2={nx.toFixed(1)}
        y2={ny.toFixed(1)}
        stroke="#ffffff"
        strokeWidth={2.6}
        strokeLinecap="round"
      />
      <circle cx={CX} cy={CY} r={5.5} fill="#ffffff" />
      <circle cx={CX} cy={CY} r={9} fill="none" stroke={color} strokeWidth={2} opacity={0.5} />
      <text x={12} y={117} fill={ZONE_COLORS[0]} fontSize={10} fontWeight={700}>
        SS
      </text>
      <text x={180} y={117} fill={ZONE_COLORS[4]} fontSize={10} fontWeight={700}>
        SB
      </text>
    </svg>
  );
}