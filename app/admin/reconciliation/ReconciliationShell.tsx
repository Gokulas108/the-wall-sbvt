"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReconciliationSummary } from "@/lib/reconciliation/summary";
import type { LedgerRow } from "@/lib/reconciliation/ledger";
import { UploadPanel } from "./UploadPanel";
import { RunReconButton } from "./RunReconButton";
import { SummaryCards } from "./SummaryCards";
import { OverviewStats } from "./OverviewStats";
import { LedgerFilters } from "./LedgerFilters";
import { LedgerTable, type LedgerFilterState } from "./LedgerTable";
import { LedgerDetail } from "./LedgerDetail";
import { Breakdowns } from "./Breakdowns";
import { MatchWorkbench } from "./MatchWorkbench";
import { OrphanDetail } from "./OrphanDetail";
import { WhatsAppCare } from "./WhatsAppCare";
import { Receipts } from "./Receipts";
import {
  IconOverview,
  IconLedger,
  IconUpload,
  IconWorkbench,
  IconWhatsApp,
  IconReceipt,
  IconMenu,
  IconClose,
  IconCheck,
  IconLogout,
} from "./icons";

type View = "overview" | "ledger" | "upload" | "breakdowns" | "workbench" | "whatsappCare" | "receipts";

// The view lives in the URL as a kebab-case `?view=` slug so every tab — and the
// inline WhatsApp-care detail — is deep-linkable and survives a refresh.
const VIEW_TO_SLUG: Record<View, string> = {
  overview: "overview",
  ledger: "ledger",
  upload: "upload",
  breakdowns: "breakdowns",
  workbench: "workbench",
  whatsappCare: "whatsapp-care",
  receipts: "receipts",
};
const SLUG_TO_VIEW: Record<string, View> = {
  overview: "overview",
  ledger: "ledger",
  upload: "upload",
  breakdowns: "breakdowns",
  workbench: "workbench",
  "whatsapp-care": "whatsappCare",
  receipts: "receipts",
};

const NAV: { key: View; label: string; Icon: typeof IconOverview }[] = [
  { key: "overview", label: "Overview", Icon: IconOverview },
  { key: "ledger", label: "Ledger", Icon: IconLedger },
  { key: "receipts", label: "Receipts", Icon: IconReceipt },
  { key: "whatsappCare", label: "WhatsApp Care", Icon: IconWhatsApp },
  { key: "upload", label: "Upload statements", Icon: IconUpload },
  { key: "workbench", label: "Orphan Donations", Icon: IconWorkbench },
];

const VIEW_META: Record<View, { title: string; subtitle: string }> = {
  overview: { title: "Overview", subtitle: "Totals, status distribution and channel breakdown." },
  ledger: { title: "Ledger", subtitle: "The full ledger of every contribution." },
  receipts: { title: "Receipts", subtitle: "Matched donors who've sent their legal name + address over WhatsApp." },
  upload: { title: "Upload statements", subtitle: "Import the gateway & UPI exports to verify payments." },
  breakdowns: { title: "Breakdowns", subtitle: "Totals by volunteer, block and day." },
  workbench: { title: "Orphan Donations", subtitle: "Attach orphan payments to the right donor." },
  whatsappCare: { title: "WhatsApp Care", subtitle: "Address collection & number health, per WhatsApp number." },
};

const EMPTY_FILTERS: LedgerFilterState = {
  status: [],
  channel: null,
  donationType: [],
  q: null,
  blockId: null,
  from: null,
  to: null,
};

function batchKindLabel(kind: string): string {
  if (kind === "gateway") return "Gateway statement";
  if (kind === "upi") return "UPI statement";
  if (kind === "birnagar_live") return "Birnagar pull";
  return kind;
}

