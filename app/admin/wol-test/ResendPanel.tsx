"use client";

import { useState } from "react";

// Each CSV tag and the template it maps to (kept in sync with lib/wol/resend.ts).
const TAGS: { tag: string; template: string; note: string }[] = [
  { tag: "No bot reply", template: "follow_up_wol", note: "[name] · Enter Details" },
  { tag: "No reply", template: "wol_no_address_v1", note: "[name, amount, date] · Enter Details" },
  { tag: "No Address", template: "follow_up_wol", note: "[name] · Enter Details" },
  { tag: "No Name", template: "follow_up_wol", note: "[name] · Enter Details" },
  { tag: "discrepancy", template: "wol_discrepancy", note: "[name] · corrected receipt PDF" },
];

type Json = Record<string, unknown>;

export function ResendPanel() {
  const [phone, setPhone] = useState("");
  const [correctName, setCorrectName] = useState("");
  const [correctAddress, setCorrectAddress] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Json | null>(null);

  const post = async (label: string, payload: Json) => {
    setBusy(label);
    setResult(null);
    try {
      const res = await fetch("/api/wol-wf/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      setResult((await res.json()) as Json);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "Request failed" });
    } finally {
      setBusy(null);
    }
  };

  const testTag = (tag: string) => {
    if (!phone.trim()) {
      setResult({ ok: false, error: "Enter a test number first" });
      return;
    }
    post(`test:${tag}`, {
      mode: "test",
      tag,
      phone: phone.trim(),
      correctName: correctName.trim(),
      correctAddress: correctAddress.trim(),
    });
  };

  const sendAll = () => {
    const ok = window.confirm(
      "Send the WhatsApp templates to EVERY member in resend-list.csv, routed by tag?\n\nThis is a live bulk send and cannot be undone.",
    );
    if (!ok) return;
    post("all", { mode: "all" });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Re-send campaign</h2>
        <p className="text-sm text-gray-500">
          Test each tag&apos;s template to one number, then send to everyone in{" "}
          <code>resend-list.csv</code>. Sendable only from here.
        </p>
      </div>

      <label className="block">
        <span className="text-sm font-medium">Test number</span>
        <input
          type="text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+91 98765 43210"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </label>

      <details className="rounded border border-gray-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Corrected name / address (for the <code>discrepancy</code> test)
        </summary>
        <p className="mt-1 text-xs text-gray-500">
          Leave blank to use the number&apos;s real name/address. The real contribution
          (amount, serial, reference, date) is always kept.
        </p>
        <label className="mt-2 block">
          <span className="text-xs font-medium">Correct name</span>
          <input
            type="text"
            value={correctName}
            onChange={(e) => setCorrectName(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="mt-2 block">
          <span className="text-xs font-medium">Correct address</span>
          <textarea
            value={correctAddress}
            onChange={(e) => setCorrectAddress(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
      </details>

      <div className="space-y-2">
        <span className="text-sm font-medium">Test a tag → test number</span>
        {TAGS.map(({ tag, template, note }) => (
          <button
            key={tag}
            type="button"
            onClick={() => testTag(tag)}
            disabled={busy !== null}
            className="flex w-full items-center justify-between rounded border border-gray-300 bg-white px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            <span>
              <span className="font-medium">{tag}</span>
              <span className="ml-2 text-xs text-gray-500">
                {template} · {note}
              </span>
            </span>
            <span className="text-xs text-indigo-600">
              {busy === `test:${tag}` ? "Sending…" : "Test ▸"}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={sendAll}
        disabled={busy !== null}
        className="w-full rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {busy === "all" ? "Sending to all…" : "⚠ Send to ALL in resend-list.csv"}
      </button>

      {result && (
        <div
          className={`rounded border p-3 text-sm ${
            result.ok
              ? "border-green-300 bg-green-50 text-green-800"
              : "border-red-300 bg-red-50 text-red-800"
          }`}
        >
          <p className="font-medium">
            {result.ok ? "Done ✓" : (result.error as string) ?? "Failed"}
          </p>
          {typeof result.total === "number" && (
            <p className="mt-1">
              {String(result.sent ?? 0)} sent · {String(result.failed ?? 0)} failed ·{" "}
              {String(result.total)} total
            </p>
          )}
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs opacity-70">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
