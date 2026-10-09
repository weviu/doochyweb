import { type ReactNode } from "react";
import { LogOut, RefreshCw, Settings } from "lucide-react";

import { Button } from "./components/ui";

// Top-level shell: brand, primary navigation, and the account-level actions
// (settings / sign out). Both the trading view and the Analysis page render
// inside it, so switching between them never remounts the chrome.
//
// The header used to live inside Dashboard; it was lifted here so a second
// top-level view could share it.

export type ViewKey = "trading" | "analysis";

const NAV: { key: ViewKey; label: string }[] = [
  { key: "trading", label: "Trading" },
  { key: "analysis", label: "Analysis" },
];

export function AppShell({
  view,
  onViewChange,
  onRefresh,
  onOpenSettings,
  onLogout,
  children,
}: {
  view: ViewKey;
  onViewChange: (v: ViewKey) => void;
  // Optional view-level refresh. Omitted for views that own their own refresh
  // control (the Analysis page has one in its toolbar).
  onRefresh?: () => Promise<void> | void;
  onOpenSettings: () => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas text-fg">
      <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <div className="shrink-0 text-base font-semibold tracking-tight">DoochyWeb</div>

          <nav className="flex min-w-0 flex-1 items-center gap-1" aria-label="Primary">
            {NAV.map((n) => (
              <button
                key={n.key}
                type="button"
                onClick={() => onViewChange(n.key)}
                aria-current={view === n.key ? "page" : undefined}
                className={
                  "rounded-md px-3 py-1.5 text-sm font-medium transition " +
                  (view === n.key
                    ? "bg-surface-hover text-fg"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg")
                }
              >
                {n.label}
              </button>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1">
            {onRefresh && (
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw className="h-4 w-4" />}
                onClickAsync={async () => {
                  await onRefresh();
                }}
                aria-label="Refresh balances"
                title="Refresh balances"
              />
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={<Settings className="h-4 w-4" />}
              onClick={onOpenSettings}
              aria-label="Settings"
              title="Settings"
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<LogOut className="h-4 w-4" />}
              onClick={onLogout}
              aria-label="Sign out"
              title="Sign out"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

export default AppShell;