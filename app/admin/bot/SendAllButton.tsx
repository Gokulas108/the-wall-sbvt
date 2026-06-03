"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PendingRow = { id: number; whatsapp: string; name: string };

const SEND_DELAY_MS = 600;

export function SendAllButton({ pendingCount }: { pendingCount: number }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string>("");

  const handleSendAll = async () => {
    if (sending || pendingCount === 0) return;

    let rows: PendingRow[] = [];
    try {
      const res = await fetch("/api/admin/bot/pending", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load pending rows.");
      const json = (await res.json()) as { rows: PendingRow[] };
      rows = json.rows;
    } catch {
      setResult("Could not load pending rows.");
      return;
    }

    if (rows.length === 0) {
      setResult("Nothing pending.");
      return;
    }

    if (!window.confirm(`Send to ${rows.length} pending number(s)?`)) return;

    setSending(true);
    setProgress(0);
    setResult("");

    let sent = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const url = `/api/kkd-wf?whatsapp=${encodeURIComponent(
          row.whatsapp,
        )}&name=${encodeURIComponent(row.name)}`;
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) sent++;
        else failed++;
      } catch {
        failed++;
      }
      setProgress(Math.round(((i + 1) / rows.length) * 100));
      if (i < rows.length - 1) {
        await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
      }
    }

    setSending(false);
    setProgress(0);
    setResult(`Sent ${sent}, failed ${failed}.`);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-end gap-1 w-full sm:w-auto">
      <button
        type="button"
        onClick={handleSendAll}
        disabled={sending || pendingCount === 0}
        className="w-full sm:w-auto px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
      >
        {sending
          ? `Sending… ${progress}%`
          : `Send All Pending (${pendingCount})`}
      </button>
      {sending && (
        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
          <div
            className="bg-indigo-600 h-1.5 rounded-full transition-all duration-200 ease-out"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      )}
      {result && !sending && (
        <span className="text-xs text-gray-600">{result}</span>
      )}
    </div>
  );
}
