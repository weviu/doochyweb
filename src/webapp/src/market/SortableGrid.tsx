// Drag-to-reorder grid for the Analysis cards. Native HTML5 drag-and-drop, no
// dependency.
//
// Two gaps in the built-in behaviour are closed here:
//
//  - it is not keyboard reachable, so every card is focusable and
//    Ctrl/Cmd+ArrowLeft/Right moves it instead;
//  - dragover fires continuously and the pointer can cross several cards in one
//    gesture, so the insertion side is derived from the pointer offset against
//    the target's midpoint and only committed on drop.
//
// Layout arithmetic lives in ./order so it can be unit tested without JSX.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { dropIndex, moveTo, type DropSide, type LayoutSymbol } from "./order";

export function SortableGrid<T extends LayoutSymbol>({
  items,
  onReorder,
  canReorder,
  className = "",
  renderItem,
}: {
  items: T[];
  onReorder: (next: T[]) => void;
  /** Dragging needs the write endpoints, so anonymous visitors get a read-only grid. */
  canReorder: boolean;
  className?: string;
  renderItem: (item: T) => ReactNode;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<{ symbol: string; side: DropSide } | null>(null);

  // A card can fire dragleave when the pointer crosses its inner elements, so
  // track enter/leave depth instead of trusting a single leave event.
  const enterDepth = useRef(0);

  const reset = useCallback(() => {
    enterDepth.current = 0;
    setDragging(null);
    setTarget(null);
  }, []);

  useEffect(() => {
    // A drag can end anywhere (dropped outside a card, cancelled with Escape),
    // so clear state on the window as well as on the card.
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
    };
  }, [reset]);

  const commit = useCallback(
    (symbol: string, against: string, side: DropSide) => {
      const from = items.findIndex((i) => i.symbol === symbol);
      const targetIndex = items.findIndex((i) => i.symbol === against);
      if (from === -1 || targetIndex === -1) return;
      const next = moveTo(items, symbol, dropIndex(from, targetIndex, side));
      if (next.some((n, i) => n.symbol !== items[i]?.symbol)) onReorder(next);
    },
    [items, onReorder]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, symbol: string) => {
      if (!canReorder) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const index = items.findIndex((i) => i.symbol === symbol);
      if (index === -1) return;
      onReorder(moveTo(items, symbol, e.key === "ArrowLeft" ? index - 1 : index + 1));
    },
    [canReorder, items, onReorder]
  );

  return (
    <div className={className}>
      {items.map((item) => {
        const isDragging = dragging === item.symbol;
        const isTarget = target?.symbol === item.symbol;
        const marker =
          target?.side === "before"
            ? "before:absolute before:-left-1.5 before:top-2 before:h-[calc(100%-1rem)] before:w-0.5 before:rounded-full before:bg-accent before:content-['']"
            : "after:absolute after:-right-1.5 after:top-2 after:h-[calc(100%-1rem)] after:w-0.5 after:rounded-full after:bg-accent after:content-['']";
        return (
          <div
            key={item.symbol}
            draggable={canReorder}
            tabIndex={canReorder ? 0 : -1}
            aria-roledescription={canReorder ? "sortable card" : undefined}
            aria-label={
              canReorder
                ? `${item.symbol}. Hold Ctrl or Cmd and press the arrow keys to move this card.`
                : undefined
            }
            onDragStart={(e) => {
              enterDepth.current = 0;
              setDragging(item.symbol);
              e.dataTransfer.effectAllowed = "move";
              // Firefox will not begin a drag without payload.
              e.dataTransfer.setData("text/plain", item.symbol);
            }}
            onDragEnter={() => {
              enterDepth.current += 1;
            }}
            onDragOver={(e) => {
              if (!dragging || dragging === item.symbol) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const rect = e.currentTarget.getBoundingClientRect();
              const side: DropSide = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
              if (target?.symbol !== item.symbol || target?.side !== side) {
                setTarget({ symbol: item.symbol, side });
              }
            }}
            onDragLeave={() => {
              enterDepth.current = Math.max(0, enterDepth.current - 1);
              if (enterDepth.current === 0) setTarget(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging && dragging !== item.symbol) {
                commit(dragging, item.symbol, target?.symbol === item.symbol ? target.side : "before");
              }
              reset();
            }}
            onKeyDown={(e) => onKeyDown(e, item.symbol)}
            className={[
              "relative rounded-2xl outline-none transition",
              canReorder ? "cursor-grab active:cursor-grabbing" : "",
              isDragging ? "opacity-30" : "",
              isTarget ? marker : "",
              canReorder ? "focus-visible:ring-2 focus-visible:ring-accent/60" : "",
            ].join(" ")}
          >
            {renderItem(item)}
          </div>
        );
      })}
    </div>
  );
}

// Re-exported so callers have one import for the feature.
export { applyOrder, moveTo, dropIndex } from "./order";
export type { DropSide, LayoutSymbol } from "./order";