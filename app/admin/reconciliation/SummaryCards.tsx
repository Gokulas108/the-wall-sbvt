"use client";

import type { ReconciliationSummary } from "@/lib/reconciliation/summary";
import { formatPaise } from "@/lib/reconciliation/format";

function Metric({
  label,
  value,
  sub,
  tone = "default",
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "warn" | "bad";
  onClick?: () => void;
}) {
  const accent =
    tone === "good"
      ? "before:bg-green-400"
      : tone === "warn"
        ? "before:bg-amber-400"
        : tone === "bad"
          ? "before:bg-red-400"
          : "before:bg-gray-200";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`relative flex flex-col items-start gap-0.5 overflow-hidden rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-left shadow-sm transition before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-[''] hover:border-gray-300 hover:shadow-md ${accent} ${
        onClick ? "cursor-pointer" : "cursor-default"
      }`}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-lg font-bold leading-tight tabular-nums text-gray-900">{value}</span>
      {sub && <span className="text-[11px] leading-tight text-gray-400">{sub}</span>}
    </button>
  );
}

export function SummaryCards({
  summary,
  onOpenWorkbench,
}: {
  summary: ReconciliationSummary;
  onOpenWorkbench: () => void;
}) {
  const s = summary;
  const goalPct = s.goalPaise > 0 ? Math.min(100, (s.receivedGrossPaise / s.goalPaise) * 100) : 0;
  // Electronic (non-cash) received: total received minus settled cash.
  const gatewayUpiPaise = s.receivedGrossPaise - s.cashSettledPaise;

  return (
    <div className="flex flex-col gap-4">
      {/* Donation-type split */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="relative col-span-1 overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-4 shadow-sm lg:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Wall of Legacy</span>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900">
                {formatPaise(s.wallOfLegacy.receivedPaise)}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                received of {formatPaise(s.wallOfLegacy.expectedPaise)} expected
                {s.wallOfLegacy.pledgedPaise > 0 && ` · ${formatPaise(s.wallOfLegacy.pledgedPaise)} pledged`}
              </p>
            </div>
            <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold text-indigo-700 shadow-sm">
              {s.wallOfLegacy.count.toLocaleString("en-IN")} donors
            </span>
          </div>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-[11px] text-gray-500">
              <span>Goal progress</span>
              <span className="tabular-nums">
                {formatPaise(s.receivedGrossPaise)} / {formatPaise(s.goalPaise)} · {goalPct.toFixed(1)}%
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-indigo-100">
              <div className="h-2.5 rounded-full bg-indigo-600 transition-all" style={{ width: `${goalPct}%` }} />
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-teal-600">General Donations</span>
            <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold text-teal-700 shadow-sm">
              {s.general.count.toLocaleString("en-IN")} donors
            </span>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold tabular-nums text-gray-900">{formatPaise(s.general.receivedPaise)}</div>
            <p className="mt-1 text-xs text-gray-500">birnagar donation page · no block / qty</p>
          </div>
        </div>
      </div>

      {/* Money metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Gateway + UPI" value={formatPaise(gatewayUpiPaise)} tone="good" />
        <Metric label="Cash collected" value={formatPaise(s.cashCollectedPaise)} sub={`${formatPaise(s.cashSettledPaise)} settled`} />
        <Metric label="Pledged" value={formatPaise(s.pledgedPaise)} />
        <Metric label="Surplus" value={formatPaise(s.surplusPaise)} />
        <Metric label="Shortfall" value={formatPaise(s.shortfallPaise)} tone={s.shortfallPaise > 0 ? "warn" : "default"} />
        <Metric label="Orphan money" value={formatPaise(s.orphanPaise)} sub={`${s.orphanCount} txns · open →`} tone={s.orphanPaise > 0 ? "bad" : "default"} onClick={onOpenWorkbench} />
      </div>
    </div>
  );
}
