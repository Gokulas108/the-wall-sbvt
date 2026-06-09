"use client";

import { useCallback, useEffect, useState } from "react";
import { formatPaiseExact } from "@/lib/reconciliation/format";

const PAGE_SIZE = 25;

interface Orphan {
  matchId: number;
  kind: "gateway" | "upi";
  gatewayTxnId: number | null;
  upiTxnId: number | null;
  reference: string;
  amountPaise: number;
  payerName: string | null;
  phone: string | null;
  date: string | null;
  isRefund: boolean;
  note: string | null;
  abandoned: string | null;
}

export function MatchWorkbench({ onOpenRow }: { onOpenRow: (matchId: number) => void }) {
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const loadOrphans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/reconciliation/orphans", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setOrphans(json.orphans ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrphans();
  }, [loadOrphans]);

  const totalPaise = orphans.reduce((sum, o) => sum + o.amountPaise, 0);
  const totalPages = Math.max(1, Math.ceil(orphans.length / PAGE_SIZE));

  // Clamp the page if the orphan list shrinks under us (e.g. after a refresh resolves rows).
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageOrphans = orphans.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Orphan money</h2>
        <span className="text-xs text-gray-400">· successful payments with no donor</span>
        {orphans.length > 0 && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            {orphans.length} · {formatPaiseExact(totalPaise)}
          </span>
        )}
        <button
          onClick={() => void loadOrphans()}
          disabled={loading}
          className="ml-auto rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="border-b border-gray-200 bg-gray-50/70 text-left text-[10px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Payer</th>
              <th className="px-3 py-2">Reference</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Flags</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && orphans.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                  No orphan transactions — every CSV payment is attributed to a donor.
                </td>
              </tr>
            )}
            {!loading &&
              pageOrphans.map((o) => (
                <tr
                  key={o.matchId}
                  onClick={() => onOpenRow(o.matchId)}
                  title="View transaction detail"
                  className="cursor-pointer hover:bg-indigo-50/60"
                >
                  <td className="px-3 py-1.5">
                    <span className="inline-block rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-600">
                      {o.kind}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="font-medium text-gray-800">{o.payerName || "Unknown"}</div>
                    <div className="text-[10px] text-gray-400">{o.phone || ""}</div>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-gray-500">{o.reference}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-gray-900">
                    {formatPaiseExact(o.amountPaise)}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {o.isRefund && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-medium text-red-700">
                          refund
                        </span>
                      )}
                      {o.abandoned && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                          abandoned: {o.abandoned}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-[10px] text-gray-500">{o.date?.slice(0, 10) || "—"}</td>
                  <td className="px-3 py-1.5 text-right">
                    <span className="text-gray-400" aria-hidden>
                      ›
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {!loading && orphans.length > 0 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            {orphans.length} orphan{orphans.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 font-medium hover:bg-gray-50 disabled:opacity-40"
            >
              Prev
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 font-medium hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
