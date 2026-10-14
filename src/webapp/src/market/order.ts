// Card layout arithmetic for the Analysis grid. Kept apart from the component
// so it stays plain TypeScript: pure, testable, and importable from the Node
// test runner without needing a JSX compiler.

export interface LayoutSymbol {
  symbol: string;
}

export type DropSide = "before" | "after";

/**
 * Reorder `items` to match a saved `order`. Anything missing from `order` keeps
 * its relative position at the end, so a symbol added after the layout was saved
 * shows up rather than disappearing.
 */
export function applyOrder<T extends LayoutSymbol>(items: T[], order: string[]): T[] {
  if (!order.length) return items;
  const rank = new Map(order.map((s, i) => [s, i]));
  const known = items.filter((i) => rank.has(i.symbol));
  const missing = items.filter((i) => !rank.has(i.symbol));
  known.sort((a, b) => rank.get(a.symbol)! - rank.get(b.symbol)!);
  return [...known, ...missing];
}

/**
 * Move `symbol` so it ends up at final index `toIndex`, keeping every other card
 * in its existing relative order. `toIndex` is clamped into range.
 *
 * The argument is the FINAL index in the resulting array, which is what a caller
 * computing a drop position wants. Treating it as an insertion offset instead
 * made "drag one step right" a no-op whenever the card moved forward, because
 * the slot it vacated shifted everything back under it.
 */
export function moveTo<T extends LayoutSymbol>(items: T[], symbol: string, toIndex: number): T[] {
  const from = items.findIndex((i) => i.symbol === symbol);
  if (from === -1) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  const clamped = Math.max(0, Math.min(next.length, Math.round(toIndex)));
  next.splice(clamped, 0, moved);
  return next;
}

/**
 * Final index for the dragged card when dropped relative to `targetIndex`,
 * where `from` is the dragged card's current index. Removing the dragged card
 * shifts the target left when the drag started before it, so that has to be
 * accounted for or the card lands one slot short.
 */
export function dropIndex(from: number, targetIndex: number, side: DropSide): number {
  const targetFinal = targetIndex - (from < targetIndex ? 1 : 0);
  return side === "before" ? targetFinal : targetFinal + 1;
}