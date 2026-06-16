"use client";

import { useState } from "react";

type Result =
  | {
      ok: true;
      templateName: string;
      sentTo: string;
      testAmount: number;
      panRequired: boolean;
    }
  | { ok: false; error?: string; [key: string]: unknown };

export function WolTestForm() {
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const canSend = number.trim().length > 0 && Number(amount) > 0 && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/wol-wf/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ number: number.trim(), amount: Number(amount) }),
      });
      setResult((await res.json()) as Result);
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : "Request failed",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">WhatsApp number</span>
        <input
          type="text"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="+91 98765 43210"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Test amount (₹)</span>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="25000"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <span className="mt-1 block text-xs text-gray-500">
          &gt; ₹10,000 → the flow will ask for PAN. Stored as <code>testAmount</code> on the
          intake; no wall data is written.
        </span>
      </label>

      <button
        type="button"
        onClick={handleSend}
        disabled={!canSend}
        className="w-full rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sending ? "Sending…" : "Send opening template"}
      </button>

      {result && (
        <div
          className={`rounded border p-3 text-sm ${
            result.ok
              ? "border-green-300 bg-green-50 text-green-800"
              : "border-red-300 bg-red-50 text-red-800"
          }`}
        >
          {result.ok ? (
            <div className="space-y-1">
              <p className="font-medium">Sent ✓</p>
              <p>
                Template: <code>{result.templateName}</code>
              </p>
              <p>To: {result.sentTo}</p>
              <p>PAN will be requested: {result.panRequired ? "yes" : "no"}</p>
            </div>
          ) : (
            <p className="font-medium">{result.error ?? "Failed"}</p>
          )}
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs opacity-70">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
