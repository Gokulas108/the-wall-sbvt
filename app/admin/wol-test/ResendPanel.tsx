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

// Mirror of ResendResult in lib/wol/resend.ts — only the fields the UI reads.
type ResendResult = {
  ok: boolean;
  phone: string;
  tag: string;
  templateName: string | null;
  error?: string;
  detail?: string;
};

export function ResendPanel() {
  const [phone, setPhone] = useState("");
  const [correctName, setCorrectName] = useState("");
  const [correctAddress, setCorrectAddress] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Json | null>(null);
  // Live bulk-send state, populated as the NDJSON stream arrives.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [liveFailures, setLiveFailures] = useState<ResendResult[]>([]);

  const post = async (label: string, payload: Json) => {
    setBusy(label);
    setResult(null);
    try {
      const res = await fetch("/api/wol-wf/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      try {
        setResult(JSON.parse(text) as Json);
      } catch {
        // Non-JSON response (e.g. an HTML error page) — surface the status + raw body.
        setResult({ ok: false, error: `HTTP ${res.status}`, raw: text.slice(0, 1000) });
      }
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

  const sendAll = async () => {
    const ok = window.confirm(
      "Send the WhatsApp templates to EVERY member in resend-list.csv, routed by tag?\n\nThis is a live bulk send and cannot be undone.",
    );
    if (!ok) return;

    setBusy("all");
    setResult(null);
    setProgress({ done: 0, total: 0 });
    setLiveFailures([]);

    try {
      const res = await fetch("/api/wol-wf/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "all" }),
      });

      // No streaming body (e.g. an error response) — fall back to one-shot parsing.
      if (!res.ok || !res.body) {
        const text = await res.text();
        try {
          setResult(JSON.parse(text) as Json);
        } catch {
          setResult({ ok: false, error: `HTTP ${res.status}`, raw: text.slice(0, 1000) });
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let msg: Json;
        try {
          msg = JSON.parse(trimmed) as Json;
        } catch {
          return; // ignore partial / malformed frames
        }
        if (msg.type === "progress") {
          setProgress({ done: Number(msg.done) || 0, total: Number(msg.total) || 0 });
          const last = msg.last as ResendResult | undefined;
          if (last && !last.ok) setLiveFailures((prev) => [...prev, last]);
        } else if (msg.type === "done") {
          setResult(msg);
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          handleLine(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
      handleLine(buf); // flush any trailing frame without a newline
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "Request failed" });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  // Failures to display: the final summary's results once done, else what streamed in live.
  const finalResults =
    result && Array.isArray(result.results)
      ? (result.results as ResendResult[])
      : null;
  const failures: ResendResult[] = finalResults
    ? finalResults.filter((r) => !r.ok)
    : liveFailures;

  const copyFailedNumbers = async () => {
    const text = failures.map((f) => f.phone).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard blocked (insecure context / permissions) — selecting the list still works.
    }
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

      {progress && busy === "all" && (
        <div className="rounded border border-indigo-200 bg-indigo-50 p-3">
          <div className="flex items-center justify-between text-sm font-medium text-indigo-800">
            <span>Sending…</span>
            <span>
              {progress.done}
              {progress.total ? ` / ${progress.total}` : ""}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded bg-indigo-100">
            <div
              className="h-full bg-indigo-600 transition-all"
              style={{
                width: progress.total
                  ? `${Math.round((progress.done / progress.total) * 100)}%`
                  : "0%",
              }}
            />
          </div>
          {liveFailures.length > 0 && (
            <p className="mt-1 text-xs text-red-600">
              {liveFailures.length} failed so far
            </p>
          )}
        </div>
      )}

      {failures.length > 0 && (
        <div className="rounded border border-red-300 bg-red-50 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-red-800">
              {failures.length} failed {failures.length === 1 ? "number" : "numbers"}
            </h3>
            <button
              type="button"
              onClick={copyFailedNumbers}
              className="rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              Copy numbers
            </button>
          </div>
          <div className="mt-2 max-h-72 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-red-700">
                <tr>
                  <th className="py-1 pr-2 font-medium">Phone</th>
                  <th className="py-1 pr-2 font-medium">Tag</th>
                  <th className="py-1 font-medium">Error</th>
                </tr>
              </thead>
              <tbody className="align-top text-red-900">
                {failures.map((f, i) => (
                  <tr key={`${f.phone}-${i}`} className="border-t border-red-200">
                    <td className="py-1 pr-2 font-mono whitespace-nowrap">{f.phone}</td>
                    <td className="py-1 pr-2 whitespace-nowrap">{f.tag}</td>
                    <td className="py-1">
                      {f.error ?? "Failed"}
                      {f.detail ? (
                        <span className="block opacity-60">{f.detail.slice(0, 200)}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
