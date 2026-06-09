"use client";

import { useEffect, useState } from "react";
import type { NumberDetail } from "@/lib/whatsapp-care/address-collection";
import { formatPaise, STATUS_LABEL, statusBadgeClass } from "@/lib/reconciliation/format";

const TXN_PAGE_SIZE = 25;

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="self-start text-sm text-indigo-600 hover:underline">
      ← Back to WhatsApp Care
    </button>
  );
}

export function WhatsAppCareDetail({
  detail,
  loading,
  onBack,
  onSaved,
  isSender,
  sending,
  onSend,
}: {
  detail: NumberDetail | null;
  loading: boolean;
  onBack: () => void;
  onSaved: () => void;
  isSender: boolean;
  sending: boolean;
  onSend: (num: string) => void;
}) {
  const row = detail?.row ?? null;
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [txnPage, setTxnPage] = useState(1);

  // The record loads after mount (and re-loads after a save), so seed the notes draft from
  // the persisted value whenever it changes — a save returns the same value, so in-flight
  // edits aren't clobbered.
  useEffect(() => {
    setNotes(row?.notes ?? "");
  }, [row?.notes]);

  async function saveAnnotation(patch: { isInvalid?: boolean; notes?: string }) {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/whatsapp-care/annotation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: detail.normalizedNumber, ...patch }),
      });
      if (res.ok) onSaved();
    } finally {
      setBusy(false);
    }
  }

  // No data yet → the row was just opened (or switched); show a loader in place of the table.
  if (!detail) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <BackButton onBack={onBack} />
        <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white py-20 shadow-sm">
          <div className="flex flex-col items-center gap-3 text-gray-400">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-indigo-500" />
            <span className="text-sm">Loading number details…</span>
          </div>
        </div>
      </div>
    );
  }

  if (!detail.found || !row || !detail.summary) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <BackButton onBack={onBack} />
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-gray-800">No transactions for this number</h1>
          <p className="mt-1 text-sm text-gray-500">
            Nothing on the wall maps to {detail.displayNumber}.
          </p>
        </div>
      </div>
    );
  }

  const s = detail.summary;
  const totalTxnPages = Math.max(1, Math.ceil(row.txns.length / TXN_PAGE_SIZE));
  const pageClamped = Math.min(txnPage, totalTxnPages);
  const pagedTxns = row.txns.slice((pageClamped - 1) * TXN_PAGE_SIZE, pageClamped * TXN_PAGE_SIZE);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <BackButton onBack={onBack} />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-xl font-semibold text-gray-900">{row.displayNumber}</h1>
          {loading && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-200 border-t-indigo-500" />
              updating…
            </span>
          )}
          {row.isInvalid && (
            <span className="rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800">
              flagged invalid
            </span>
          )}
          {row.needsReview && (
            <span
              title={row.reviewReasons.join(" · ")}
              className="rounded-full border border-rose-200 bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700"
            >
              needs review
            </span>
          )}
          {row.invalidPhone && (
            <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
              number doesn’t look valid
            </span>
          )}
          {row.hasUnverified && (
            <span className="rounded-full border border-yellow-200 bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-800">
              {row.unverifiedCount} unverified txn{row.unverifiedCount === 1 ? "" : "s"}
            </span>
          )}
          {row.awaitingReply && (
            <span className="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-800">
              no reply 24h+
            </span>
          )}
          {row.stalledIncomplete && (
            <span
              title={row.intakeStatus ? `Stalled at: ${row.intakeStatus}` : undefined}
              className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800"
            >
              stalled (24h+)
            </span>
          )}
          {row.whatsappStatus === "exists" && (
            <span className="rounded-full border border-green-200 bg-green-100 px-2 py-0.5 text-[11px] text-green-800">
              on WhatsApp
            </span>
          )}
          {row.whatsappStatus === "likely_invalid" && (
            <span className="rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-[11px] text-red-800">
              likely invalid
            </span>
          )}
        </div>
        {row.needsReview && row.reviewReasons.length > 0 && (
          <p className="text-[11px] text-rose-700">
            Needs review: {row.reviewReasons.join(" · ")}
          </p>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Transactions" value={String(s.totalTxns)} />
        <SummaryCard label="Names (qty)" value={String(s.totalQty)} />
        <SummaryCard label="Total" value={formatPaise(s.totalAmountPaise)} />
        <SummaryCard label="On other numbers" value={String(s.conflicts)} tone={s.conflicts > 0 ? "red" : undefined} />
      </div>

      {/* Breakdowns */}
      <div className="grid gap-3 md:grid-cols-2">
        <BreakdownCard title="By type">
          {s.byType.map((b) => (
            <BreakdownRow key={b.key} label={b.label} count={b.count} amountPaise={b.amountPaise} />
          ))}
        </BreakdownCard>
        <BreakdownCard title="By reconciliation status">
          {s.byStatus.map((b) => (
            <BreakdownRow
              key={b.key}
              label={STATUS_LABEL[b.key] ?? (b.key === "UNRECONCILED" ? "Not reconciled" : b.key)}
              badgeClass={b.key === "UNRECONCILED" ? "bg-gray-100 text-gray-600 border-gray-200" : statusBadgeClass(b.key)}
              count={b.count}
              amountPaise={b.amountPaise}
            />
          ))}
        </BreakdownCard>
      </div>

      {/* Contact / intake + annotation */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-gray-800">Contact & address intake</h2>
          <dl className="grid grid-cols-3 gap-x-2 gap-y-1.5 text-xs">
            <Field label="Messaged" value={row.messaged ? "Yes" : "No"} />
            <Field label="Replied" value={row.replied ? "Yes" : "No"} />
            <Field label="Intake status" value={row.intakeStatus ?? "—"} />
            <Field
              label="Last WoL sent"
              value={row.lastSentAt ? new Date(row.lastSentAt).toLocaleString() : "—"}
              span
            />
            <Field label="Legal name" value={row.intakeLegalName ?? "—"} span />
            <Field label="Address" value={row.intakeAddress ?? "—"} span />
            <Field label="Pincode" value={row.intakePincode ?? "—"} />
            <Field
              label="Last delivery"
              value={row.lastDeliveryStatus ? `${row.lastDeliveryStatus}${row.lastDeliveryAt ? ` · ${row.lastDeliveryAt.slice(0, 16).replace("T", " ")}` : ""}` : "—"}
              span
            />
          </dl>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-gray-800">Number health</h2>
          {isSender && (
            <button
              onClick={() => onSend(detail.normalizedNumber)}
              disabled={sending}
              title="Send the Wall-of-Legacy WhatsApp message to this number"
              className="mb-3 mr-2 rounded-md border border-emerald-300 bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send WoL message"}
            </button>
          )}
          <button
            onClick={() => void saveAnnotation({ isInvalid: !row.isInvalid })}
            disabled={busy}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
              row.isInvalid
                ? "border-red-300 bg-red-600 text-white hover:bg-red-700"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {row.isInvalid ? "Flagged invalid — click to clear" : "Mark number invalid"}
          </button>
          <div className="mt-3">
            <label className="text-[11px] font-medium text-gray-500">Notes</label>
            <textarea
              value={notes}
              disabled={busy}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes !== (row.notes ?? "")) void saveAnnotation({ notes });
              }}
              rows={3}
              placeholder="Notes about this number…"
              className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      {/* Donors */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-gray-800">
          Donor name{row.donorNames.length === 1 ? "" : "s"} ({row.donorNames.length})
        </h2>
        <p className="text-xs text-gray-700">{row.donorNames.join(", ") || "—"}</p>
        {row.multipleDonors && (
          <p className="mt-1 text-[11px] text-amber-700">
            Multiple distinct donor names share this number — collect an address per donor/transaction.
          </p>
        )}
      </div>

      {/* Transactions table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="border-b border-gray-200 bg-gray-50/70 text-left text-[10px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-2 py-2">Reference</th>
              <th className="px-2 py-2">Type</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Donor</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Amount</th>
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Serial</th>
              <th className="px-2 py-2">Conflict</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {pagedTxns.map((t) => (
              <tr key={t.submissionId} className={`hover:bg-gray-50 ${t.conflict ? "bg-red-50/40" : ""}`}>
                <td className="px-2 py-1.5">
                  {t.reference ? (
                    <span className="font-mono text-[11px] text-gray-800">{t.reference}</span>
                  ) : (
                    <span className="text-[11px] text-gray-400">no reference</span>
                  )}
                  {t.referenceKind && (
                    <span className="ml-1 rounded bg-gray-100 px-1 text-[9px] uppercase text-gray-500">
                      {t.referenceKind === "submission" ? "typed" : t.referenceKind}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5">{t.typeLabel}</td>
                <td className="px-2 py-1.5">
                  {t.status ? (
                    <span className={`rounded border px-1 py-0.5 text-[9px] ${statusBadgeClass(t.status)}`}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-400">not reconciled</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-gray-800">{t.donorName}</td>
                <td className="px-2 py-1.5 text-right text-gray-600">{t.qty}</td>
                <td className="px-2 py-1.5 text-right text-gray-700">{formatPaise(t.amountPaise)}</td>
                <td className="px-2 py-1.5 text-gray-500">{t.createdAt.slice(0, 10)}</td>
                <td className="px-2 py-1.5 font-mono text-[10px] text-gray-400">{t.serialNumber ?? "—"}</td>
                <td className="px-2 py-1.5">
                  {t.conflict ? (
                    <span
                      className="rounded bg-red-100 px-1 py-0.5 text-[9px] text-red-700"
                      title={`Same reference on: ${t.otherNumbers.join(", ")}`}
                    >
                      on {t.otherNumbers.length} other{t.otherNumbers.length === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalTxnPages > 1 && (
        <div className="flex items-center justify-between gap-2 text-xs text-gray-600">
          <span>
            {(pageClamped - 1) * TXN_PAGE_SIZE + 1}–{Math.min(pageClamped * TXN_PAGE_SIZE, row.txns.length)} of{" "}
            {row.txns.length} transactions
          </span>
          <div className="flex gap-1">
            <button
              disabled={pageClamped <= 1}
              onClick={() => setTxnPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1 font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              disabled={pageClamped >= totalTxnPages}
              onClick={() => setTxnPage((p) => p + 1)}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1 font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <div
      className={`rounded-xl border p-3 shadow-sm ${
        tone === "red" ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-lg font-semibold ${tone === "red" ? "text-red-700" : "text-gray-900"}`}>{value}</div>
    </div>
  );
}

function BreakdownCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-gray-800">{title}</h2>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function BreakdownRow({
  label,
  count,
  amountPaise,
  badgeClass,
}: {
  label: string;
  count: number;
  amountPaise: number;
  badgeClass?: string;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className={badgeClass ? `rounded border px-1.5 py-0.5 text-[10px] ${badgeClass}` : "text-gray-700"}>
        {label}
      </span>
      <span className="text-gray-500">
        {count} · {formatPaise(amountPaise)}
      </span>
    </div>
  );
}

function Field({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div className={span ? "col-span-3" : "col-span-1"}>
      <dt className="text-[10px] uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-gray-800">{value}</dd>
    </div>
  );
}
