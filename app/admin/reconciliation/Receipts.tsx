"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type {
  ReceiptRow,
  ReceiptsPage,
  SubmittedReceiptRow,
  SubmittedReceiptsPage,
} from "@/lib/reconciliation/receipts";
import {
  DONATION_TYPE_LABEL,
  formatPaiseExact,
  STATUS_LABEL,
  statusBadgeClass,
} from "@/lib/reconciliation/format";
import { LedgerDetail } from "./LedgerDetail";

const PAGE_SIZE = 25;
const CHANNELS = ["online", "upi", "cash", "none"];
const MATCHED_STATUS_OPTIONS = ["MATCHED", "OVERPAID", "UNDERPAID"];
const API = "/api/admin/reconciliation/receipts";

type Tab = "pending" | "submitted";

interface Filters {
  channel: string;
  donationType: string; // "" | "general" | "wall_of_legacy"
  status: string; // "" | one of MATCHED_STATUS_OPTIONS
  from: string;
  to: string;
}
const EMPTY_FILTERS: Filters = { channel: "", donationType: "", status: "", from: "", to: "" };

const EMPTY_PENDING: ReceiptsPage = {
  data: [],
  total: 0,
  page: 1,
  pageSize: PAGE_SIZE,
  eligibleCount: 0,
  totalCount: 0,
  pendingCount: 0,
  submittedCount: 0,
};
const EMPTY_SUBMITTED: SubmittedReceiptsPage = { data: [], total: 0, page: 1, pageSize: PAGE_SIZE };

function buildParams(page: number, q: string, f: Filters): URLSearchParams {
  const sp = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (q.trim()) sp.set("q", q.trim());
  if (f.channel) sp.set("channel", f.channel);
  if (f.donationType) sp.set("donationType", f.donationType);
  if (f.status) sp.set("status", f.status);
  if (f.from) sp.set("from", f.from);
  if (f.to) sp.set("to", f.to);
  return sp;
}

