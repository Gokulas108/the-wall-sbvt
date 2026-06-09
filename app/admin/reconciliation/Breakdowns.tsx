"use client";

import { useCallback, useEffect, useState } from "react";
import { formatPaise } from "@/lib/reconciliation/format";

type Tab = "volunteer" | "block" | "day";

interface VolunteerRow {
  volunteerId: number;
  username: string;
  count: number;
  expectedPaise: number;
  receivedPaise: number;
  cashCollectedPaise: number;
  cashSettledPaise: number;
  cashPendingPaise: number;
}
interface BlockRow {
  blockId: string;
  count: number;
  qty: number;
  expectedPaise: number;
  receivedPaise: number;
}
interface DayRow {
  day: string;
  count: number;
  expectedPaise: number;
  receivedPaise: number;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "volunteer", label: "Per volunteer" },
  { key: "block", label: "Per block" },
  { key: "day", label: "Per day" },
];

export function Breakdowns({ refreshKey }: { refreshKey?: number }) {
  const [tab, setTab] = useState<Tab>("volunteer");
  const [rows, setRows] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (which: Tab) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/reconciliation/breakdowns?by=${which}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setRows(json.rows ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [tab, refreshKey, load]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              tab === t.key ? "bg-indigo-600 text-white" : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          {tab === "volunteer" && (
            <>
              <thead className="border-b border-gray-200 bg-gray-50/70 text-left text-[10px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-2 py-2">Volunteer</th>
                  <th className="px-2 py-2 text-right">Lines</th>
                  <th className="px-2 py-2 text-right">Expected</th>
                  <th className="px-2 py-2 text-right">Verified</th>
                  <th className="px-2 py-2 text-right">Cash collected</th>
                  <th className="px-2 py-2 text-right">Settled</th>
                  <th className="px-2 py-2 text-right">Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {(rows as VolunteerRow[]).map((r) => (
                  <tr key={r.volunteerId} className="hover:bg-gray-50">
                    <td className="px-2 py-1.5 font-medium text-gray-800">{r.username}</td>
                    <td className="px-2 py-1.5 text-right text-gray-600">{r.count}</td>
                    <td className="px-2 py-1.5 text-right text-gray-700">{formatPaise(r.expectedPaise)}</td>
                    <td className="px-2 py-1.5 text-right font-medium text-gray-900">{formatPaise(r.receivedPaise)}</td>
                    <td className="px-2 py-1.5 text-right text-gray-600">{formatPaise(r.cashCollectedPaise)}</td>
                    <td className="px-2 py-1.5 text-right text-gray-600">{formatPaise(r.cashSettledPaise)}</td>
                    <td className={`px-2 py-1.5 text-right ${r.cashPendingPaise > 0 ? "text-amber-700" : "text-gray-400"}`}>
                      {formatPaise(r.cashPendingPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          )}

          {tab === "block" && (
            <>
              <thead className="border-b border-gray-200 bg-gray-50/70 text-left text-[10px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-2 py-2">Block</th>
                  <th className="px-2 py-2 text-right">Lines</th>
                  <th className="px-2 py-2 text-right">Names</th>
                  <th className="px-2 py-2 text-right">Expected</th>
                  <th className="px-2 py-2 text-right">Verified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {(rows as BlockRow[]).map((r) => (
                  <tr key={r.blockId} className="hover:bg-gray-50">
                    <td className="px-2 py-1.5 font-medium text-gray-800">{r.blockId}</td>
                    <td className="px-2 py-1.5 text-right text-gray-600">{r.count}</td>
                    <td className="px-2 py-1.5 text-right text-gray-600">{r.qty}</td>
                    <td className="px-2 py-1.5 text-right text-gray-700">{formatPaise(r.expectedPaise)}</td>
                    <td className="px-2 py-1.5 text-right font-medium text-gray-900">{formatPaise(r.receivedPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </>
          )}

          {tab === "day" && (
            <>
              <thead className="border-b border-gray-200 bg-gray-50/70 text-left text-[10px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-2 py-2">Day</th>
                  <th className="px-2 py-2 text-right">Lines</th>
                  <th className="px-2 py-2 text-right">Expected</th>
                  <th className="px-2 py-2 text-right">Verified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {(rows as DayRow[]).map((r) => (
                  <tr key={r.day} className="hover:bg-gray-50">
                    <td className="px-2 py-1.5 font-medium text-gray-800">{r.day}</td>
                    <td className="px-2 py-1.5 text-right text-gray-600">{r.count}</td>
                    <td className="px-2 py-1.5 text-right text-gray-700">{formatPaise(r.expectedPaise)}</td>
                    <td className="px-2 py-1.5 text-right font-medium text-gray-900">{formatPaise(r.receivedPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </table>
        {loading && <p className="p-3 text-center text-xs text-gray-400">Loading…</p>}
        {!loading && rows.length === 0 && <p className="p-3 text-center text-xs text-gray-400">No data yet.</p>}
      </div>
    </div>
  );
}
