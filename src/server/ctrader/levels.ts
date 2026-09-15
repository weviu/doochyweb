// cTrader echoes an order's or position's SL/TP in one of two forms:
//   - absolute: stopLoss / takeProfit as doubles
//   - relative:  relativeStopLoss / relativeTakeProfit as int64s in 1/100_000 of
//     a price unit, measured FROM the order's own level (limit/stop price) or
//     the position's entry.
// Some brokers/accounts only ever respond with the relative form, so code that
// reads only the absolute fields silently sees null. Normalize both to an
// absolute price.

// Relative semantics (Open API docs):
//   BUY  stopLoss = anchor - rel,  takeProfit = anchor + rel
//   SELL stopLoss = anchor + rel,  takeProfit = anchor - rel
export function resolveLevel(
  anchor: number | null | undefined,
  side: "BUY" | "SELL",
  kind: "SL" | "TP",
  absolute: unknown,
  relative: unknown
): number | null {
  if (absolute != null) {
    const n = Number(absolute);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  const rel = Number(relative);
  if (!Number.isFinite(rel) || rel === 0) return null;
  if (anchor == null || !Number.isFinite(anchor)) return null;
  const dist = rel / 100_000;
  const isBuy = side === "BUY";
  const add = kind === "SL" ? (isBuy ? -dist : dist) : (isBuy ? dist : -dist);
  // The relative form is exact to 1/100_000; snap float noise from the divide
  // so levels round-trip to the same digits the broker stores them at.
  return Math.round((anchor + add) * 100_000) / 100_000;
}