"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { formatINR } from "@/lib/mosaic/engine";

type ReceiptData = {
  trust_name?: string;
  serial_number: string;
  action_type?: string;
  donor_name?: string;
  name?: string;
  qty: number;
  total_amount?: number;
  phone?: string;
  whatsapp?: string;
  email?: string;
  created_at: string;
  block_id?: string;
  txn_id?: string;
  payment_method?: string | null;
  payment_reference?: string | null;
  allocations: Array<{
    block_id: string;
    qty: number;
    amount?: number;
    serial_number?: string;
  }>;
};

function fmtPaymentMethod(m: string | null | undefined): string {
  if (!m) return "—";
  const lower = m.toLowerCase();
  if (lower === "online") return "Online Payment";
  if (lower === "cash") return "Cash";
  if (lower === "upi") return "UPI";
  if (lower === "pledge") return "Pledge";
  return m.charAt(0).toUpperCase() + m.slice(1);
}

const TRUST_NAME = "Kirtan Seva Trust";

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p
        className="text-xs uppercase tracking-[0.1em]"
        style={{ color: "rgba(255,221,168,0.82)" }}
      >
        {label}
      </p>
      <p style={{ color: "#fff4e3" }}>{value}</p>
    </div>
  );
}

function ReceiptViewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const txnID = searchParams.get("txnID");
  const submissionId = searchParams.get("id");
  const amount = searchParams.get("amount");

  const isInvalid = !txnID && !submissionId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const lookupAttemptedRef = useRef(false);

  const totalAssigned = useMemo(() => {
    if (!receipt) return 0;
    return receipt.allocations.reduce((sum, item) => sum + item.qty, 0);
  }, [receipt]);

  const lookupRecord = useCallback(async () => {
    if ((!txnID && !submissionId) || lookupAttemptedRef.current) return;
    lookupAttemptedRef.current = true;
    setLoading(true);
    setError("");

    try {
      const qs = submissionId
        ? `id=${encodeURIComponent(submissionId)}`
        : `txnID=${encodeURIComponent(txnID!)}`;
      const res = await fetch(`/api/payment/receipt-view?${qs}`);
      const data = (await res.json()) as { found: boolean; receipt?: ReceiptData; error?: string };
      if (data.found && data.receipt) {
        setReceipt(data.receipt);
      } else {
        setError("Receipt not found for this donation.");
      }
    } catch {
      setError("Unable to load the receipt right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [txnID, submissionId]);

  useEffect(() => {
    if (!isInvalid) void lookupRecord();
  }, [isInvalid, lookupRecord]);

  const parsedAmount = parseFloat(amount || "0");

  if (isInvalid) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6"
        style={{
          background:
            "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
        }}
      >
        <div
          className="w-full max-w-xl rounded-2xl p-6 text-center"
          style={{
            background: "rgba(26,14,8,0.9)",
            border: "1px solid rgba(228,180,121,0.3)",
            boxShadow: "0 28px 70px rgba(0,0,0,0.45)",
          }}
        >
          <h1
            className="text-2xl font-bold mb-2"
            style={{ fontFamily: '"Playfair Display", serif', color: "#fff4e3" }}
          >
            Invalid Receipt Link
          </h1>
          <p className="text-sm mb-6" style={{ color: "rgba(244,224,197,0.86)" }}>
            The transaction ID is missing from this link.
          </p>
          <Link
            href="/wall-frame"
            className="inline-block px-6 py-3 rounded-lg text-sm font-bold"
            style={{ background: "linear-gradient(135deg, #c96b1b, #e0b860)", color: "#fff" }}
          >
            Back to Wall of Legacy
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6"
        style={{
          background:
            "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
        }}
      >
        <div
          className="w-full max-w-2xl rounded-2xl p-5 sm:p-8 text-center"
          style={{
            background: "rgba(26,14,8,0.9)",
            border: "1px solid rgba(228,180,121,0.3)",
            boxShadow: "0 28px 70px rgba(0,0,0,0.45)",
          }}
        >
          <div className="flex flex-col items-center gap-4">
            <span
              className="inline-block h-10 w-10 animate-spin rounded-full border-3 border-[#f6d8af] border-r-transparent"
              aria-hidden="true"
            />
            <p className="text-sm" style={{ color: "rgba(245,232,216,0.9)" }}>
              Loading receipt…
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !receipt) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6"
        style={{
          background:
            "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
        }}
      >
        <div
          className="w-full max-w-xl rounded-2xl p-6 text-center"
          style={{
            background: "rgba(26,14,8,0.9)",
            border: "1px solid rgba(228,180,121,0.3)",
            boxShadow: "0 28px 70px rgba(0,0,0,0.45)",
          }}
        >
          <h1
            className="text-2xl font-bold mb-2"
            style={{ fontFamily: '"Playfair Display", serif', color: "#fff4e3" }}
          >
            Receipt Unavailable
          </h1>
          <p className="text-sm mb-6" style={{ color: "rgba(244,224,197,0.86)" }}>
            {error || "We couldn't load this receipt."}
          </p>
          <Link
            href="/wall-frame"
            className="inline-block px-6 py-3 rounded-lg text-sm font-bold"
            style={{ background: "linear-gradient(135deg, #c96b1b, #e0b860)", color: "#fff" }}
          >
            Back to Wall of Legacy
          </Link>
        </div>
      </div>
    );
  }

  const donorName = receipt.donor_name || receipt.name || "Donor";

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6"
      style={{
        background:
          "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
      }}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl p-5 sm:p-8"
        style={{
          background: "rgba(26,14,8,0.9)",
          border: "1px solid rgba(228,180,121,0.3)",
          boxShadow: "0 28px 70px rgba(0,0,0,0.45)",
        }}
      >
        <p
          className="text-xs uppercase tracking-[0.18em]"
          style={{ color: "rgba(255,221,168,0.82)" }}
        >
          Receipt issued by {receipt.trust_name || TRUST_NAME} for
        </p>
        <h2
          className="text-5xl sm:text-6xl mt-2 pb-4"
          style={{
            color: "#ffd79c",
            fontFamily: '"Dancing Script", cursive',
            textShadow: "0 8px 24px rgba(0,0,0,0.35)",
            borderBottom: "1px solid rgba(228,180,121,0.22)",
          }}
        >
          {donorName}
        </h2>
        <h1
          className="text-2xl sm:text-3xl font-bold mt-2"
          style={{ color: "#fff4e3", fontFamily: '"Playfair Display", serif' }}
        >
          Donation Receipt
        </h1>

        <div className="grid sm:grid-cols-2 gap-3 mt-5">
          <Info label="Donor" value={donorName} />
          <Info
            label="Date"
            value={new Date(receipt.created_at).toLocaleString("en-IN")}
          />
          {receipt.serial_number && (
            <Info label="Serial Number" value={receipt.serial_number} />
          )}
          {(receipt.payment_reference || txnID) && (
            <Info label="Transaction ID" value={receipt.payment_reference || txnID || "—"} />
          )}
          <Info label="Total Names" value={`${receipt.qty || "—"}`} />
          <Info
            label="Total Amount"
            value={`₹${formatINR(receipt.total_amount || parsedAmount)}`}
          />
          <Info label="Payment Method" value={fmtPaymentMethod(receipt.payment_method)} />
          {receipt.block_id && <Info label="Block" value={receipt.block_id} />}
          {receipt.phone && <Info label="Phone" value={receipt.phone} />}
          {receipt.email && <Info label="Email" value={receipt.email} />}
        </div>

        {receipt.allocations.length > 0 && (
          <div className="mt-6">
            <p
              className="text-xs uppercase tracking-[0.14em] mb-2"
              style={{ color: "rgba(255,221,168,0.82)" }}
            >
              Block Allocation Summary
            </p>
            <div
              className="rounded-xl overflow-hidden"
              style={{ border: "1px solid rgba(228,180,121,0.2)" }}
            >
              <table className="w-full text-sm">
                <thead style={{ background: "rgba(255,246,233,0.08)" }}>
                  <tr>
                    <th className="text-left px-3 py-2" style={{ color: "#ffe9cc" }}>Block</th>
                    <th className="text-right px-3 py-2" style={{ color: "#ffe9cc" }}>Qty</th>
                    <th className="text-right px-3 py-2" style={{ color: "#ffe9cc" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.allocations.map((alloc, idx) => (
                    <tr
                      key={idx}
                      style={{
                        borderTop: "1px solid rgba(228,180,121,0.1)",
                        background:
                          idx % 2 === 0 ? "transparent" : "rgba(255,246,233,0.02)",
                      }}
                    >
                      <td className="px-3 py-2" style={{ color: "#fff4e3" }}>{alloc.block_id}</td>
                      <td className="text-right px-3 py-2" style={{ color: "#fff4e3" }}>{alloc.qty}</td>
                      <td className="text-right px-3 py-2" style={{ color: "#ffd79c" }}>
                        ₹{formatINR(alloc.amount ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div
          className="mt-4 rounded-lg p-3 text-center"
          style={{
            background: "rgba(255,246,233,0.05)",
            border: "1px dashed rgba(228,180,121,0.3)",
          }}
        >
          <p
            className="text-xs uppercase tracking-[0.12em]"
            style={{ color: "rgba(255,221,168,0.82)" }}
          >
            Total Assigned
          </p>
          <p className="text-xl sm:text-2xl font-bold" style={{ color: "#ffd79c" }}>
            {totalAssigned} Names
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
            style={{
              background: "rgba(255,246,233,0.1)",
              border: "1px solid rgba(228,180,121,0.26)",
              color: "#ffe9cc",
            }}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            Back
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{
              background: "linear-gradient(135deg, #c96b1b, #e0b860)",
              color: "#fff",
            }}
          >
            Save as PDF
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ReceiptViewPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen w-full flex items-center justify-center"
          style={{
            background:
              "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
          }}
        >
          <div className="flex flex-col items-center gap-3">
            <span
              className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-[#f6d8af] border-r-transparent"
              aria-hidden="true"
            />
            <p className="text-sm" style={{ color: "rgba(255,221,168,0.82)" }}>
              Loading receipt…
            </p>
          </div>
        </div>
      }
    >
      <ReceiptViewContent />
    </Suspense>
  );
}
