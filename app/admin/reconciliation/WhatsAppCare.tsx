"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import type {
  AddressCollectionExportRow,
  AddressCollectionFacets,
  AddressCollectionFlag,
  AddressCollectionPage,
  AddressCollectionRow,
  NumberDetail,
} from "@/lib/whatsapp-care/address-collection";
import { formatPaise } from "@/lib/reconciliation/format";
import { IconCheck } from "./icons";
import { WhatsAppCareDetail } from "./WhatsAppCareDetail";

type Tab = "addressCollection";

const TABS: { key: Tab; label: string }[] = [{ key: "addressCollection", label: "Address Collection" }];

const NAMES_SHOWN = 4;
const PAGE_SIZE = 25;
// Gap between consecutive WoL sends in the random batch. The loop is strictly sequential
// (one awaited call at a time), so this throttles the rate to ~1 message/second — well
// under Doubletick's limits. Raise it to be more conservative.
const BATCH_SEND_GAP_MS = 1000;

type TriState = "yes" | "no" | null;

interface Filters {
  flags: AddressCollectionFlag[];
  messaged: TriState;
  replied: TriState;
}

const EMPTY_FILTERS: Filters = { flags: [], messaged: null, replied: null };

const FLAG_OPTIONS: {
  key: AddressCollectionFlag;
  label: string;
  facet: keyof AddressCollectionFacets;
  activeClass: string;
}[] = [
  { key: "okay", label: "All okay", facet: "okay", activeClass: "bg-green-100 text-green-800 border-green-200" },
  { key: "needsReview", label: "Needs review", facet: "needsReview", activeClass: "bg-amber-100 text-amber-800 border-amber-200" },
  { key: "manyDonors", label: "30+ donors", facet: "manyDonors", activeClass: "bg-amber-100 text-amber-800 border-amber-200" },
  { key: "invalidPhone", label: "Bad number", facet: "invalidPhone", activeClass: "bg-rose-100 text-rose-800 border-rose-200" },
  { key: "unverified", label: "Unverified txns", facet: "unverified", activeClass: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  { key: "invalid", label: "Flagged invalid", facet: "invalid", activeClass: "bg-red-100 text-red-800 border-red-200" },
  { key: "multipleDonors", label: "Multiple donors", facet: "multipleDonors", activeClass: "bg-gray-200 text-gray-700 border-gray-300" },
  { key: "conflicts", label: "Conflicts", facet: "conflicts", activeClass: "bg-red-100 text-red-800 border-red-200" },
  { key: "awaitingReply", label: "No reply 24h+", facet: "awaitingReply", activeClass: "bg-orange-100 text-orange-800 border-orange-200" },
  { key: "stalledIncomplete", label: "Stalled (24h+)", facet: "stalledIncomplete", activeClass: "bg-amber-100 text-amber-800 border-amber-200" },
];

const EMPTY_FACETS: AddressCollectionFacets = {
  okay: 0,
  needsReview: 0,
  invalid: 0,
  manyDonors: 0,
  invalidPhone: 0,
  unverified: 0,
  multipleDonors: 0,
  conflicts: 0,
  awaitingReply: 0,
  stalledIncomplete: 0,
  messaged: 0,
  notMessaged: 0,
  replied: 0,
  notReplied: 0,
};

const EMPTY: AddressCollectionPage = {
  rows: [],
  total: 0,
  page: 1,
  pageSize: PAGE_SIZE,
  generatedAt: "",
  totals: { numbers: 0, txns: 0, needsReview: 0, invalid: 0 },
  facets: EMPTY_FACETS,
};

export function WhatsAppCare({
  username,
  onWolSent,
}: {
  username: string;
  onWolSent: () => void;
}) {
  const searchParams = useSearchParams();
  const selectedNumber = searchParams.get("number");

  // Only this operator may trigger Wall-of-Legacy sends (matches the server-side gate).
  const isSender = username === "gokul";
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sendingNums, setSendingNums] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<{
    running: boolean;
    done: number;
    total: number;
    ok: number;
  } | null>(null);

  const showToast = useCallback((message: string, tone: "success" | "error" = "success") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  const [tab, setTab] = useState<Tab>("addressCollection");
  const [data, setData] = useState<AddressCollectionPage>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  // Inline per-number detail. The selected number lives in the URL (`?number=`) so the row
  // is deep-linkable; we hide the table and show the detail in place — the sidebar stays put.
  const [detail, setDetail] = useState<NumberDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailReq = useRef(0);

  const loadDetail = useCallback(async (num: string) => {
    const token = ++detailReq.current;
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/whatsapp-care/${encodeURIComponent(num)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (token === detailReq.current && res.ok) setDetail(json as NumberDetail);
    } finally {
      if (token === detailReq.current) setDetailLoading(false);
    }
  }, []);

  // Opening a (different) number blanks the old detail so the loader shows; clearing the
  // param drops it entirely. Re-fetches after a save go through loadDetail directly and keep
  // the current detail on screen.
  useEffect(() => {
    if (!selectedNumber) {
      setDetail(null);
      return;
    }
    setDetail(null);
    void loadDetail(selectedNumber);
  }, [selectedNumber, loadDetail]);

  const openDetail = useCallback((num: string) => {
    const params = new URLSearchParams();
    params.set("view", "whatsapp-care");
    params.set("number", num);
    window.history.pushState(null, "", `?${params.toString()}`);
  }, []);

  const closeDetail = useCallback(() => {
    const params = new URLSearchParams();
    params.set("view", "whatsapp-care");
    window.history.pushState(null, "", `?${params.toString()}`);
  }, []);

  const load = useCallback(async (p: number, query: string, f: Filters) => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
      if (query.trim()) sp.set("q", query.trim());
      if (f.flags.length) sp.set("flags", f.flags.join(","));
      if (f.messaged) sp.set("messaged", f.messaged);
      if (f.replied) sp.set("replied", f.replied);
      const res = await fetch(`/api/admin/whatsapp-care/address-collection?${sp.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (res.ok) setData(json as AddressCollectionPage);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce search; page and filter changes load immediately.
  useEffect(() => {
    const t = setTimeout(() => void load(page, q, filters), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [page, q, filters, load]);

  const toggleFlag = useCallback((flag: AddressCollectionFlag) => {
    setPage(1);
    setFilters((prev) => ({
      ...prev,
      flags: prev.flags.includes(flag)
        ? prev.flags.filter((f) => f !== flag)
        : [...prev.flags, flag],
    }));
  }, []);

  const clearFlags = useCallback(() => {
    setPage(1);
    setFilters((prev) => ({ ...prev, flags: [] }));
  }, []);

  const setTri = useCallback((key: "messaged" | "replied", value: TriState) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => {
    setPage(1);
    setFilters(EMPTY_FILTERS);
  }, []);

  const hasActiveFilters =
    filters.flags.length > 0 || filters.messaged !== null || filters.replied !== null;

  // ── Selection + export ─────────────────────────────────────────────────────
  // Keyed by normalized number. We store the export-shaped data at selection time so the
  // selection survives paging/filtering — the row may no longer be loaded when we build
  // the CSV. "Select all filtered" pulls the whole matching set from the export endpoint.
  const [selected, setSelected] = useState<Map<string, AddressCollectionExportRow>>(new Map());
  const [selectingAll, setSelectingAll] = useState(false);

  const toggleRow = useCallback((r: AddressCollectionRow) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(r.normalizedNumber)) next.delete(r.normalizedNumber);
      else next.set(r.normalizedNumber, rowToExport(r));
      return next;
    });
  }, []);

  // Header checkbox: select/deselect every row on the current page.
  const togglePage = useCallback(() => {
    setSelected((prev) => {
      const next = new Map(prev);
      const rows = data.rows;
      const allSel = rows.length > 0 && rows.every((r) => next.has(r.normalizedNumber));
      if (allSel) rows.forEach((r) => next.delete(r.normalizedNumber));
      else rows.forEach((r) => next.set(r.normalizedNumber, rowToExport(r)));
      return next;
    });
  }, [data.rows]);

  // Add every number matching the current search + filters (across all pages) to the
  // selection in one request. Existing picks are kept (union, not replace).
  const selectAllFiltered = useCallback(async () => {
    setSelectingAll(true);
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      if (filters.flags.length) sp.set("flags", filters.flags.join(","));
      if (filters.messaged) sp.set("messaged", filters.messaged);
      if (filters.replied) sp.set("replied", filters.replied);
      const res = await fetch(
        `/api/admin/whatsapp-care/address-collection/export?${sp.toString()}`,
        { cache: "no-store" },
      );
      const json = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(json.rows)) {
        const rows = json.rows as AddressCollectionExportRow[];
        setSelected((prev) => {
          const next = new Map(prev);
          for (const row of rows) next.set(row.normalizedNumber, row);
          return next;
        });
        showToast(`Selected ${rows.length} number${rows.length === 1 ? "" : "s"}.`, "success");
      } else {
        showToast("Couldn't select all filtered numbers.", "error");
      }
    } catch {
      showToast("Couldn't select all filtered numbers.", "error");
    } finally {
      setSelectingAll(false);
    }
  }, [q, filters, showToast]);

  const clearSelection = useCallback(() => setSelected(new Map()), []);

  // Build the CSV client-side from the stored selection (number, comma-joined names,
  // total in rupees, and the name/txn counts) and trigger a download.
  const exportSelected = useCallback(() => {
    const rows = [...selected.values()].sort((a, b) =>
      a.displayNumber.localeCompare(b.displayNumber),
    );
    if (!rows.length) return;
    const headers = ["number", "names", "total_amount_inr", "name_count", "txn_count"];
    const esc = (val: string | number) => {
      const str = String(val ?? "");
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const csv = [
      headers.join(","),
      ...rows.map((r) =>
        [r.displayNumber, r.names, (r.totalAmountPaise / 100).toFixed(2), r.nameCount, r.txnCount]
          .map(esc)
          .join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "whatsapp-care-numbers.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [selected]);

  // Send the WoL template to one number. Returns true on a confirmed send so the random
  // batch can tally successes. Refreshes the header cap counter via onWolSent.
  const sendOne = useCallback(
    async (num: string, opts?: { silent?: boolean }): Promise<boolean> => {
      const silent = opts?.silent ?? false;
      setSendingNums((s) => new Set(s).add(num));
      try {
        const res = await fetch(`/api/wol-wf?number=${encodeURIComponent(num)}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.ok) {
          if (!silent) showToast(`Sent ${json.templateName} to ${num} (${json.name}).`, "success");
          onWolSent();
          return true;
        }
        if (!silent) showToast(`Failed for ${num}: ${json.error ?? res.status}`, "error");
        return false;
      } catch {
        if (!silent) showToast(`Failed for ${num}.`, "error");
        return false;
      } finally {
        setSendingNums((s) => {
          const n = new Set(s);
          n.delete(num);
          return n;
        });
      }
    },
    [onWolSent, showToast],
  );

  // Random batch: ask the server for eligible single-donor "all okay" numbers up to the
  // remaining daily budget, then send one-by-one with a short gap (mirrors the KKD SendAll).
  const runRandomBatch = useCallback(async () => {
    const res = await fetch(`/api/admin/wol/eligible`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    const numbers: string[] = json.numbers ?? [];
    if (!numbers.length) {
      showToast("No eligible numbers to send (daily budget reached or none left).", "error");
      return;
    }
    if (!window.confirm(`Send the WoL message to ${numbers.length} number${numbers.length === 1 ? "" : "s"}?`)) {
      return;
    }
    setBatch({ running: true, done: 0, total: numbers.length, ok: 0 });
    let ok = 0;
    for (let i = 0; i < numbers.length; i++) {
      if (await sendOne(numbers[i], { silent: true })) ok++;
      setBatch({ running: true, done: i + 1, total: numbers.length, ok });
      await new Promise((r) => setTimeout(r, BATCH_SEND_GAP_MS));
    }
    setBatch({ running: false, done: numbers.length, total: numbers.length, ok });
    showToast(`Random batch done: ${ok}/${numbers.length} sent.`, ok === numbers.length ? "success" : "error");
    void load(page, q, filters);
    // Leave the completed bar up briefly, then clear it.
    setTimeout(() => setBatch(null), 4000);
  }, [sendOne, showToast, load, page, q, filters]);

  if (selectedNumber) {
    return (
      <>
        <WhatsAppCareDetail
          key={selectedNumber}
          detail={detail}
          loading={detailLoading}
          onBack={closeDetail}
          onSaved={() => void loadDetail(selectedNumber)}
          isSender={isSender}
          sending={sendingNums.has(selectedNumber)}
          onSend={(num) => void sendOne(num)}
        />
        <SendToast toast={toast} />
      </>
    );
  }

  const pageRows = data.rows;
  const pageSelectedCount = pageRows.reduce(
    (n, r) => n + (selected.has(r.normalizedNumber) ? 1 : 0),
    0,
  );
  const allPageSelected = pageRows.length > 0 && pageSelectedCount === pageRows.length;
  const selectedCount = selected.size;
  // Hide "Select all filtered" once the whole filtered set is already covered.
  const allFilteredSelected = data.total > 0 && allPageSelected && selectedCount >= data.total;

  return (
    <div className="flex flex-col gap-3">
      {/* Tab strip */}
      <div className="flex items-end gap-6 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-1 pb-2.5 pt-1 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "addressCollection" && (
        <>
          {/* Totals + search */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2 text-[11px] text-gray-600">
              <Stat label="Numbers" value={data.totals.numbers} />
              <Stat label="Transactions" value={data.totals.txns} />
            </div>
            <div className="flex items-center gap-2">
              {isSender && (
                <button
                  onClick={() => void runRandomBatch()}
                  disabled={batch?.running}
                  title="Send the WoL message to a random batch of eligible single-donor numbers"
                  className="whitespace-nowrap rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {batch?.running ? `Sending ${batch.done}/${batch.total}…` : "Send random batch"}
                </button>
              )}
              <input
                value={q}
                onChange={(e) => {
                  setPage(1);
                  setQ(e.target.value);
                }}
                placeholder="Search number or donor…"
                className="w-56 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none"
              />
            </div>
          </div>

          {/* Random-batch progress bar — shown while sending and for a moment after. */}
          {isSender && batch && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-emerald-800">
                <span className="inline-flex items-center gap-1.5">
                  {batch.running && (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" />
                  )}
                  {batch.running
                    ? "Sending WoL messages…"
                    : `Batch complete — ${batch.ok}/${batch.total} sent`}
                </span>
                <span className="tabular-nums">
                  {batch.done} / {batch.total}
                  {batch.done > batch.ok ? ` · ${batch.done - batch.ok} failed` : ""}
                </span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-emerald-100"
                role="progressbar"
                aria-valuenow={batch.done}
                aria-valuemin={0}
                aria-valuemax={batch.total}
              >
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-300 ease-out"
                  style={{ width: `${batch.total ? Math.round((batch.done / batch.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}

          {/* Filters — ledger-style tag pills with counts. Flag tags + the Messaged/Replied
              groups share one wrapping row, so they sit on the same line when there's room. */}
          <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold text-gray-800">Filters</h3>
              <span className="text-[11px] text-gray-400">Click 1 or more tags to filter</span>
              {hasActiveFilters && (
                <button
                  onClick={resetFilters}
                  className="ml-auto text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Tag
                  active={filters.flags.length === 0}
                  activeClass="bg-gray-900 text-white border-gray-900"
                  onClick={clearFlags}
                >
                  All
                </Tag>
                {FLAG_OPTIONS.map((opt) => (
                  <Tag
                    key={opt.key}
                    active={filters.flags.includes(opt.key)}
                    activeClass={opt.activeClass}
                    onClick={() => toggleFlag(opt.key)}
                  >
                    {opt.label} · {data.facets[opt.facet].toLocaleString("en-IN")}
                  </Tag>
                ))}
              </div>
              <TriTags
                label="Messaged"
                value={filters.messaged}
                yesCount={data.facets.messaged}
                noCount={data.facets.notMessaged}
                onChange={(v) => setTri("messaged", v)}
              />
              <TriTags
                label="Replied"
                value={filters.replied}
                yesCount={data.facets.replied}
                noCount={data.facets.notReplied}
                onChange={(v) => setTri("replied", v)}
              />
            </div>
          </div>

          {/* Selection + export bar. Selecting numbers (per-row, the page header box, or
              "Select all filtered") builds a CSV of number · names · total · counts. */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
              <span className="font-medium text-gray-700">
                {selectedCount > 0
                  ? `${selectedCount.toLocaleString("en-IN")} selected`
                  : "Select numbers to export"}
              </span>
              {data.total > 0 && !allFilteredSelected && (
                <button
                  onClick={() => void selectAllFiltered()}
                  disabled={selectingAll}
                  className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                >
                  {selectingAll
                    ? "Selecting…"
                    : `Select all ${data.total.toLocaleString("en-IN")} filtered`}
                </button>
              )}
              {selectedCount > 0 && (
                <button
                  onClick={clearSelection}
                  className="rounded-md px-2 py-1 font-medium text-gray-500 hover:text-gray-700"
                >
                  Clear
                </button>
              )}
            </div>
            <button
              onClick={exportSelected}
              disabled={selectedCount === 0}
              className="whitespace-nowrap rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-black disabled:opacity-40"
            >
              Export CSV{selectedCount > 0 ? ` (${selectedCount.toLocaleString("en-IN")})` : ""}
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="border-b border-gray-200 bg-gray-50/70 text-left text-[10px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="w-8 px-2 py-2">
                    <SelectCheckbox
                      checked={allPageSelected}
                      indeterminate={pageSelectedCount > 0 && !allPageSelected}
                      onChange={togglePage}
                      title="Select all numbers on this page"
                    />
                  </th>
                  <th className="px-2 py-2">Number</th>
                  <th className="px-2 py-2">Donor(s)</th>
                  <th className="px-2 py-2">Transactions</th>
                  <th className="px-2 py-2 text-center">Messaged</th>
                  <th className="px-2 py-2 text-center">Replied</th>
                  <th className="px-2 py-2">Last sent</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {data.rows.map((r) => (
                  <Row
                    key={r.normalizedNumber}
                    row={r}
                    selected={selected.has(r.normalizedNumber)}
                    onToggleSelect={() => toggleRow(r)}
                    onView={() => openDetail(r.normalizedNumber)}
                    isSender={isSender}
                    sending={sendingNums.has(r.normalizedNumber)}
                    onSend={() => void sendOne(r.normalizedNumber)}
                  />
                ))}
              </tbody>
            </table>
            {loading && <p className="p-3 text-center text-xs text-gray-400">Loading…</p>}
            {!loading && data.rows.length === 0 && (
              <p className="p-3 text-center text-xs text-gray-400">
                {q.trim() || hasActiveFilters
                  ? "No numbers match the current filters."
                  : "No WhatsApp numbers found yet."}
              </p>
            )}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between gap-2 text-xs text-gray-600">
            <span>
              {data.total === 0
                ? "No matches"
                : `${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)} of ${data.total}`}
            </span>
            <div className="flex gap-1">
              <button
                disabled={data.page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1 font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                ← Prev
              </button>
              <button
                disabled={data.page * data.pageSize >= data.total || loading}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1 font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
          <p className="text-[10px] text-gray-400">
            “Messaged” / “Replied” are derived from the WhatsApp intake conversation state, not a true
            outbound-send log. Status chips come from Doubletick delivery callbacks once configured.
            Open a row for the full transaction breakdown.
          </p>
        </>
      )}
      <SendToast toast={toast} />
    </div>
  );
}

// Fixed top-right toast for WoL send results (mirrors the Receipts view toast).
function SendToast({
  toast,
}: {
  toast: { message: string; tone: "success" | "error" } | null;
}) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key="wol-send-toast"
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
          <p className="text-xs font-medium text-gray-800">{toast.message}</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Compact "time since" for the Last-sent column ("3h ago" / "2d ago").
function sinceLabel(iso: string): string {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" | "red" }) {
  const toneClass =
    tone === "amber"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : tone === "red"
        ? "bg-red-50 text-red-700 border-red-200"
        : "bg-gray-50 text-gray-600 border-gray-200";
  return (
    <span className={`rounded-full border px-2.5 py-1 font-medium ${toneClass}`}>
      {value} {label}
    </span>
  );
}

// A pill that toggles on/off — same look as the ledger filter tags: full-colour with a
// ring when active, muted neutral when inactive.
function Tag({
  active,
  activeClass,
  onClick,
  children,
}: {
  active: boolean;
  activeClass: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
        active
          ? `${activeClass} ring-2 ring-offset-1 ring-gray-900/15`
          : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

// Tri-state (All / Yes / No) tag group with counts, built from the same Tag pill.
function TriTags({
  label,
  value,
  yesCount,
  noCount,
  onChange,
}: {
  label: string;
  value: TriState;
  yesCount: number;
  noCount: number;
  onChange: (v: TriState) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-semibold text-gray-700">{label}</span>
      <Tag active={value === null} activeClass="bg-gray-900 text-white border-gray-900" onClick={() => onChange(null)}>
        All
      </Tag>
      <Tag
        active={value === "yes"}
        activeClass="bg-green-100 text-green-800 border-green-200"
        onClick={() => onChange("yes")}
      >
        Yes · {yesCount.toLocaleString("en-IN")}
      </Tag>
      <Tag
        active={value === "no"}
        activeClass="bg-gray-200 text-gray-700 border-gray-300"
        onClick={() => onChange("no")}
      >
        No · {noCount.toLocaleString("en-IN")}
      </Tag>
    </div>
  );
}

// Flatten a list row to the export shape stored in the selection (one number → joined
// names + totals). Matches the server's AddressCollectionExportRow so a per-row pick and
// a "select all filtered" pick produce identical CSV columns.
function rowToExport(r: AddressCollectionRow): AddressCollectionExportRow {
  return {
    normalizedNumber: r.normalizedNumber,
    displayNumber: r.displayNumber,
    names: r.donorNames.join(", "),
    nameCount: r.donorNames.length,
    txnCount: r.txnCount,
    totalAmountPaise: r.totalAmountPaise,
  };
}

// Checkbox with native indeterminate support (set via ref). Stops its own click from
// bubbling so it can sit inside the clickable row without opening the detail.
function SelectCheckbox({
  checked,
  indeterminate,
  onChange,
  title,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  title?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      title={title}
      className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
    />
  );
}

function Row({
  row,
  selected,
  onToggleSelect,
  onView,
  isSender,
  sending,
  onSend,
}: {
  row: AddressCollectionRow;
  selected: boolean;
  onToggleSelect: () => void;
  onView: () => void;
  isSender: boolean;
  sending: boolean;
  onSend: () => void;
}) {
  const rowTint = row.isInvalid ? "bg-red-50" : row.needsReview ? "bg-amber-50/40" : "";
  const shownNames = row.donorNames.slice(0, NAMES_SHOWN);
  const extraNames = row.donorNames.length - shownNames.length;
  return (
    // The whole row opens the detail page; the inline controls below stop propagation
    // so toggling "invalid", editing the note, or clicking "View" doesn't double-fire.
    <tr onClick={onView} className={`align-top cursor-pointer hover:bg-gray-50 ${selected ? "bg-indigo-50/60" : rowTint}`}>
      {/* Select — stop propagation so checking a row doesn't open its detail */}
      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
        <SelectCheckbox checked={selected} onChange={onToggleSelect} title="Select this number" />
      </td>

      {/* Number */}
      <td className="px-2 py-1.5">
        <div className="font-mono text-gray-900">{row.displayNumber}</div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {row.needsReview && (
            <span
              title={row.reviewReasons.join(" · ")}
              className="inline-block rounded bg-rose-100 px-1 py-0.5 text-[9px] font-medium text-rose-700"
            >
              needs review
            </span>
          )}
          {row.invalidPhone && (
            <span
              title="This number doesn't look like a real phone number"
              className="inline-block rounded bg-rose-100 px-1 py-0.5 text-[9px] font-medium text-rose-700"
            >
              bad number
            </span>
          )}
        </div>
      </td>

      {/* Donor(s) — first 4 names + N more */}
      <td className="px-2 py-1.5">
        <div className="text-gray-800">{shownNames.join(", ") || "—"}</div>
        {extraNames > 0 && <span className="text-[10px] text-gray-400">+{extraNames} more</span>}
        {row.multipleDonors && (
          <span
            className={`ml-1 inline-block rounded border px-1 py-0.5 text-[9px] ${
              row.manyDonors
                ? "border-amber-300 bg-amber-200 font-medium text-amber-900"
                : "border-gray-200 bg-gray-100 text-gray-600"
            }`}
          >
            {row.donorNames.length} donors
          </span>
        )}
      </td>

      {/* Transactions — count + total amount only (no per-txn references) */}
      <td className="px-2 py-1.5">
        <div className="text-[11px] text-gray-700">
          {row.txnCount} txn · {formatPaise(row.totalAmountPaise)}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {row.unverifiedCount > 0 && (
            <span
              title="Transactions whose payment reference isn't yet matched against an uploaded statement"
              className="inline-block rounded bg-yellow-100 px-1 py-0.5 text-[9px] font-medium text-yellow-800"
            >
              {row.unverifiedCount} unverified
            </span>
          )}
          {row.conflictCount > 0 && (
            <span className="inline-block rounded bg-red-100 px-1 py-0.5 text-[9px] text-red-700">
              {row.conflictCount} on other numbers
            </span>
          )}
        </div>
      </td>

      {/* Messaged */}
      <td className="px-2 py-1.5 text-center" title="A WhatsApp intake conversation exists for this number">
        {row.messaged ? (
          <IconCheck width={14} height={14} className="mx-auto text-green-600" />
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>

      {/* Replied */}
      <td
        className="px-2 py-1.5 text-center"
        title={row.intakeStatus ? `Intake status: ${row.intakeStatus}` : "No reply captured"}
      >
        {row.replied ? (
          <IconCheck width={14} height={14} className="mx-auto text-green-600" />
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>

      {/* Last sent + "no reply 24h+" / "stalled" */}
      <td className="px-2 py-1.5" title={row.lastSentAt ? `WoL message sent ${new Date(row.lastSentAt).toLocaleString()}` : "No WoL message sent yet"}>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-600">{row.lastSentAt ? sinceLabel(row.lastSentAt) : "—"}</span>
          {row.awaitingReply && (
            <span className="inline-block w-fit rounded bg-orange-100 px-1 py-0.5 text-[9px] font-medium text-orange-800">
              no reply 24h+
            </span>
          )}
          {row.stalledIncomplete && (
            <span
              className="inline-block w-fit rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-800"
              title={row.intakeStatus ? `Stalled at: ${row.intakeStatus}` : undefined}
            >
              stalled
            </span>
          )}
        </div>
      </td>

      {/* View → inline detail (hides the table, keeps the sidebar). The whole row is
          also clickable; this stays as an explicit affordance. The WoL send button is
          shown only to the campaign operator. */}
      <td className="px-2 py-1.5">
        <div className="flex items-center justify-end gap-1.5">
          {isSender && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSend();
              }}
              disabled={sending}
              className="inline-block whitespace-nowrap rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send WoL"}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onView();
            }}
            className="inline-block whitespace-nowrap rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-700"
          >
            View →
          </button>
        </div>
      </td>
    </tr>
  );
}
