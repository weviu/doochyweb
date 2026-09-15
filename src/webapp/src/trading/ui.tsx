import type { ReactNode } from "react";
import { AnimatedModal } from "../components/Modal";
import { inputCls } from "../components/ui";

export function num(s: string): number | null {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) ? n : null;
}

export function posNum(s: string): number | null {
  const n = num(s);
  return n != null && n > 0 ? n : null;
}

export const ModalShell = AnimatedModal;

export { ConfirmModal } from "../components/Modal";

// A segmented control: BUY/SELL / MARKET/LIMIT/STOP toggles. `tone` turns the
// selected option saturated green/red - the one place that earns its keep.
export function Seg({
  value,
  onChange,
  options,
  tone = false,
}: {
  value: string;
  onChange: (v: any) => void;
  options: Array<{ value: string; label: string }>;
  tone?: boolean;
}) {
  return (
    <div className="grid grid-flow-col auto-cols-fr gap-0.5 rounded-md border border-hairline bg-surface p-0.5">
      {options.map((o) => {
        const on = value === o.value;
        let cls =
          "rounded border px-2 py-1.5 text-sm font-medium transition select-none " +
          (on ? "h-8" : "h-8");
        if (on) {
          if (tone) {
            cls +=
              o.value === "BUY"
                ? " border-success bg-success-soft text-success"
                : " border-danger bg-danger-soft text-danger";
          } else {
            cls += " border-accent/60 bg-surface-active text-accent";
          }
        } else {
          cls += " border-transparent bg-transparent text-fg-muted hover:bg-surface-hover hover:text-fg";
        }
        return (
          <button key={o.value} type="button" className={cls} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function TicketField({
  label,
  value,
  onChange,
  placeholder,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-fg-muted">{label}</label>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${inputCls} tabular-nums ${suffix ? "pr-10" : ""}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-faint">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

export function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="mb-2 block text-sm font-medium text-fg-muted">{label}</span>
      {children}
    </div>
  );
}