export function ReconciliationShell({
  initialSummary,
  username,
}: {
  initialSummary: ReconciliationSummary;
  username: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view: View = SLUG_TO_VIEW[searchParams.get("view") ?? ""] ?? "overview";
  const [loggingOut, setLoggingOut] = useState(false);
  const ledgerId = searchParams.get("id");
  const orphanMatchId = searchParams.get("txn");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [summary, setSummary] = useState(initialSummary);
  const [filters, setFilters] = useState<LedgerFilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  // Bumped on "Reset filters" to remount the uncontrolled search/block inputs in the table.
  const [filterResetKey, setFilterResetKey] = useState(0);
  const [ledger, setLedger] = useState<{ data: LedgerRow[]; total: number; pageSize: number }>({
    data: [],
    total: 0,
    pageSize: 15,
  });
  const [loading, setLoading] = useState(true);
  const [reconcileVersion, setReconcileVersion] = useState(0);
  const reqToken = useRef(0);
  const [wolStatus, setWolStatus] = useState<{
    limit: number;
    sentToday: number;
    remaining: number;
  } | null>(null);
  const [awaitingReplyCount, setAwaitingReplyCount] = useState<number | null>(null);

  const refreshSummary = useCallback(async () => {
    const res = await fetch("/api/admin/reconciliation/summary", { cache: "no-store" });
    if (res.ok) setSummary((await res.json()) as ReconciliationSummary);
  }, []);

  // Today's WoL WhatsApp send count vs the 250/day cap — shown in the header for every admin.
  const refreshWolStatus = useCallback(async () => {
    const res = await fetch("/api/admin/wol/status", { cache: "no-store" });
    if (res.ok) setWolStatus(await res.json());
  }, []);

  // "No reply 24h+" count for the Overview — read off the WhatsApp-care facets (cached
  // server-side, so a tiny page request is cheap).
  const refreshAwaitingReply = useCallback(async () => {
    const res = await fetch("/api/admin/whatsapp-care/address-collection?page=1&pageSize=1", {
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      const n = json?.facets?.awaitingReply;
      setAwaitingReplyCount(typeof n === "number" ? n : null);
    }
  }, []);

  useEffect(() => {
    void refreshWolStatus();
    void refreshAwaitingReply();
  }, [refreshWolStatus, refreshAwaitingReply]);

  const loadLedger = useCallback(async (f: LedgerFilterState, p: number) => {
    const token = ++reqToken.current;
    setLoading(true);
    const sp = new URLSearchParams();
    if (f.status.length) sp.set("status", f.status.join(","));
    if (f.channel) sp.set("channel", f.channel);
    if (f.donationType.length) sp.set("donationType", f.donationType.join(","));
    if (f.q) sp.set("q", f.q);
    if (f.blockId) sp.set("blockId", f.blockId);
    if (f.from) sp.set("from", f.from);
    if (f.to) sp.set("to", f.to);
    sp.set("page", String(p));
    sp.set("pageSize", "15");
    try {
      const res = await fetch(`/api/admin/reconciliation/ledger?${sp.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (token === reqToken.current && res.ok) {
        setLedger({ data: json.data, total: json.total, pageSize: json.pageSize });
      }
    } finally {
      if (token === reqToken.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLedger(filters, page);
  }, [filters, page, loadLedger]);

  // Push the view into the URL (`?view=<slug>`) without a server round-trip — Next syncs
  // useSearchParams off the History API, so the tab switches instantly and back/forward work.
  // A fresh param set also clears any open WhatsApp-care `?number=` detail.
  const navTo = (v: View) => {
    const params = new URLSearchParams();
    params.set("view", VIEW_TO_SLUG[v]);
    window.history.pushState(null, "", `?${params.toString()}`);
    setSidebarOpen(false);
  };

  // Ledger transaction detail opens inline (table hidden, sidebar kept) via `?view=ledger&id=`.
  const openLedgerRow = (id: number) => {
    const params = new URLSearchParams();
    params.set("view", "ledger");
    params.set("id", String(id));
    window.history.pushState(null, "", `?${params.toString()}`);
  };
  const closeLedgerDetail = () => {
    const params = new URLSearchParams();
    params.set("view", "ledger");
    window.history.pushState(null, "", `?${params.toString()}`);
  };
  // Orphan transaction detail opens inline (table hidden, sidebar kept) via `?view=workbench&txn=`.
  const openOrphanRow = (matchId: number) => {
    const params = new URLSearchParams();
    params.set("view", "workbench");
    params.set("txn", String(matchId));
    window.history.pushState(null, "", `?${params.toString()}`);
  };
  const closeOrphanDetail = () => {
    const params = new URLSearchParams();
    params.set("view", "workbench");
    window.history.pushState(null, "", `?${params.toString()}`);
  };
  // Multi-select tag filters — cards and tags toggle statuses / donation types in
  // place; the ledger below updates live.
  const toggleStatus = (st: string) => {
    setPage(1);
    setFilters((prev) => ({
      ...prev,
      status: prev.status.includes(st) ? prev.status.filter((x) => x !== st) : [...prev.status, st],
    }));
  };
  const toggleType = (t: string) => {
    setPage(1);
    setFilters((prev) => ({
      ...prev,
      donationType: prev.donationType.includes(t)
        ? prev.donationType.filter((x) => x !== t)
        : [...prev.donationType, t],
    }));
  };
  const clearStatus = () => {
    setPage(1);
    setFilters((prev) => ({ ...prev, status: [] }));
  };
  const clearType = () => {
    setPage(1);
    setFilters((prev) => ({ ...prev, donationType: [] }));
  };
  const hasActiveFilters =
    filters.status.length > 0 ||
    filters.channel !== null ||
    filters.donationType.length > 0 ||
    filters.q !== null ||
    filters.blockId !== null ||
    filters.from !== null ||
    filters.to !== null;
  const resetFilters = () => {
    setPage(1);
    setFilters(EMPTY_FILTERS);
    setFilterResetKey((k) => k + 1);
  };
  const onDone = () => {
    void refreshSummary();
    void loadLedger(filters, page);
    setReconcileVersion((v) => v + 1);
  };

  // Clear the donor-form session, then refresh so the server page re-renders the login form.
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/donor-form/logout", { method: "POST" });
      router.refresh();
    } catch {
      setLoggingOut(false);
    }
  };

  const meta = VIEW_META[view];
  const lastRun = summary.lastRun;

  return (
    <div className="flex min-h-screen bg-gray-50 text-gray-900">
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-y-auto bg-slate-900 text-slate-300 transition-transform duration-200 md:sticky md:bottom-auto md:top-0 md:h-screen md:self-start md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-white">SBVT Donor Care and Accounts</div>
            <div className="text-[11px] text-slate-400">Birnagar Temple Project</div>
          </div>
          <button className="text-slate-400 md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <IconClose />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ key, label, Icon }) => {
            const active = view === key;
            return (
              <button
                key={key}
                onClick={() => navTo(key)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-indigo-600 text-white shadow-sm" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <Icon className={active ? "text-white" : "text-slate-400"} />
                {label}
              </button>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-slate-800 p-3">
          <RunReconButton onDone={onDone} />
          <div className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
              {username.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-white">{username}</div>
              <div className="text-[10px] text-slate-400">Logged in as admin</div>
            </div>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              title="Log out"
              aria-label="Log out"
              className="ml-auto shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white disabled:opacity-50"
            >
              <IconLogout width={16} height={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-gray-200 bg-white/80 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button className="text-gray-500 md:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
              <IconMenu />
            </button>
            <div>
              <h1 className="text-base font-semibold text-gray-900">{meta.title}</h1>
              <p className="hidden text-xs text-gray-500 sm:block">{meta.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {wolStatus && (
              <span
                title="Wall-of-Legacy WhatsApp messages sent today vs the daily limit"
                className={`hidden items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium sm:inline-flex ${
                  wolStatus.remaining > 0 ? "bg-indigo-50 text-indigo-700" : "bg-rose-50 text-rose-700"
                }`}
              >
                WhatsApp {wolStatus.sentToday}/{wolStatus.limit} · {wolStatus.remaining} left
              </span>
            )}
            {lastRun && (
              <span
                className={`hidden items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium sm:inline-flex ${
                  lastRun.closureOk ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
                }`}
              >
                {lastRun.closureOk && <IconCheck width={12} height={12} />}
                {`Last Reconciled by ${lastRun.triggeredBy ?? "unknown"}`}
                {lastRun.finishedAt ? ` on ${lastRun.finishedAt.slice(0, 16).replace("T", " ")}` : ""}
              </span>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">
          {view === "overview" && (
            <div className="flex flex-col gap-6">
              <SummaryCards summary={summary} onOpenWorkbench={() => navTo("workbench")} />
              <OverviewStats summary={summary} awaitingReplyCount={awaitingReplyCount} />
            </div>
          )}

          {view === "ledger" &&
            (ledgerId ? (
              <LedgerDetail key={ledgerId} id={ledgerId} onBack={closeLedgerDetail} />
            ) : (
              <section className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <IconLedger className="text-gray-400" />
                  <h2 className="text-sm font-semibold text-gray-700">Ledger</h2>
                  <span className="text-xs text-gray-400">· every contribution</span>
                  <button
                    onClick={resetFilters}
                    disabled={!hasActiveFilters}
                    className="ml-auto rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Reset filters
                  </button>
                </div>
                <LedgerFilters
                  summary={summary}
                  statusFilter={filters.status}
                  typeFilter={filters.donationType}
                  onToggleStatus={toggleStatus}
                  onToggleType={toggleType}
                  onClearStatus={clearStatus}
                  onClearType={clearType}
                />
                <LedgerTable
                  rows={ledger.data}
                  total={ledger.total}
                  page={page}
                  pageSize={ledger.pageSize}
                  filters={filters}
                  loading={loading}
                  onFilterChange={(partial) => {
                    setPage(1);
                    setFilters((prev) => ({ ...prev, ...partial }));
                  }}
                  onPage={setPage}
                  onOpenRow={openLedgerRow}
                  resetKey={filterResetKey}
                />
              </section>
            ))}

          {view === "upload" && (
            <div className="flex flex-col gap-5">
              <UploadPanel onUploaded={refreshSummary} />
              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h3 className="mb-2 text-sm font-semibold text-gray-800">Recent imports</h3>
                {summary.lastBatches.length === 0 ? (
                  <p className="text-xs text-gray-400">No statements imported yet.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {summary.lastBatches.map((b, i) => (
                      <li key={i} className="flex items-center justify-between py-2 text-xs">
                        <span className="font-medium text-gray-700">{batchKindLabel(b.kind)}</span>
                        <span className="text-gray-500">
                          {b.rowsTotal} rows
                          {b.periodStart && ` · covers ${b.periodStart.slice(0, 10)}→${b.periodEnd?.slice(0, 10) ?? "?"}`}
                          {` · ${b.createdAt.slice(0, 16).replace("T", " ")}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}

          {view === "breakdowns" && <Breakdowns refreshKey={reconcileVersion} />}

          {view === "workbench" &&
            (orphanMatchId ? (
              <OrphanDetail key={orphanMatchId} matchId={orphanMatchId} onBack={closeOrphanDetail} />
            ) : (
              <MatchWorkbench onOpenRow={openOrphanRow} />
            ))}

          {view === "whatsappCare" && (
            <WhatsAppCare username={username} onWolSent={refreshWolStatus} />
          )}

          {view === "receipts" && <Receipts />}
        </main>
      </div>
    </div>
  );
}
