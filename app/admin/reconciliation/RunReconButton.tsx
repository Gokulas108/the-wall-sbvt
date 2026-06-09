"use client";

import { useState } from "react";

interface RunSummary {
  closureOk: boolean;
  closureDeltaPaise: number;
  contributionCount: number;
  orphanCount: number;
}

// Pulls the live birnagar donations, then rebuilds the ledger. Both steps are
// server-gated; this is the single "refresh everything" action.
export function RunReconButton({ onDone }: { onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunSummary | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      setStep("Pulling birnagar donations…");
      const pull = await fetch("/api/admin/reconciliation/birnagar-pull", { method: "POST" });
      if (!pull.ok) {
        const j = await pull.json().catch(() => ({}));
        // Non-fatal: the birnagar feed may be unreachable in dev — keep reconciling
        // the wall + CSV data and surface a warning.
        setError(`birnagar pull skipped: ${j.error ?? pull.status}`);
      }

      setStep("Reconciling…");
      const res = await fetch("/api/admin/reconciliation/run", { method: "POST" });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error || "Reconciliation failed.");
        return;
      }
      setResult(j as RunSummary);
      onDone?.();
    } catch {
      setError("Network error during reconciliation.");
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={run}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        )}
        {busy ? step || "Working…" : "Refresh & Reconcile"}
      </button>
      {error && <p className="px-1 text-[11px] text-amber-400">{error}</p>}
      {result && (
        <p className="px-1 text-[11px] text-slate-400">
          {result.contributionCount} rows · {result.orphanCount} orphans ·{" "}
          {result.closureOk ? (
            <span className="text-green-400">balanced ✓</span>
          ) : (
            <span className="text-red-400">off ₹{Math.abs(result.closureDeltaPaise / 100).toFixed(2)}</span>
          )}
        </p>
      )}
    </div>
  );
}
