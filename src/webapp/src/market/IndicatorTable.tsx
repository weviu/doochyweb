import { indicatorValue, ratingColor, ratingLabel, SIGNALS, type Signal } from "./ratings";
import type { Section } from "./types";

export function IndicatorTable({ title, section }: { title: string; section: Section }) {
  const color = ratingColor(section.rating);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h4>
        <span className="text-xs font-semibold" style={{ color }}>
          {ratingLabel(section.rating)}
        </span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-hairline text-fg-faint">
            <th className="py-1 text-left font-medium">Indicator</th>
            <th className="py-1 text-right font-medium">Value</th>
            <th className="py-1 text-right font-medium">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {section.rows.map((r) => (
            <tr key={r.name} className="transition hover:bg-surface-hover">
              <td className="py-1 text-fg-muted">{r.name}</td>
              <td className="py-1 text-right tabular-nums text-fg">{indicatorValue(r.name, r.value)}</td>
              <td
                className="py-1 text-right font-medium"
                style={{ color: signalColor(r.signal as Signal) }}
              >
                {SIGNALS[r.signal] ?? "Neutral"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function signalColor(signal: Signal): string {
  if (signal === "buy") return ratingColor("buy");
  if (signal === "sell") return ratingColor("sell");
  return ratingColor("neutral");
}

/** Proportional buy / sell / neutral bar. */
export function VoteBars({ section }: { section: { buy: number; sell: number; neutral: number } }) {
  const total = section.buy + section.sell + section.neutral || 1;
  const seg = (n: number, color: string) => (
    <div className="h-1.5" style={{ background: color, flex: n / total }} />
  );
  return (
    <div className="flex gap-0.5 overflow-hidden rounded-full">
      {seg(section.buy, ratingColor("buy"))}
      {seg(section.sell, ratingColor("sell"))}
      {seg(section.neutral, "#4a4a4a")}
    </div>
  );
}