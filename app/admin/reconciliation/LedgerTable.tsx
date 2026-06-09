"use client";

import { useEffect, useState } from "react";
import type { LedgerRow } from "@/lib/reconciliation/ledger";
import {
  DONATION_TYPE_LABEL,
  formatPaiseExact,
  isMatchedStatus,
  STATUS_LABEL,
  statusBadgeClass,
} from "@/lib/reconciliation/format";

export interface LedgerFilterState {
  status: string[];
  channel: string | null;
  donationType: string[];
  q: string | null;
  blockId: string | null;
  from: string | null;
  to: string | null;
}

const CHANNELS = ["online", "upi", "cash", "none"];

function buildQuery(f: LedgerFilterState, page: number, pageSize: number): string {
  const sp = new URLSearchParams();
  if (f.status.length) sp.set("status", f.status.join(","));
  if (f.channel) sp.set("channel", f.channel);
  if (f.donationType.length) sp.set("donationType", f.donationType.join(","));
  if (f.q) sp.set("q", f.q);
  if (f.blockId) sp.set("blockId", f.blockId);
  if (f.from) sp.set("from", f.from);
  if (f.to) sp.set("to", f.to);
  sp.set("page", String(page));
  sp.set("pageSize", String(pageSize));
  return sp.toString();
}

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = typeof val === "object" ? JSON.stringify(val) : String(val);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function LedgerTable({
  rows,
  total,
  page,
  pageSize,
  filters,
  loading,
  onFilterChange,
  onPage,
  onOpenRow,
  resetKey,
}: {
  rows: LedgerRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: LedgerFilterState;
  loading: boolean;
  onFilterChange: (partial: Partial<LedgerFilterState>) => void;
  onPage: (page: number) => void;
  onOpenRow: (id: number) => void;
  resetKey: number;
}) {
  const [exporting, setExporting] = useState(false);
  // The ledger rows are client-fetched (useEffect in the shell), so the server has
  // no data to render. Gate the data table behind mount so SSR and the first client
  // render are identical (a static placeholder) — otherwise the pagination state
  // diverges from the server HTML and React reports a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const exportPageSize = 500;
      let p = 1;
      let all: Record<string, unknown>[] = [];
      // Loop pages until we've pulled `total` rows (same pattern as the DB exporter).
      for (;;) {
        const res = await fetch(
          `/api/admin/reconciliation/ledger/export?${buildQuery(filters, p, exportPageSize)}`,
        );
        if (!res.ok) throw new Error("export failed");
        const json = await res.json();
        all = all.concat(json.data ?? []);
        if (!json.data?.length || all.length >= (json.total ?? 0)) break;
        p += 1;
        if (p > 1000) break;
      }
      if (all.length === 0) {
        alert("No rows to export.");
        return;
      }
      const headers = Object.keys(all[0]);
      const csv = [
        headers.map(escapeCsv).join(","),
        ...all.map((row) => headers.map((h) => escapeCsv(row[h])).join(",")),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "reconciliation_ledger.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <input
          key={`q-${resetKey}`}
          type="text"
          placeholder="Search name / phone / reference / serial"
          defaultValue={filters.q ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") onFilterChange({ q: (e.target as HTMLInputElement).value || null });
          }}
          onBlur={(e) => onFilterChange({ q: e.target.value || null })}
          className="min-w-[220px] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <select
          value={filters.channel ?? ""}
          onChange={(e) => onFilterChange({ channel: e.target.value || null })}
          className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">All channels</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          key={`block-${resetKey}`}
          type="text"
          placeholder="Block"
          defaultValue={filters.blockId ?? ""}
          onBlur={(e) => onFilterChange({ blockId: e.target.value || null })}
          className="w-24 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <button
          onClick={handleExport}
          disabled={exporting}
          className="ml-auto rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      {!mounted ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-400 shadow-sm">
          Loading ledger…
        </div>
      ) : (
      <>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="border-b border-gray-200 bg-gray-50/70 text-left text-[10px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Type</th>
              <th className="px-2 py-2">Donor</th>
              <th className="px-2 py-2">Channel</th>
              <th className="px-2 py-2">Block / Serial</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2">Reference</th>
              <th className="px-2 py-2 text-right">Expected</th>
              <th className="px-2 py-2 text-right">Received</th>
              <th className="px-2 py-2 text-right">Variance</th>
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {loading && (
              <tr>
                <td colSpan={12} className="px-2 py-6 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={12} className="px-2 py-6 text-center text-gray-400">
                  No contributions match these filters.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => {
                // Clickable when the line was reconciled against a statement
                // (MATCHED / OVERPAID / UNDERPAID). Note: a row can be matched
                // without owning a match itself — one payment covering several
                // names attaches the match to the group's primary line — so we
                // gate on status, not on a direct match link.
                const clickable = isMatchedStatus(r.status);
                // General donations have no fixed expected target → show "—".
                const isGeneral = r.donationType === "general";
                return (
                <tr
                  key={r.id}
                  onClick={clickable ? () => onOpenRow(r.id) : undefined}
                  title={clickable ? "View transaction detail" : "No matched statement"}
                  className={clickable ? "cursor-pointer hover:bg-indigo-50/60" : "hover:bg-gray-50"}
                >
                  <td className="px-2 py-1.5">
                    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(r.status)}`}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                        r.donationType === "general"
                          ? "border-teal-200 bg-teal-50 text-teal-700"
                          : "border-indigo-200 bg-indigo-50 text-indigo-700"
                      }`}
                    >
                      {DONATION_TYPE_LABEL[r.donationType]}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="font-medium text-gray-800">{r.donorName || "—"}</div>
                    <div className="text-[10px] text-gray-400">{r.donorPhone || ""}</div>
                  </td>
                  <td className="px-2 py-1.5 text-gray-600">{r.paymentChannel}</td>
                  <td className="px-2 py-1.5 text-gray-600">
                    {r.blockId || "—"}
                    {r.serialNumber && <div className="text-[10px] text-gray-400">{r.serialNumber}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-600">{r.qty || ""}</td>
                  <td className="px-2 py-1.5 font-mono text-[10px] text-gray-500">{r.paymentReference || "—"}</td>
                  <td className="px-2 py-1.5 text-right text-gray-700">
                    {isGeneral ? "—" : formatPaiseExact(r.expectedPaise)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-medium text-gray-900">{formatPaiseExact(r.matchedPaise)}</td>
                  <td
                    className={`px-2 py-1.5 text-right ${
                      r.variancePaise > 0 ? "text-emerald-700" : r.variancePaise < 0 ? "text-red-700" : "text-gray-400"
                    }`}
                  >
                    {r.variancePaise === 0 ? "—" : formatPaiseExact(r.variancePaise)}
                  </td>
                  <td className="px-2 py-1.5 text-[10px] text-gray-500">{r.contributedAt?.slice(0, 10) || "—"}</td>
                  <td className="px-2 py-1.5 text-right">
                    {clickable && <span className="text-gray-400" aria-hidden>›</span>}
                  </td>
                </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          {total} contribution{total === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPage(Math.max(1, page - 1))}
            disabled={page <= 1 || loading}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 font-medium hover:bg-gray-50 disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            onClick={() => onPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || loading}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 font-medium hover:bg-gray-50 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
