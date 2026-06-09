import type { ReactNode } from "react";
import { IconMonitor } from "./icons";

// The reconciliation console is a dense, multi-column desktop tool (ledger tables,
// match workbench, side-by-side breakdowns) that isn't usable on a phone. Rather than
// ship a cramped mobile layout, we gate the whole surface — login included — behind a
// CSS breakpoint. Pure CSS (no matchMedia/JS) keeps this SSR-safe with no hydration
// flash: below `lg` the notice shows and the app is `hidden`; at `lg`+ it's the reverse.
export function DesktopOnly({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-6 text-center text-gray-700 lg:hidden">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
          <IconMonitor width={28} height={28} />
        </span>
        <h1 className="text-lg font-semibold text-gray-900">Open on a desktop</h1>
        <p className="max-w-xs text-sm text-gray-500">
          The Donor Care &amp; Accounts console is built for a larger screen. Please open this
          page on a desktop or laptop to continue.
        </p>
      </div>
      {/* `lg:contents` keeps this wrapper out of the layout so the app's own flex shell is unaffected. */}
      <div className="hidden lg:contents">{children}</div>
    </>
  );
}
