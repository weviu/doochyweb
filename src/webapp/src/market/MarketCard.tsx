import { memo } from "react";
import { RefreshCw, X } from "lucide-react";

import { Badge, Card, Skeleton } from "../components/ui";
import { RatingDial } from "./RatingDial";
import { Sparkline } from "./Sparkline";
import {
  changeTone,
  fmtChangePct,
  fmtPrice,
  providerName,
  ratingColor,
  ratingLabel,
  timeAgo,
} from "./ratings";
import type { MarketAnalysis, Section } from "./types";

// Card action handlers take the symbol rather than a per-card closure. That
// keeps their identity stable across renders, which is what lets the memo()
// below actually skip work - the grid re-renders on the refresh countdown, and
// rebuilding nine dial + sparkline SVGs every second is what made the cards
// feel sluggish.
interface CardProps {
  analysis: MarketAnalysis;
  strongRatio: number;
  refreshing: boolean;
  onOpen: (symbol: string) => void;
  onRefresh: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}

function SourceBadge({ a }: { a: MarketAnalysis }) {
  if (a.simulated) {
    return (
      <Badge tone="danger">
        <span className="h-1.5 w-1.5 rounded-full bg-danger" />
        Simulated
      </Badge>
    );
  }
  const label = a.proxy ? `${providerName(a.provider)} · ${a.proxy}` : providerName(a.provider);
  return (
    <Badge tone="muted">
      <span className={"h-1.5 w-1.5 rounded-full " + (a.cached ? "bg-fg-faint" : "bg-amber-500")} />
      <span className="truncate">{label}</span>
    </Badge>
  );
}

function SubSummary({ title, section }: { title: string; section: Section }) {
  return (
    <div className="flex items-baseline justify-between gap-1 text-[11px]">
      <span className="truncate text-fg-faint">{title}</span>
      <span className="shrink-0">
        <span className="font-semibold" style={{ color: ratingColor(section.rating) }}>
          {ratingLabel(section.rating)}
        </span>
      </span>
    </div>
  );
}

function MarketCardInner({ analysis, strongRatio, refreshing, onOpen, onRefresh, onRemove }: CardProps) {
  const a = analysis;
  const color = ratingColor(a.summary.rating);
  const warningTitle = a.warnings?.length
    ? a.warnings.map((w) => `${w.provider}: ${w.message}`).join(" | ")
    : undefined;

  return (
    <Card
      interactive
      flat
      className={
        "relative flex flex-col gap-1.5 p-2.5 transition-opacity " + (refreshing ? "opacity-60" : "")
      }
    >
      {/* Whole-card click target, behind the content. */}
      <button
        type="button"
        onClick={() => onOpen(a.symbol)}
        className="absolute inset-0 rounded-lg"
        aria-label={`Open ${a.symbol} analysis`}
        title={warningTitle}
      />

      <div className="pointer-events-none relative flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="truncate text-xs font-semibold text-fg">{a.symbol}</span>
            <span className="rounded bg-surface-active px-1 py-px text-[9px] font-medium uppercase tracking-wide text-fg-muted">
              {a.type}
            </span>
          </div>
          <div className="truncate text-[11px] text-fg-faint" title={a.name}>
            {a.name}
          </div>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRefresh(a.symbol);
            }}
            disabled={refreshing}
            aria-label={`Refresh ${a.symbol}`}
            title={warningTitle ? `Refresh ${a.symbol} — ${warningTitle}` : `Refresh ${a.symbol}`}
            className="rounded p-1 text-fg-faint transition hover:bg-surface-hover hover:text-fg disabled:opacity-50"
          >
            <RefreshCw className={"h-3 w-3 " + (refreshing ? "animate-spin" : "")} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(a.symbol);
            }}
            aria-label={`Remove ${a.symbol}`}
            title={`Remove ${a.symbol}`}
            className="rounded p-1 text-fg-faint transition hover:bg-surface-hover hover:text-danger"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="pointer-events-none relative flex items-baseline gap-1.5">
        <span className="truncate text-base font-semibold tabular-nums text-fg">
          {fmtPrice(a.price)}
        </span>
        <span className={`shrink-0 text-[11px] font-medium tabular-nums ${changeTone(a.changePct)}`}>
          {fmtChangePct(a.changePct)}
        </span>
      </div>

      <div className="pointer-events-none relative -mx-0.5">
        <Sparkline values={a.sparkline} color={color} />
      </div>

      <div className="pointer-events-none relative mx-auto -my-0.5 w-full max-w-[150px]">
        <RatingDial score={a.summary.score} rating={a.summary.rating} strongRatio={strongRatio} size="sm" />
      </div>

      <div className="pointer-events-none relative truncate text-center text-xs font-semibold" style={{ color }}>
        {ratingLabel(a.summary.rating)}
      </div>

      <div className="pointer-events-none relative space-y-0.5 border-t border-hairline pt-1.5">
        <SubSummary title="Oscillators" section={a.oscillators} />
        <SubSummary title="Moving avgs" section={a.movingAverages} />
      </div>

      <div className="pointer-events-none relative mt-auto flex items-center justify-between gap-1 pt-1.5">
        <SourceBadge a={a} />
        <span className="shrink-0 text-[10px] text-fg-faint">{timeAgo(a.updatedAt)}</span>
      </div>
    </Card>
  );
}

export const MarketCard = memo(MarketCardInner);

export function MarketCardSkeleton() {
  return (
    <Card flat className="flex flex-col gap-2 p-2.5">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-3 w-full" />
    </Card>
  );
}

interface ErrorProps {
  symbol: string;
  error: string;
  refreshing: boolean;
  onRefresh: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}

function MarketCardErrorInner({ symbol, error, refreshing, onRefresh, onRemove }: ErrorProps) {
  return (
    <Card flat className="flex flex-col gap-1.5 border-danger/30 p-2.5">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-xs font-semibold text-fg">{symbol}</span>
        <span className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => onRefresh(symbol)}
            disabled={refreshing}
            aria-label={`Retry ${symbol}`}
            className="rounded p-1 text-fg-faint transition hover:bg-surface-hover hover:text-fg disabled:opacity-50"
          >
            <RefreshCw className={"h-3 w-3 " + (refreshing ? "animate-spin" : "")} />
          </button>
          <button
            type="button"
            onClick={() => onRemove(symbol)}
            aria-label={`Remove ${symbol}`}
            className="rounded p-1 text-fg-faint transition hover:bg-surface-hover hover:text-danger"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      </div>
      <p className="line-clamp-4 text-[11px] leading-relaxed text-fg-muted">{error}</p>
    </Card>
  );
}

export const MarketCardError = memo(MarketCardErrorInner);
