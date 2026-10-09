import { useId } from "react";

// Close-price sparkline with a soft gradient fill. Ported from gauge's
// `sparkline()` (public/app.js); geometry is unchanged.

export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const gradientId = useId();
  if (!values || values.length < 2) return null;

  const w = 250;
  const h = 40;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-9 w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon
        points={`${pad},${h - pad} ${pts.join(" ")} ${w - pad},${h - pad}`}
        fill={`url(#${gradientId})`}
      />
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}