"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { ReconciliationSummary, DonationsByDayRow } from "@/lib/reconciliation/summary";
import { formatPaise, STATUS_LABEL, statusBadgeClass } from "@/lib/reconciliation/format";
import { ALL_STATUSES } from "@/lib/reconciliation/engine";
import { IconWarning, IconCheck } from "./icons";

// Solid fill colours for the inline share bars (the badge classes are too light to read as a bar).
const STATUS_BAR: Record<string, string> = {
  MATCHED: "bg-green-500",
  OVERPAID: "bg-emerald-500",
  UNDERPAID: "bg-amber-500",
  UNVERIFIED: "bg-yellow-500",
  CASH: "bg-sky-500",
  SETTLEMENT: "bg-cyan-500",
  PLEDGE: "bg-violet-500",
  FAILED_REFUNDED: "bg-red-500",
  ORPHAN: "bg-orange-500",
  AMBIGUOUS: "bg-rose-500",
};

// Statuses that represent money actually received (used for the "paid" count / avg gift).
const RECEIVED_STATUSES = new Set(["MATCHED", "OVERPAID", "UNDERPAID", "CASH"]);

// Channel → statement label + colour for the "Statements to upload" chips. Gateway
// (online) is indigo, UPI is violet — matching the donation-channel palette.
const CSV_KIND_SHORT: Record<string, string> = { gateway: "Gateway", upi: "UPI" };
const CSV_KIND_CHIP: Record<string, string> = {
  gateway: "border-indigo-200 bg-indigo-50 text-indigo-700",
  upi: "border-violet-200 bg-violet-50 text-violet-700",
};

const MS_PER_DAY = 86_400_000;

// "2026-01-05" → "05 Jan 2026". Parsed/rendered in UTC so the day matches how the
// statement window was computed server-side (engine compares raw ISO instants).
function formatDay(day: string): string {
  return new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ── Shared chrome ──────────────────────────────────────────────────────────────

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="h-3.5 w-1 rounded-full bg-indigo-400" aria-hidden />
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
    </div>
  );
}

