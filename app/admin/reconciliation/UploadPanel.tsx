"use client";

import { useRef, useState } from "react";

type Kind = "gateway" | "upi";

interface UploadResult {
  batchId: number;
  rowsTotal: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsFailed: number;
  periodStart: string | null;
  periodEnd: string | null;
}

const LABEL: Record<Kind, string> = {
  gateway: "Payment Gateway export",
  upi: "UPI export",
};
const HINT: Record<Kind, string> = {
  gateway: "Joins on Transaction ID → online donations + birnagar general.",
  upi: "Joins on bankRRN → volunteer UPI donations.",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadCard({ kind, onUploaded }: { kind: Kind; onUploaded?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number>(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pickFile(file: File | null | undefined) {
    if (!file) return;
    if (fileRef.current) {
      // Reflect a drag-dropped file back into the native input so the form stays consistent.
      const dt = new DataTransfer();
      dt.items.add(file);
      fileRef.current.files = dt.files;
    }
    setFileName(file.name);
    setFileSize(file.size);
    setError(null);
    setResult(null);
  }

  function clearFile() {
    if (fileRef.current) fileRef.current.value = "";
    setFileName(null);
    setFileSize(0);
  }

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.set("file", file);
    form.set("kind", kind);

    try {
      const res = await fetch("/api/admin/reconciliation/csv/upload", {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(
          json.missingHeaders?.length
            ? `${json.error} Missing columns: ${json.missingHeaders.join(", ")}`
            : json.error || "Upload failed.",
        );
      } else {
        setResult(json as UploadResult);
        clearFile();
        onUploaded?.();
      }
    } catch {
      setError("Network error during upload.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-800">{LABEL[kind]}</h3>
          <p className="text-xs text-gray-500">{HINT[kind]}</p>
        </div>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pickFile(e.dataTransfer.files?.[0]);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors ${
          dragging
            ? "border-indigo-400 bg-indigo-50"
            : "border-gray-200 bg-gray-50 hover:border-indigo-300 hover:bg-indigo-50/40"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M17 8l-5-5-5 5" />
          <path d="M12 3v12" />
        </svg>
        <span className="text-xs font-medium text-gray-600">
          <span className="text-indigo-600">Choose a CSV</span> or drag it here
        </span>
        <span className="text-[10px] text-gray-400">.csv exports only</span>
      </label>

      {fileName && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-gray-400">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700">{fileName}</span>
          <span className="shrink-0 text-[10px] text-gray-400">{formatBytes(fileSize)}</span>
          <button
            type="button"
            onClick={clearFile}
            disabled={busy}
            className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 disabled:opacity-40"
            aria-label="Remove file"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <button
        onClick={handleUpload}
        disabled={busy || !fileName}
        className="flex items-center justify-center gap-2 self-start rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && (
          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
          </svg>
        )}
        {busy ? "Uploading…" : "Upload CSV"}
      </button>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
      {result && (
        <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
          <div>
            <strong>{result.rowsTotal}</strong> rows · {result.rowsInserted} new ·{" "}
            {result.rowsUpdated} updated
            {result.rowsFailed > 0 && (
              <span className="text-amber-700"> · {result.rowsFailed} skipped</span>
            )}
          </div>
          {(result.periodStart || result.periodEnd) && (
            <div className="text-green-700">
              covers {result.periodStart?.slice(0, 10) ?? "?"} →{" "}
              {result.periodEnd?.slice(0, 10) ?? "?"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function UploadPanel({ onUploaded }: { onUploaded?: () => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <UploadCard kind="gateway" onUploaded={onUploaded} />
      <UploadCard kind="upi" onUploaded={onUploaded} />
    </div>
  );
}