// Same-origin download via an anchor — the endpoints stream with a Content-Disposition
// attachment header, so the browser saves directly without buffering the whole file in JS.
function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function Receipts() {
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");
  const tab: Tab = searchParams.get("tab") === "submitted" ? "submitted" : "pending";

  const [pending, setPending] = useState<ReceiptsPage>(EMPTY_PENDING);
  const [submitted, setSubmitted] = useState<SubmittedReceiptsPage>(EMPTY_SUBMITTED);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [movingBack, setMovingBack] = useState<number | null>(null);
  const [movingBackBulk, setMovingBackBulk] = useState(false);
  // Bumped after a mutation (generate / move-back) to force the active list to reload.
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<{
    message: string | null;
    href: string | null;
    tone: "success" | "error";
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (message: string | null, href: string | null, tone: "success" | "error" = "success") => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({ message, href, tone });
      toastTimer.current = setTimeout(() => setToast(null), 8000);
    },
    [],
  );

  const load = useCallback(async (t: Tab, p: number, query: string, f: Filters) => {
    setLoading(true);
    try {
      const sp = buildParams(p, query, f);
      const endpoint = t === "submitted" ? `${API}/submitted` : API;
      const res = await fetch(`${endpoint}?${sp.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) return;
      if (t === "submitted") setSubmitted(json as SubmittedReceiptsPage);
      else setPending(json as ReceiptsPage);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce search; tab/page/filter/refresh changes load immediately.
  useEffect(() => {
    const handle = setTimeout(() => void load(tab, page, q, filters), q ? 250 : 0);
    return () => clearTimeout(handle);
  }, [tab, page, q, filters, refreshKey, load]);

  // Switching tab resets paging + selection and writes ?tab= so it survives refresh.
  const switchTab = useCallback(
    (t: Tab) => {
      if (t === tab) return;
      setPage(1);
      setSelected(new Set());
      setToast(null);
      const params = new URLSearchParams();
      params.set("view", "receipts");
      if (t === "submitted") params.set("tab", "submitted");
      window.history.pushState(null, "", `?${params.toString()}`);
    },
    [tab],
  );

  const detailParams = useCallback(
    (id?: number) => {
      const params = new URLSearchParams();
      params.set("view", "receipts");
      if (tab === "submitted") params.set("tab", "submitted");
      if (id != null) params.set("id", String(id));
      return params.toString();
    },
    [tab],
  );
  const openDetail = useCallback(
    (id: number) => window.history.pushState(null, "", `?${detailParams(id)}`),
    [detailParams],
  );
  const closeDetail = useCallback(
    () => window.history.pushState(null, "", `?${detailParams()}`),
    [detailParams],
  );

  const setFilter = useCallback((patch: Partial<Filters>) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);
  const resetFilters = useCallback(() => {
    setPage(1);
    setQ("");
    setFilters(EMPTY_FILTERS);
  }, []);
  const hasActiveFilters =
    !!q.trim() || filters.channel || filters.donationType || filters.status || filters.from || filters.to;

  // Selection (pending tab only).
  const toggleOne = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // Selection is shared across tabs (reset on tab switch). On the submitted tab the ids
  // are treasury-receipt ids; on the pending tab they are contribution ids.
  const pageIds = (tab === "submitted" ? submitted.data : pending.data).map((r) => r.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      const everySelected = pageIds.length > 0 && pageIds.every((id) => next.has(id));
      if (everySelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }, [pageIds]);

  // Select every pending transaction matching the current filters, across all pages.
  const selectAllPending = useCallback(async () => {
    if (selectingAll) return;
    setSelectingAll(true);
    try {
      const sp = buildParams(1, q, filters);
      const res = await fetch(`${API}/pending-ids?${sp.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setSelected(new Set<number>(json.ids ?? []));
    } finally {
      setSelectingAll(false);
    }
  }, [selectingAll, q, filters]);

  // Select every submitted receipt matching the current filters, across all pages.
  const selectAllSubmitted = useCallback(async () => {
    if (selectingAll) return;
    setSelectingAll(true);
    try {
      const sp = buildParams(1, q, filters);
      const res = await fetch(`${API}/submitted-ids?${sp.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setSelected(new Set<number>(json.ids ?? []));
    } finally {
      setSelectingAll(false);
    }
  }, [selectingAll, q, filters]);

  const generate = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0 || generating) return;
    setGenerating(true);
    try {
      const res = await fetch(`${API}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contributionIds: ids }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json?.error ?? "Failed to generate receipts.", null, "error");
        return;
      }
      const receiptIds: number[] = json.receiptIds ?? [];
      const href = receiptIds.length > 0 ? `${API}/treasury-zip?ids=${receiptIds.join(",")}` : null;
      // Single download — the ZIP bundles the receipt PDFs and the CSV.
      if (href) triggerDownload(href);
      showToast(
        `Generated ${json.createdCount} receipt${json.createdCount === 1 ? "" : "s"}` +
          (json.skipped ? `, skipped ${json.skipped} already submitted` : "") +
          ".",
        href,
      );
      // Reset selection + page, then force the pending list to reload (drops the submitted
      // rows) without blocking on the slow ZIP build.
      setSelected(new Set());
      setPage(1);
      setRefreshKey((k) => k + 1);
    } finally {
      setGenerating(false);
    }
  }, [selected, generating, showToast]);

  // Move a submitted receipt back to "yet to submit" (deletes the treasury record).
  const moveBack = useCallback(
    async (receiptId: number) => {
      if (movingBack != null || movingBackBulk) return;
      if (!window.confirm("Move this receipt back to 'yet to submit'? Its receipt number will be released.")) return;
      setMovingBack(receiptId);
      try {
        const res = await fetch(`${API}/unsubmit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receiptIds: [receiptId] }),
        });
        if (res.ok) {
          setSelected((prev) => {
            if (!prev.has(receiptId)) return prev;
            const next = new Set(prev);
            next.delete(receiptId);
            return next;
          });
          setRefreshKey((k) => k + 1);
        }
      } finally {
        setMovingBack(null);
      }
    },
    [movingBack, movingBackBulk],
  );

  // Move every selected submitted receipt back to "yet to submit" in one request.
  const moveBackSelected = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0 || movingBackBulk || movingBack != null) return;
    if (
      !window.confirm(
        `Move ${ids.length} receipt${ids.length === 1 ? "" : "s"} back to 'yet to submit'? Their receipt numbers will be released.`,
      )
    )
      return;
    setMovingBackBulk(true);
    try {
      const res = await fetch(`${API}/unsubmit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptIds: ids }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        showToast(json?.error ?? "Failed to move receipts back.", null, "error");
        return;
      }
      const removed = json?.removed ?? ids.length;
      setSelected(new Set());
      setPage(1);
      setRefreshKey((k) => k + 1);
      showToast(`Moved ${removed} receipt${removed === 1 ? "" : "s"} back to 'yet to submit'.`, null);
    } finally {
      setMovingBackBulk(false);
    }
  }, [selected, movingBackBulk, movingBack, showToast]);

  if (selectedId) {
    return (
      <LedgerDetail
        key={selectedId}
        id={selectedId}
        backLabel="← Back to receipts"
        onBack={closeDetail}
      />
    );
  }

  const pct = pending.totalCount > 0 ? ((pending.eligibleCount / pending.totalCount) * 100).toFixed(1) : "0";
  const activeTotal = tab === "submitted" ? submitted.total : pending.total;
  const totalPages = Math.max(1, Math.ceil(activeTotal / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-3">
      {/* Tabs */}
      <div className="flex items-end gap-6 border-b border-gray-200">
        <TabButton active={tab === "pending"} onClick={() => switchTab("pending")}>
          Yet to submit to treasury
        </TabButton>
        <TabButton active={tab === "submitted"} onClick={() => switchTab("submitted")}>
          Submitted to treasury
        </TabButton>
      </div>

      {/* Stat (pending tab) */}
      {tab === "pending" && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Receipts ready</div>
          <div className="text-2xl font-semibold text-gray-900">
            {pending.eligibleCount.toLocaleString("en-IN")}{" "}
            <span className="text-base font-normal text-gray-400">
              of {pending.totalCount.toLocaleString("en-IN")}
            </span>
          </div>
          <div className="text-[11px] text-gray-500">
            {pct}% of matched transactions have a legal name + address · {pending.pendingCount.toLocaleString("en-IN")} yet
            to submit · {pending.submittedCount.toLocaleString("en-IN")} submitted
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <input
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          placeholder="Search name / phone / reference / address"
          className="min-w-[220px] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <select
          value={filters.channel}
          onChange={(e) => setFilter({ channel: e.target.value })}
          className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">All channels</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={filters.donationType}
          onChange={(e) => setFilter({ donationType: e.target.value })}
          className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">All types</option>
          <option value="wall_of_legacy">Wall of Legacy</option>
          <option value="general">General</option>
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilter({ status: e.target.value })}
          className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">All statuses</option>
          {MATCHED_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s] ?? s}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={filters.from}
          onChange={(e) => setFilter({ from: e.target.value })}
          title="From date"
          className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setFilter({ to: e.target.value })}
          title="To date"
          className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Clear
          </button>
        )}
      </div>

      {/* Action bar (pending tab) */}
      {tab === "pending" && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={generate}
            disabled={selected.size === 0 || generating}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {generating ? "Generating…" : `Generate Receipts for Treasury${selected.size ? ` (${selected.size})` : ""}`}
          </button>
          {pending.total > 0 && (
            <button
              onClick={selectAllPending}
              disabled={selectingAll}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              {selectingAll ? "Selecting…" : `Select all ${pending.total.toLocaleString("en-IN")} pending`}
            </button>
          )}
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              Clear selection
            </button>
          )}
        </div>
      )}

      {/* Action bar (submitted tab) */}
      {tab === "submitted" && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={moveBackSelected}
            disabled={selected.size === 0 || movingBackBulk}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
          >
            {movingBackBulk
              ? "Moving back…"
              : `Move back to 'yet to submit'${selected.size ? ` (${selected.size})` : ""}`}
          </button>
          {submitted.total > 0 && (
            <button
              onClick={selectAllSubmitted}
              disabled={selectingAll}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              {selectingAll ? "Selecting…" : `Select all ${submitted.total.toLocaleString("en-IN")} submitted`}
            </button>
          )}
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              Clear selection
            </button>
          )}
        </div>
      )}

      {tab === "pending" ? (
        <PendingTable
          rows={pending.data}
          loading={loading}
          selected={selected}
          allOnPageSelected={allOnPageSelected}
          onToggleOne={toggleOne}
          onToggleAll={toggleAll}
          onOpen={openDetail}
          hasActiveFilters={!!hasActiveFilters}
        />
      ) : (
        <SubmittedTable
          rows={submitted.data}
          loading={loading}
          selected={selected}
          allOnPageSelected={allOnPageSelected}
          onToggleOne={toggleOne}
          onToggleAll={toggleAll}
          onOpen={openDetail}
          onMoveBack={moveBack}
          movingBack={movingBack}
          movingBackBulk={movingBackBulk}
          hasActiveFilters={!!hasActiveFilters}
        />
      )}

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          {activeTotal} {tab === "submitted" ? "submitted" : "receipt-ready"} transaction
          {activeTotal === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 font-medium hover:bg-gray-50 disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 font-medium hover:bg-gray-50 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            key="receipts-toast"
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed right-4 top-4 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg"
          >
            <span
              className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full ${
                toast.tone === "error" ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-600"
              }`}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {toast.tone === "error" ? (
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  <polyline points="20 6 9 17 4 12" />
                )}
              </svg>
            </span>
            <div className="text-xs text-gray-700">
              {toast.message && <p className="font-medium text-gray-800">{toast.message}</p>}
              {toast.href ? (
                <p className={toast.message ? "mt-1 text-gray-600" : "text-gray-600"}>
                  Your files will start downloading soon.{" "}
                  <a href={toast.href} className="font-medium text-indigo-600 hover:underline">
                    Click here to download
                  </a>
                  , if it did not start automatically.
                </p>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-1 pb-2.5 pt-1 text-sm font-medium transition-colors ${
        active
          ? "border-indigo-600 text-indigo-700"
          : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function PendingTable({
  rows,
  loading,
  selected,
  allOnPageSelected,
  onToggleOne,
  onToggleAll,
  onOpen,
  hasActiveFilters,
}: {
  rows: ReceiptRow[];
  loading: boolean;
  selected: Set<number>;
  allOnPageSelected: boolean;
  onToggleOne: (id: number) => void;
  onToggleAll: () => void;
  onOpen: (id: number) => void;
  hasActiveFilters: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200 text-xs">
        <thead className="border-b border-gray-200 bg-gray-50/70 text-left text-[10px] uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-2 py-2">
              <input
                type="checkbox"
                checked={allOnPageSelected}
                onChange={onToggleAll}
                title="Select all on this page"
                aria-label="Select all on this page"
              />
            </th>
            <th className="px-2 py-2">Status</th>
            <th className="px-2 py-2">Type</th>
            <th className="px-2 py-2">Donor</th>
            <th className="px-2 py-2">Legal name</th>
            <th className="px-2 py-2">Address</th>
            <th className="px-2 py-2">Channel</th>
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
              <td colSpan={13} className="px-2 py-6 text-center text-gray-400">
                Loading…
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={13} className="px-2 py-6 text-center text-gray-400">
                {hasActiveFilters
                  ? "No receipt-ready transactions match these filters."
                  : "No receipt-ready transactions yet."}
              </td>
            </tr>
          )}
          {!loading &&
            rows.map((r) => {
              const isGeneral = r.donationType === "general";
              const checked = selected.has(r.id);
              return (
                <tr
                  key={r.id}
                  onClick={() => onOpen(r.id)}
                  title="View transaction detail"
                  className={`cursor-pointer align-top ${checked ? "bg-indigo-50/50" : "hover:bg-indigo-50/60"}`}
                >
                  <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleOne(r.id)}
                      aria-label={`Select transaction ${r.id}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(r.status)}`}
                    >
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                        isGeneral
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
                    {r.donorCount > 1 && (
                      <span className="mt-0.5 inline-block rounded border border-amber-200 bg-amber-100 px-1 py-0.5 text-[9px] text-amber-800">
                        {r.donorCount} donors
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-gray-800" title={r.whatsapp}>
                    {r.legalName || "—"}
                  </td>
                  <td className="max-w-[220px] px-2 py-1.5 text-gray-600">
                    <div className="truncate" title={r.address ?? undefined}>
                      {r.address || "—"}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-gray-600">{r.paymentChannel}</td>
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
                    <span className="text-gray-400" aria-hidden>
                      ›
                    </span>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

function SubmittedTable({
  rows,
  loading,
  selected,
  allOnPageSelected,
  onToggleOne,
  onToggleAll,
  onOpen,
  onMoveBack,
  movingBack,
  movingBackBulk,
  hasActiveFilters,
}: {
  rows: SubmittedReceiptRow[];
  loading: boolean;
  selected: Set<number>;
  allOnPageSelected: boolean;
  onToggleOne: (id: number) => void;
  onToggleAll: () => void;
  onOpen: (id: number) => void;
  onMoveBack: (receiptId: number) => void;
  movingBack: number | null;
  movingBackBulk: boolean;
  hasActiveFilters: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200 text-xs">
        <thead className="border-b border-gray-200 bg-gray-50/70 text-left text-[10px] uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-2 py-2">
              <input
                type="checkbox"
                checked={allOnPageSelected}
                onChange={onToggleAll}
                title="Select all on this page"
                aria-label="Select all on this page"
              />
            </th>
            <th className="px-2 py-2">Receipt #</th>
            <th className="px-2 py-2">Type</th>
            <th className="px-2 py-2">Legal name</th>
            <th className="px-2 py-2">Address</th>
            <th className="px-2 py-2">Channel</th>
            <th className="px-2 py-2">Reference</th>
            <th className="px-2 py-2 text-right">Amount</th>
            <th className="px-2 py-2">Date</th>
            <th className="px-2 py-2">Submitted by</th>
            <th className="px-2 py-2">Submitted at</th>
            <th className="px-2 py-2"></th>
            <th className="px-2 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {loading && (
            <tr>
              <td colSpan={13} className="px-2 py-6 text-center text-gray-400">
                Loading…
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={13} className="px-2 py-6 text-center text-gray-400">
                {hasActiveFilters ? "No submitted receipts match these filters." : "No receipts submitted yet."}
              </td>
            </tr>
          )}
          {!loading &&
            rows.map((r) => {
              const clickable = r.contributionId != null;
              const checked = selected.has(r.id);
              return (
                <tr
                  key={r.id}
                  onClick={clickable ? () => onOpen(r.contributionId!) : undefined}
                  className={`align-top ${checked ? "bg-indigo-50/50" : clickable ? "cursor-pointer hover:bg-indigo-50/60" : ""}`}
                >
                  <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleOne(r.id)}
                      aria-label={`Select receipt ${r.receiptNo}`}
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px] font-medium text-gray-800">{r.receiptNo}</td>
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
                  <td className="px-2 py-1.5 text-gray-800">{r.legalName || r.donorName || "—"}</td>
                  <td className="max-w-[220px] px-2 py-1.5 text-gray-600">
                    <div className="truncate" title={r.address ?? undefined}>
                      {r.address || "—"}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-gray-600">{r.paymentChannel}</td>
                  <td className="px-2 py-1.5 font-mono text-[10px] text-gray-500">{r.txnId || "—"}</td>
                  <td className="px-2 py-1.5 text-right font-medium text-gray-900">{formatPaiseExact(r.amountPaise)}</td>
                  <td className="px-2 py-1.5 text-[10px] text-gray-500">{r.contributedAt?.slice(0, 10) || "—"}</td>
                  <td className="px-2 py-1.5 text-gray-700">{r.submittedByUsername || "—"}</td>
                  <td className="px-2 py-1.5 text-[10px] text-gray-500">
                    {r.submittedAt.slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => onMoveBack(r.id)}
                      disabled={movingBack === r.id || movingBackBulk}
                      title="Move back to 'yet to submit'"
                      className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                    >
                      {movingBack === r.id ? "Moving…" : "Move back"}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {clickable && (
                      <span className="text-gray-400" aria-hidden>
                        ›
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