// A titled dashboard card: header strip (title + hint + optional icon / right slot)
// over a body that flex-fills, so cards in a side-by-side grid align to equal height.
function Panel({
  title,
  hint,
  icon,
  right,
  tone = "default",
  className = "",
  bodyClassName = "",
  children,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  right?: ReactNode;
  tone?: "default" | "warn";
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const warn = tone === "warn";
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm ${
        warn ? "border-amber-300" : "border-gray-200"
      } ${className}`}
    >
      <div
        className={`flex items-center justify-between gap-2 border-b px-4 py-2.5 ${
          warn ? "border-amber-100 bg-amber-50" : "border-gray-100 bg-gray-50/70"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h2 className="truncate text-sm font-semibold text-gray-800">{title}</h2>
          {hint && <span className="hidden text-[11px] font-normal text-gray-400 sm:inline">{hint}</span>}
        </div>
        {right}
      </div>
      <div className={`flex-1 ${bodyClassName}`}>{children}</div>
    </div>
  );
}

// Colour code for each KPI tile: a left accent bar + a tinted label, keyed by tone.
type FigureTone = "neutral" | "indigo" | "good" | "sky" | "amber" | "bad";
const FIGURE_TONE: Record<FigureTone, { accent: string; label: string }> = {
  neutral: { accent: "before:bg-gray-300", label: "text-gray-500" },
  indigo: { accent: "before:bg-indigo-500", label: "text-indigo-600" },
  good: { accent: "before:bg-emerald-500", label: "text-emerald-600" },
  sky: { accent: "before:bg-sky-500", label: "text-sky-600" },
  amber: { accent: "before:bg-amber-500", label: "text-amber-600" },
  bad: { accent: "before:bg-red-500", label: "text-red-600" },
};

function Figure({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: FigureTone;
}) {
  const c = FIGURE_TONE[tone];
  return (
    <div
      className={`relative flex flex-col gap-0.5 overflow-hidden rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-[''] ${c.accent}`}
    >
      <span className={`text-[10px] font-medium uppercase tracking-wide ${c.label}`}>{label}</span>
      <span className="text-xl font-bold leading-tight tabular-nums text-gray-900">{value}</span>
      {sub && <span className="text-[11px] leading-tight text-gray-400">{sub}</span>}
    </div>
  );
}

function ShareBar({ value, total, colorClass }: { value: number; total: number; colorClass: string }) {
  const p = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${p}%` }} />
      </div>
      <span className="w-11 text-right tabular-nums text-gray-500">{p.toFixed(1)}%</span>
    </div>
  );
}

function Variance({ paise }: { paise: number }) {
  if (paise === 0) return <span className="text-gray-300">—</span>;
  return (
    <span className={paise > 0 ? "text-emerald-700" : "text-red-700"}>
      {paise > 0 ? "+" : ""}
      {formatPaise(paise)}
    </span>
  );
}

// ── Sections ─────────────────────────────────────────────────────────────────

// Count & money per reconciliation status. Left column of the overview's top row.
function StatusDistribution({ summary }: { summary: ReconciliationSummary }) {
  const s = summary;
  const total = s.totalContributions;
  const statusRows = ALL_STATUSES.map((st) => ({ st, row: s.statusBreakdown[st] })).filter(
    ({ row }) => row && row.count > 0,
  );
  const totals = statusRows.reduce(
    (acc, { row }) => ({
      count: acc.count + row.count,
      expectedPaise: acc.expectedPaise + row.expectedPaise,
      matchedPaise: acc.matchedPaise + row.matchedPaise,
      variancePaise: acc.variancePaise + row.variancePaise,
    }),
    { count: 0, expectedPaise: 0, matchedPaise: 0, variancePaise: 0 },
  );

  return (
    <Panel
      title="Status distribution"
      hint="count & money per status"
      className="lg:col-span-3"
      bodyClassName="overflow-x-auto"
    >
      <table className="min-w-full divide-y divide-gray-100 text-xs">
        <thead className="bg-white text-left text-[10px] uppercase tracking-wide text-gray-400">
          <tr>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5 text-right">Count</th>
            <th className="px-4 py-2.5 text-right">Share</th>
            <th className="px-4 py-2.5 text-right">Expected</th>
            <th className="px-4 py-2.5 text-right">Received</th>
            <th className="px-4 py-2.5 text-right">Variance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {statusRows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                No contributions yet — run a reconciliation.
              </td>
            </tr>
          )}
          {statusRows.map(({ st, row }) => (
            <tr key={st} className="transition-colors hover:bg-gray-50/70">
              <td className="px-4 py-2">
                <span className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass(st)}`}>
                  {STATUS_LABEL[st] ?? st}
                </span>
              </td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-900">{row.count.toLocaleString("en-IN")}</td>
              <td className="px-4 py-2">
                <ShareBar value={row.count} total={total} colorClass={STATUS_BAR[st] ?? "bg-gray-400"} />
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-600">{formatPaise(row.expectedPaise)}</td>
              <td className="px-4 py-2 text-right font-medium tabular-nums text-gray-900">{formatPaise(row.matchedPaise)}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                <Variance paise={row.variancePaise} />
              </td>
            </tr>
          ))}
        </tbody>
        {statusRows.length > 0 && (
          <tfoot className="border-t border-gray-200 bg-gray-50/80 font-semibold text-gray-700">
            <tr>
              <td className="px-4 py-2.5">Total</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{totals.count.toLocaleString("en-IN")}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">100%</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(totals.expectedPaise)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(totals.matchedPaise)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                <Variance paise={totals.variancePaise} />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </Panel>
  );
}

