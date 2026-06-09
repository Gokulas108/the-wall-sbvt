"use client";

import { useCallback, useEffect, useState } from "react";
import { formatPaiseExact } from "@/lib/reconciliation/format";

interface OrphanTxn {
  reference: string | null;
  merchantTranId: string | null;
  rrn: string | null;
  amountPaise: number;
  chargesPaise: number | null;
  netAmountPaise: number | null;
  status: string;
  reconciliationStatus: string | null;
  refundStatus: string | null;
  customerVPA: string | null;
  originalTransactionId: string | null;
  isSuccess: boolean;
  isRefund: boolean;
  customerName: string | null;
  customerMobile: string | null;
  transactionDate: string | null;
  rawRow: Record<string, unknown>;
}

interface OrphanBatch {
  id: number;
  kind: string;
  filename: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  uploadedAt: string;
}

interface OrphanDetailData {
  matchId: number;
  kind: "gateway" | "upi";
  reference: string;
  amountPaise: number;
  payerName: string | null;
  phone: string | null;
  date: string | null;
  isRefund: boolean;
  isSuccess: boolean;
  note: string | null;
  abandoned: string | null;
  txn: OrphanTxn;
  batch: OrphanBatch;
}

function fmtDateTime(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace("T", " ") : "—";
}

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="self-start text-sm text-indigo-600 hover:underline">
      ← Back to orphan donations
    </button>
  );
}

export function OrphanDetail({ matchId, onBack }: { matchId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<OrphanDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/reconciliation/orphans/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      setDetail(res.ok ? ((await res.json()) as OrphanDetailData | null) : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDetail(matchId);
  }, [matchId, loadDetail]);

  if (loading) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <BackButton onBack={onBack} />
        <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white py-20 shadow-sm">
          <div className="flex flex-col items-center gap-3 text-gray-400">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-indigo-500" />
            <span className="text-sm">Loading transaction detail…</span>
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <BackButton onBack={onBack} />
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-gray-800">Transaction not found</h1>
          <p className="mt-1 text-sm text-gray-500">
            This payment is no longer an orphan — it may have been attributed to a donor in a
            later reconciliation, or removed in a re-import.
          </p>
        </div>
      </div>
    );
  }

  const isGateway = detail.kind === "gateway";
  const t = detail.txn;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <BackButton onBack={onBack} />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-gray-900">
            {detail.payerName || "Unknown payer"}
          </h1>
          <span className="inline-block rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-medium uppercase text-gray-600">
            {detail.kind}
          </span>
          {detail.isRefund && (
            <span className="inline-block rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
              refund
            </span>
          )}
          {detail.abandoned && (
            <span className="inline-block rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
              abandoned: {detail.abandoned}
            </span>
          )}
          <span className="text-xs text-gray-400">orphan · no donor attached</span>
        </div>
      </div>

      {/* Money summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Amount" value={formatPaiseExact(detail.amountPaise)} />
        {isGateway ? (
          <>
            <SummaryCard label="Charges" value={formatPaiseExact(t.chargesPaise ?? 0)} />
            <SummaryCard label="Net amount" value={formatPaiseExact(t.netAmountPaise ?? 0)} />
          </>
        ) : (
          <SummaryCard label="Gross amount" value={formatPaiseExact(t.amountPaise)} />
        )}
        <SummaryCard label="Status" value={t.status} />
      </div>

      {/* Transaction details */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-800">Transaction</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
          <Field label="Reference" value={t.reference ?? "—"} mono />
          <Field label="Merchant txn id" value={t.merchantTranId ?? "—"} mono />
          <Field label="RRN" value={t.rrn ?? "—"} mono />
          {isGateway && t.reconciliationStatus != null && (
            <Field label="Recon. status" value={t.reconciliationStatus} />
          )}
          {!isGateway && t.refundStatus != null && (
            <Field label="Refund status" value={t.refundStatus} />
          )}
          {isGateway && t.originalTransactionId != null && (
            <Field label="Original txn id" value={t.originalTransactionId} mono />
          )}
          <Field label="Success" value={t.isSuccess ? "Yes" : "No"} />
          <Field label="Refund" value={t.isRefund ? "Yes" : "No"} />
          <Field label="Customer" value={t.customerName ?? "—"} />
          <Field label="Mobile" value={t.customerMobile ?? "—"} />
          {!isGateway && <Field label="VPA" value={t.customerVPA ?? "—"} mono />}
          <Field label="Txn date" value={fmtDateTime(t.transactionDate)} />
        </dl>

        {detail.note && (
          <p className="mt-3 rounded bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600">
            <span className="font-medium text-gray-500">Note: </span>
            {detail.note}
          </p>
        )}

        {/* Provenance: which import this row came from */}
        <div className="mt-3 border-t border-gray-100 pt-2 text-[11px] text-gray-500">
          From{" "}
          <span className="font-medium text-gray-700">
            {detail.batch.filename || `${detail.batch.kind} batch #${detail.batch.id}`}
          </span>
          {detail.batch.periodStart && (
            <>
              {" "}
              · covers {fmtDate(detail.batch.periodStart)}→{fmtDate(detail.batch.periodEnd)}
            </>
          )}{" "}
          · imported {fmtDateTime(detail.batch.uploadedAt)}
        </div>

        {/* Full raw CSV row */}
        {Object.keys(t.rawRow).length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] font-medium text-indigo-600 hover:underline">
              Raw statement row
            </summary>
            <div className="mt-2 overflow-x-auto rounded-lg border border-gray-100 bg-gray-50">
              <table className="min-w-full text-[11px]">
                <tbody className="divide-y divide-gray-100">
                  {Object.entries(t.rawRow).map(([k, v]) => (
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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
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
