"use client";

import { useCallback, useEffect, useState } from "react";
import type { ContributionDetail, StatementSource } from "@/lib/reconciliation/ledger-detail";
import {
  DONATION_TYPE_LABEL,
  formatPaiseExact,
  isDetailViewable,
  STATUS_LABEL,
  statusBadgeClass,
} from "@/lib/reconciliation/format";

const MATCH_TYPE_LABEL: Record<string, string> = {
  auto_reference: "Auto · reference",
  manual: "Manual",
  auto_fuzzy_suggested: "Auto · fuzzy",
};

function fmtDateTime(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace("T", " ") : "—";
}

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

function BackButton({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <button onClick={onBack} className="self-start text-sm text-indigo-600 hover:underline">
      {label}
    </button>
  );
}

export function LedgerDetail({
  id,
  onBack,
  backLabel = "← Back to ledger",
}: {
  id: string;
  onBack: () => void;
  backLabel?: string;
}) {
  const [detail, setDetail] = useState<ContributionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // The detail is fetched client-side so the table can be swapped for it in place (the
  // sidebar stays visible). The component is keyed by id in the shell, so this loads once
  // per opened row.
  const loadDetail = useCallback(async (rowId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/reconciliation/ledger/${encodeURIComponent(rowId)}`, {
        cache: "no-store",
      });
      setDetail(res.ok ? ((await res.json()) as ContributionDetail | null) : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDetail(id);
  }, [id, loadDetail]);

  if (loading) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <BackButton onBack={onBack} label={backLabel} />
        <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white py-20 shadow-sm">
          <div className="flex flex-col items-center gap-3 text-gray-400">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-indigo-500" />
            <span className="text-sm">Loading transaction detail…</span>
          </div>
        </div>
      </div>
    );
  }

  // Drillable statuses: the matched set (MATCHED / OVERPAID / UNDERPAID) plus UNVERIFIED
  // (no statement source yet, but donor / address detail is worth viewing). Guards
  // direct-link access to non-drillable rows (cash, pledge, refunded…) and unknown ids.
  if (!detail || !isDetailViewable(detail.status)) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <BackButton onBack={onBack} label={backLabel} />
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-gray-800">No detail to show</h1>
          <p className="mt-1 text-sm text-gray-500">
            This contribution isn’t a drillable line (e.g. cash, pledge or refunded), so there’s no
            transaction detail to show.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <BackButton onBack={onBack} label={backLabel} />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-gray-900">
            {detail.donorName || "Unnamed donor"}
          </h1>
          <span
            className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium ${statusBadgeClass(
              detail.status,
            )}`}
          >
            {STATUS_LABEL[detail.status] ?? detail.status}
          </span>
          <span
            className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium ${
              detail.donationType === "general"
                ? "border-teal-200 bg-teal-50 text-teal-700"
                : "border-indigo-200 bg-indigo-50 text-indigo-700"
            }`}
          >
            {DONATION_TYPE_LABEL[detail.donationType]}
          </span>
          <span className="text-xs text-gray-400">contribution #{detail.id}</span>
        </div>
        {detail.flags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {detail.flags.map((f) => (
              <span
                key={f}
                className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
              >
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Money summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Expected" value={formatPaiseExact(detail.expectedPaise)} />
        <SummaryCard label="Received" value={formatPaiseExact(detail.matchedPaise)} />
        <SummaryCard
          label="Variance"
          value={detail.variancePaise === 0 ? "—" : formatPaiseExact(detail.variancePaise)}
          tone={detail.variancePaise > 0 ? "green" : detail.variancePaise < 0 ? "red" : undefined}
        />
        <SummaryCard label="Receipt eligible" value={detail.receiptEligible ? "Yes" : "No"} />
      </div>

      {/* Contribution details */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-800">Contribution</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
          <Field label="Donor name" value={detail.donorName ?? "—"} />
          <Field label="Phone" value={detail.donorPhone ?? "—"} />
          <Field label="Email" value={detail.donorEmail ?? "—"} />
          <Field label="Payment channel" value={detail.paymentChannel} />
          <Field label="Reference" value={detail.paymentReference ?? "—"} mono />
          <Field label="Action" value={detail.actionType ?? "—"} />
          <Field label="Block" value={detail.blockId ?? "—"} />
          <Field label="Serial" value={detail.serialNumber ?? "—"} mono />
          <Field label="Quantity" value={String(detail.qty)} />
          <Field label="Source type" value={detail.sourceType} />
          <Field label="Contributed" value={fmtDateTime(detail.contributedAt)} />
          <Field label="Reconciled" value={fmtDateTime(detail.reconciledAt)} />
        </dl>
      </div>

      {/* Submitted address & PAN — the address / PAN / donation type captured with the
          donation itself (block_submissions for wall gifts, birnagar donations for
          general). Shown only when at least one of these was collected. */}
      {(detail.address || detail.city || detail.state || detail.pincode || detail.panNo || detail.donationCategory) && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-gray-800">Submitted address &amp; PAN</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
            <div className="sm:col-span-3">
              <dt className="text-[10px] uppercase tracking-wide text-gray-400">Address</dt>
              <dd className="whitespace-pre-wrap text-gray-800">{detail.address ?? "—"}</dd>
            </div>
            <Field label="City" value={detail.city ?? "—"} />
            <Field label="State" value={detail.state ?? "—"} />
            <Field label="Pincode" value={detail.pincode ?? "—"} />
            <Field label="PAN" value={detail.panNo ?? "—"} mono />
            {detail.donationCategory && <Field label="Donation type" value={detail.donationCategory} />}
          </dl>
        </div>
      )}

      {/* Receipt details (from WhatsApp) — the legal name + address the donor sent over
          WhatsApp for their tax receipt. Shown only when this number has an intake. */}
      {detail.receiptInfo && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-gray-800">Receipt details (from WhatsApp)</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
            <Field label="Legal name" value={detail.receiptInfo.legalName ?? "—"} />
            <Field label="WhatsApp" value={detail.receiptInfo.whatsapp} mono />
            <Field label="Pincode" value={detail.receiptInfo.pincode ?? "—"} />
            <div className="sm:col-span-3">
              <dt className="text-[10px] uppercase tracking-wide text-gray-400">Address</dt>
              <dd className="whitespace-pre-wrap text-gray-800">{detail.receiptInfo.address ?? "—"}</dd>
            </div>
            <Field label="Intake status" value={detail.receiptInfo.intakeStatus ?? "—"} />
          </dl>
        </div>
      )}

      {/* Statement sources */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-800">
          Statement source{detail.sources.length === 1 ? "" : "s"} ({detail.sources.length})
        </h2>
        <p className="text-[11px] text-gray-500">
          Where the received money was matched from — the imported gateway / UPI statement
          row(s) this contribution reconciled against.
        </p>

        {detail.sharedAcross > 1 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            This payment covers <span className="font-semibold">{detail.sharedAcross} names</span> under
            one reference. The statement amount below is the <span className="font-semibold">whole
            payment</span>; this line’s share is {formatPaiseExact(detail.matchedPaise)} of it.
            {detail.sourceViaGroup &&
              " The statement is attached to the group’s primary line — shown here via the shared reference."}
          </div>
        )}

        {detail.sources.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-500 shadow-sm">
            {detail.status === "UNVERIFIED" ? (
              <>
                This contribution hasn’t been verified against a statement yet — the gateway / UPI
                export covering its date hasn’t been uploaded, so the payment can’t be confirmed.
              </>
            ) : (
              <>
                This line is marked {STATUS_LABEL[detail.status] ?? detail.status} but the linked
                statement row could not be located (it may have been removed in a later import).
              </>
            )}
            {detail.paymentReference && (
              <>
                {" "}
                Reference: <span className="font-mono">{detail.paymentReference}</span>.
              </>
            )}
          </div>
        ) : (
          detail.sources.map((s) => <SourceCard key={s.matchId} s={s} />)
        )}
      </div>
    </div>
  );
}

function SourceCard({ s }: { s: StatementSource }) {
  const isGateway = s.source === "gateway";
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Source header */}
      <div
        className={`flex flex-wrap items-center gap-2 border-b px-4 py-2.5 ${
          isGateway
            ? "border-blue-100 bg-blue-50/60"
            : "border-emerald-100 bg-emerald-50/60"
        }`}
      >
        <span
          className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
            isGateway
              ? "border-blue-200 bg-blue-100 text-blue-800"
              : "border-emerald-200 bg-emerald-100 text-emerald-800"
          }`}
        >
          {s.sourceLabel}
        </span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
          {MATCH_TYPE_LABEL[s.matchType] ?? s.matchType}
        </span>
        {s.confidence != null && (
          <span className="text-[10px] text-gray-500">
            confidence {Math.round(s.confidence * 100) / 100}
          </span>
        )}
        <span className="ml-auto text-sm font-semibold text-gray-900">
          {formatPaiseExact(s.matchedPaise)}
        </span>
      </div>

      <div className="p-4">
        {/* Normalised txn fields */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
          <Field label="Reference" value={s.txn.reference ?? "—"} mono />
          <Field label="Merchant txn id" value={s.txn.merchantTranId ?? "—"} mono />
          <Field label="RRN" value={s.txn.rrn ?? "—"} mono />
          <Field label="Gross amount" value={formatPaiseExact(s.txn.amountPaise)} />
          {isGateway && <Field label="Charges" value={formatPaiseExact(s.txn.chargesPaise ?? 0)} />}
          {isGateway && <Field label="Net amount" value={formatPaiseExact(s.txn.netAmountPaise ?? 0)} />}
          <Field label="Status" value={s.txn.status} />
          {isGateway && s.txn.reconciliationStatus != null && (
            <Field label="Recon. status" value={s.txn.reconciliationStatus} />
          )}
          {!isGateway && s.txn.refundStatus != null && (
            <Field label="Refund status" value={s.txn.refundStatus} />
          )}
          <Field label="Success" value={s.txn.isSuccess ? "Yes" : "No"} />
          <Field label="Refund" value={s.txn.isRefund ? "Yes" : "No"} />
          <Field label="Customer" value={s.txn.customerName ?? "—"} />
          <Field label="Mobile" value={s.txn.customerMobile ?? "—"} />
          {!isGateway && <Field label="VPA" value={s.txn.customerVPA ?? "—"} mono />}
          <Field label="Txn date" value={fmtDateTime(s.txn.transactionDate)} />
        </dl>

        {s.note && (
          <p className="mt-3 rounded bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600">
            <span className="font-medium text-gray-500">Match note: </span>
            {s.note}
          </p>
        )}

        {/* Provenance: which import this row came from */}
        <div className="mt-3 border-t border-gray-100 pt-2 text-[11px] text-gray-500">
          From{" "}
          <span className="font-medium text-gray-700">
            {s.batch.filename || `${s.batch.kind} batch #${s.batch.id}`}
          </span>
          {s.batch.periodStart && (
            <>
              {" "}
              · covers {fmtDate(s.batch.periodStart)}→{fmtDate(s.batch.periodEnd)}
            </>
          )}{" "}
          · imported {fmtDateTime(s.batch.uploadedAt)} · matched {fmtDateTime(s.matchedAt)}
        </div>

        {/* Full raw CSV row */}
        {Object.keys(s.txn.rawRow).length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] font-medium text-indigo-600 hover:underline">
              Raw statement row
            </summary>
            <div className="mt-2 overflow-x-auto rounded-lg border border-gray-100 bg-gray-50">
              <table className="min-w-full text-[11px]">
                <tbody className="divide-y divide-gray-100">
                  {Object.entries(s.txn.rawRow).map(([k, v]) => (
                    <tr key={k}>
                      <td className="whitespace-nowrap px-2 py-1 align-top font-medium text-gray-500">
                        {k}
                      </td>
                      <td className="px-2 py-1 font-mono text-gray-700">
                        {v === null || v === undefined
                          ? "—"
                          : typeof v === "object"
                            ? JSON.stringify(v)
                            : String(v)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "red";
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div
        className={`text-lg font-semibold ${
          tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "text-gray-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className={`text-gray-800 ${mono ? "font-mono text-[11px] break-all" : ""}`}>{value}</dd>
    </div>
  );
}