// UNVERIFIED payments grouped into the statement date ranges that would clear them.
// A list with colour-coded channel chips; right column of the overview's top row.
function StatementsPanel({ summary }: { summary: ReconciliationSummary }) {
  const s = summary;
  const pending = s.csvUploadsNeeded.length > 0;
  const hasManual = s.unverifiedNeedsManual.count > 0;
  const pendingCount = s.csvUploadsNeeded.reduce((a, n) => a + n.count, 0);
  const pendingPaise = s.csvUploadsNeeded.reduce((a, n) => a + n.expectedPaise, 0);

  const manualNote =
    s.unverifiedNeedsManual.count === 1
      ? `1 other unverified payment (${formatPaise(s.unverifiedNeedsManual.expectedPaise)}) can't be matched by uploading a statement — its reference is missing, or wasn't found in the statements already loaded.`
      : `${s.unverifiedNeedsManual.count.toLocaleString("en-IN")} other unverified payments (${formatPaise(
          s.unverifiedNeedsManual.expectedPaise,
        )}) can't be matched by uploading a statement — their references are missing, or weren't found in the statements already loaded.`;

  return (
    <Panel
      title="Statements to upload"
      hint="date ranges to clear unverified payments"
      tone={pending ? "warn" : "default"}
      icon={
        pending ? (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <IconWarning width={12} height={12} className="text-amber-600" />
          </span>
        ) : (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100">
            <IconCheck width={12} height={12} className="text-green-600" />
          </span>
        )
      }
      right={
        pending ? (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-700">
            {pendingCount.toLocaleString("en-IN")} · {formatPaise(pendingPaise)}
          </span>
        ) : undefined
      }
      className="lg:col-span-2"
      bodyClassName="flex flex-col"
    >
      {pending ? (
        <ul className="divide-y divide-gray-50">
          {s.csvUploadsNeeded.map((need) => (
            <Fragment key={need.channel}>
              {need.ranges.map((r, i) => (
                <li
                  key={`${need.channel}-${i}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs transition-colors hover:bg-amber-50/40"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${CSV_KIND_CHIP[need.kind] ?? "border-gray-200 bg-gray-50 text-gray-600"}`}>
                      {CSV_KIND_SHORT[need.kind] ?? need.kind}
                    </span>
                    <span className="truncate font-medium tabular-nums text-gray-800">
                      {r.start === r.end ? formatDay(r.start) : `${formatDay(r.start)} – ${formatDay(r.end)}`}
                    </span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap">
                    <span className="font-semibold tabular-nums text-gray-900">{formatPaise(r.expectedPaise)}</span>
                    <span className="ml-1.5 tabular-nums text-gray-400">· {r.count.toLocaleString("en-IN")} txns</span>
                  </span>
                </li>
              ))}
              {need.undatedCount > 0 && (
                <li className="flex items-center gap-2 px-4 py-1.5 text-[11px] text-gray-400">
                  <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold opacity-60 ${CSV_KIND_CHIP[need.kind] ?? "border-gray-200 bg-gray-50 text-gray-600"}`}>
                    {CSV_KIND_SHORT[need.kind] ?? need.kind}
                  </span>
                  + {need.undatedCount.toLocaleString("en-IN")} with no recorded date
                </li>
              )}
            </Fragment>
          ))}
        </ul>
      ) : (
        <div className="flex flex-1 items-center px-4 py-5 text-xs text-green-700">
          {hasManual ? "No statements left to upload." : "All donations reconciled — nothing to upload."}
        </div>
      )}

      {hasManual && (
        <p className="mt-auto border-t border-gray-100 bg-gray-50/40 px-4 py-2.5 text-[11px] leading-relaxed text-gray-500">
          {manualNote}
        </p>
      )}
    </Panel>
  );
}

// Geometry for the line chart (user units == pixels; width is measured at runtime).
const CHART_H = 208;
const CHART_PAD = { t: 14, r: 10, b: 24, l: 10 };
const METRIC_COLOR = {
  count: { stroke: "#6366f1", grad: "donGradCount" }, // indigo
  amount: { stroke: "#10b981", grad: "donGradAmount" }, // emerald
} as const;

// Daily donation activity as an interactive, dependency-free SVG line chart. Toggles
// between donation count and received money; hovering snaps a guide + dot to the nearest
// day and shows a tooltip. Gaps between active days are filled with zero so the time
// axis is continuous (capped at ~1 year of points to stay legible).
function DonationsOverTime({ data }: { data: DonationsByDayRow[] }) {
  const [metric, setMetric] = useState<"count" | "amount">("count");
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const series = useMemo<DonationsByDayRow[]>(() => {
    if (data.length === 0) return [];
    const idxOf = (d: string) => Math.floor(Date.parse(d + "T00:00:00Z") / MS_PER_DAY);
    const start = idxOf(data[0].day);
    const end = idxOf(data[data.length - 1].day);
    // Sparse fallback for very long campaigns — don't synthesize hundreds of points.
    if (end - start > 366) return data;
    const byDay = new Map(data.map((d) => [d.day, d]));
    const out: DonationsByDayRow[] = [];
    for (let i = start; i <= end; i++) {
      const day = new Date(i * MS_PER_DAY).toISOString().slice(0, 10);
      const hit = byDay.get(day);
      out.push({ day, count: hit?.count ?? 0, receivedPaise: hit?.receivedPaise ?? 0 });
    }
    return out;
  }, [data]);

  const valueOf = (d: DonationsByDayRow) => (metric === "count" ? d.count : d.receivedPaise);
  const n = series.length;
  const max = series.reduce((m, d) => Math.max(m, valueOf(d)), 0);
  const totalCount = data.reduce((a, d) => a + d.count, 0);
  const totalPaise = data.reduce((a, d) => a + d.receivedPaise, 0);
  const color = METRIC_COLOR[metric];

  const plotW = Math.max(0, width - CHART_PAD.l - CHART_PAD.r);
  const plotH = CHART_H - CHART_PAD.t - CHART_PAD.b;
  const baseY = CHART_PAD.t + plotH;
  const xAt = (i: number) => (n <= 1 ? CHART_PAD.l + plotW / 2 : CHART_PAD.l + (i / (n - 1)) * plotW);
  const yAt = (v: number) => (max > 0 ? CHART_PAD.t + (1 - v / max) * plotH : baseY);

  const linePath = series.map((d, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)},${yAt(valueOf(d)).toFixed(1)}`).join(" ");
  const areaPath = n >= 2 ? `${linePath} L ${xAt(n - 1).toFixed(1)},${baseY} L ${xAt(0).toFixed(1)},${baseY} Z` : "";

  const toggleClass = (value: "count" | "amount") =>
    `rounded-md px-2.5 py-1 transition-colors ${
      metric === value ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
    }`;

  const onMove = (e: MouseEvent) => {
    if (n === 0 || !wrapRef.current) return;
    const px = e.clientX - wrapRef.current.getBoundingClientRect().left;
    const frac = plotW > 0 ? (px - CHART_PAD.l) / plotW : 0;
    setHover(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))));
  };

  const active = hover != null && hover < n ? series[hover] : null;
  const hx = hover != null ? xAt(hover) : 0;
  const tooltipLeft = Math.max(74, Math.min(width - 74, hx));

  return (
    <Panel
      title="Donations over time"
      hint="by day · excludes cash settlements"
      bodyClassName="p-4"
      right={
        <div className="inline-flex shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-[11px] font-medium">
          <button type="button" onClick={() => setMetric("count")} className={toggleClass("count")}>
            Donations
          </button>
          <button type="button" onClick={() => setMetric("amount")} className={toggleClass("amount")}>
            Received
          </button>
        </div>
      }
    >
      {n === 0 ? (
        <p className="py-10 text-center text-xs text-gray-400">No dated donations yet.</p>
      ) : (
        <>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-gray-400">
            <span>peak {metric === "count" ? `${max.toLocaleString("en-IN")} donations` : formatPaise(max)}</span>
            <span className="font-medium text-gray-500">
              {metric === "count" ? `${totalCount.toLocaleString("en-IN")} donations` : formatPaise(totalPaise)} total
            </span>
          </div>

          <div
            ref={wrapRef}
            className="relative w-full"
            style={{ height: CHART_H }}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            {width > 0 && (
              <svg width={width} height={CHART_H} className="block overflow-visible">
                <defs>
                  <linearGradient id={color.grad} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color.stroke} stopOpacity="0.22" />
                    <stop offset="100%" stopColor={color.stroke} stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* horizontal gridlines */}
                {[0, 0.5, 1].map((t) => (
                  <line
                    key={t}
                    x1={CHART_PAD.l}
                    x2={width - CHART_PAD.r}
                    y1={CHART_PAD.t + t * plotH}
                    y2={CHART_PAD.t + t * plotH}
                    stroke="#f1f5f9"
                    strokeWidth={1}
                  />
                ))}

                {areaPath && <path d={areaPath} fill={`url(#${color.grad})`} />}
                {n >= 2 && (
                  <path d={linePath} fill="none" stroke={color.stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                )}

                {/* hover guide + active point */}
                {active && (
                  <>
                    <line x1={hx} x2={hx} y1={CHART_PAD.t} y2={baseY} stroke={color.stroke} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
                    <circle cx={hx} cy={yAt(valueOf(active))} r={6} fill={color.stroke} opacity={0.18} />
                    <circle cx={hx} cy={yAt(valueOf(active))} r={3.5} fill="#fff" stroke={color.stroke} strokeWidth={2} />
                  </>
                )}
                {/* single-day datasets have no line — show the lone point */}
                {n === 1 && <circle cx={xAt(0)} cy={yAt(valueOf(series[0]))} r={3.5} fill={color.stroke} />}
              </svg>
            )}

            {active && (
              <div
                className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] shadow-lg"
                style={{ left: tooltipLeft }}
              >
                <div className="mb-0.5 font-semibold text-gray-800">{formatDay(active.day)}</div>
                <div className={`flex items-center gap-1.5 ${metric === "count" ? "font-semibold text-gray-900" : "text-gray-400"}`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                  {active.count.toLocaleString("en-IN")} donations
                </div>
                <div className={`flex items-center gap-1.5 ${metric === "amount" ? "font-semibold text-gray-900" : "text-gray-400"}`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {formatPaise(active.receivedPaise)} received
                </div>
              </div>
            )}
          </div>

          <div className="mt-1.5 flex justify-between text-[10px] text-gray-400">
            <span>{formatDay(series[0].day)}</span>
            <span>{formatDay(series[n - 1].day)}</span>
          </div>
        </>
      )}
    </Panel>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function OverviewStats({
  summary,
  awaitingReplyCount,
}: {
  summary: ReconciliationSummary;
  awaitingReplyCount: number | null;
}) {
  const s = summary;
  const total = s.totalContributions;

  // Donors who actually paid (shown as the Contributions sub-figure).
  const paidCount = ALL_STATUSES.filter((st) => RECEIVED_STATUSES.has(st)).reduce(
    (acc, st) => acc + (s.statusBreakdown[st]?.count ?? 0),
    0,
  );
  const goalPct = s.goalPaise > 0 ? (s.receivedGrossPaise / s.goalPaise) * 100 : 0;
  const needsAttention =
    (s.statusBreakdown.UNVERIFIED?.count ?? 0) +
    (s.statusBreakdown.AMBIGUOUS?.count ?? 0) +
    s.orphanCount;

  return (
    <div className="flex flex-col gap-6">
      {/* Key figures */}
      <section className="flex flex-col gap-3">
        <SectionHeader title="Key figures" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Figure label="Contributions" value={total.toLocaleString("en-IN")} sub={`${paidCount.toLocaleString("en-IN")} paid`} tone="indigo" />
          <Figure label="Received" value={formatPaise(s.receivedGrossPaise)} sub={`${goalPct.toFixed(1)}% of goal`} tone="good" />
          <Figure label="No reply 24h+" value={(awaitingReplyCount ?? 0).toLocaleString("en-IN")} sub="WoL messaged, awaiting reply" tone={(awaitingReplyCount ?? 0) > 0 ? "amber" : "neutral"} />
          <Figure label="Receipt-eligible" value={s.receiptsReady.pending.toLocaleString("en-IN")} sub="ready for generation for treasury" tone="good" />
          <Figure label="Needs attention" value={needsAttention.toLocaleString("en-IN")} sub="unverified · ambiguous · orphan" tone={needsAttention > 0 ? "amber" : "neutral"} />
        </div>
      </section>

      {/* Status distribution + Statements to upload, side by side. Each panel carries
          its own title, so no extra section header is needed. */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-5">
        <StatusDistribution summary={s} />
        <StatementsPanel summary={s} />
      </div>

      {/* Donations over time (replaces the old payment-channel table). */}
      <DonationsOverTime data={s.donationsByDay} />
    </div>
  );
}
