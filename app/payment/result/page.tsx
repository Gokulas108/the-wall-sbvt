"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { formatINR } from "@/lib/mosaic/engine";

type PendingPaymentData = {
  block_id: string;
  name: string;
  qty: number;
  date_of_birth?: string;
  email?: string;
  phone: string;
  whatsapp: string;
  amount: number;
};

type ReceiptData = {
  trust_name: string;
  serial_number: string;
  action_type: string;
  donor_name: string;
  qty: number;
  total_amount: number;
  phone?: string;
  whatsapp?: string;
  email?: string;
  created_at: string;
  block_id: string;
  txn_id?: string;
  allocations: Array<{
    block_id: string;
    qty: number;
    amount: number;
    serial_number?: string;
  }>;
};

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

function PaymentResultContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const status = searchParams.get("status");
  const txnID = searchParams.get("txnID");
  const amount = searchParams.get("amount");
  const message = searchParams.get("message");
  // api_key from gateway — format: "api_<hmac-sha256-of-raw-key>"
  const apiKeyParam = searchParams.get("api_key");

  const isSuccess = status === "success";
  const isFailed = status === "failed" || status === "failure";
  // Also treat missing api_key as invalid on success
  const isInvalid = !status || !txnID || !amount || (isSuccess && !apiKeyParam);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [savedDone, setSavedDone] = useState(false);
  const saveAttemptedRef = useRef(false);

  // Read pending payment data from sessionStorage
  const pendingData = useMemo<PendingPaymentData | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem("kirtan-pending-payment");
      if (!raw) return null;
      return JSON.parse(raw) as PendingPaymentData;
    } catch {
      return null;
    }
  }, []);

  const totalAssigned = useMemo(() => {
    if (!receipt) return 0;
    return receipt.allocations.reduce((sum, item) => sum + item.qty, 0);
  }, [receipt]);

  // Save donor record on successful payment
  const saveDonorRecord = useCallback(async () => {
    if (!pendingData || !txnID || saveAttemptedRef.current) return;
    saveAttemptedRef.current = true;
    setSaving(true);
    setSaveError("");

    // Extract the hash from the URL (strip 'api_' prefix) and rawKey from sessionStorage.
    // Both are passed to /api/payment/confirm which re-hashes server-side and compares.
    const receivedHash = apiKeyParam?.startsWith("api_")
      ? apiKeyParam.slice(4)
      : null;
    const rawKey = (pendingData as Record<string, unknown>).api_key as string | undefined;

    if (!receivedHash || !rawKey) {
      setSaveError("Payment session could not be verified. Please contact support.");
      setSaving(false);
      setSavedDone(true);
      sessionStorage.removeItem("kirtan-pending-payment");
      return;
    }



    // ── Verification passed ─────────────────────────────────────────────────
    try {
      const res = await fetch("/api/payment/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...pendingData,
          txn_id: txnID,
          // Pass rawKey + hash to confirm — server re-hashes and verifies
          api_key: rawKey,
          api_key_hash: receivedHash,
        }),
      });
      const data = await res.json();
      if (data.success && data.receipt) {
        setReceipt(data.receipt);
        // Clear pending data from sessionStorage
        sessionStorage.removeItem("kirtan-pending-payment");
      } else {
        setSaveError(data.error || "Failed to save donation record.");
      }
    } catch {
      setSaveError("Network error. Your payment was successful but we couldn't save the record. Please contact support.");
    } finally {
      setSaving(false);
      setSavedDone(true);
    }
  }, [pendingData, txnID]);

  useEffect(() => {
    if (isSuccess && !isInvalid && pendingData && !savedDone) {
      void saveDonorRecord();
    }
    // Clear stale sessionStorage on failure or invalid — nothing to save
    if ((isFailed || isInvalid) && typeof window !== "undefined") {
      sessionStorage.removeItem("kirtan-pending-payment");
    }
  }, [isSuccess, isFailed, isInvalid, pendingData, savedDone, saveDonorRecord]);

  const parsedAmount = parseFloat(amount || "0");

  const confettiStyles = (
    <style jsx global>{`
      .confetti-piece {
        position: absolute;
        top: -14%;
        width: 10px;
        height: 14px;
        opacity: 0.95;
        background: #f0b45d;
        transform: rotate(12deg);
        animation-name: confetti-fall;
        animation-iteration-count: infinite;
        animation-timing-function: linear;
        will-change: transform;
      }

      .confetti-piece:nth-child(3n) {
        background: #c96b1b;
      }

      .confetti-piece:nth-child(3n + 1) {
        background: #fff2dc;
      }

      @keyframes confetti-fall {
        0% {
          transform: translateY(-12vh) rotate(0deg);
        }
        100% {
          transform: translateY(125vh) rotate(560deg);
        }
      }

      @media print {
        .confetti-piece {
          display: none;
        }
      }
    `}</style>
  );

  // ───── Invalid State ─────
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
          <div className="text-5xl mb-4">⚠️</div>
          <h1
            className="text-2xl font-bold mb-2"
            style={{
              fontFamily: '"Playfair Display", serif',
              color: "#fff4e3",
            }}
          >
            Invalid Transaction
          </h1>
          <p
            className="text-sm mb-6"
            style={{ color: "rgba(244,224,197,0.86)" }}
          >
            The transaction details are incomplete or invalid. Please try the
            payment again.
          </p>
          <Link
            href="/web-app"
            className="inline-block px-6 py-3 rounded-lg text-sm font-bold"
            style={{
              background: "linear-gradient(135deg, #c96b1b, #e0b860)",
              color: "#fff",
            }}
          >
            Back to Wall of Legacy
          </Link>
        </div>
      </div>
    );
  }

  // ───── Success State ─────
  if (isSuccess) {
    // Show saving spinner while confirming
    if (saving) {
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
              <h1
                className="text-2xl font-bold"
                style={{
                  fontFamily: '"Playfair Display", serif',
                  color: "#fff4e3",
                }}
              >
                Payment Successful!
              </h1>
              <p className="text-sm" style={{ color: "rgba(245,232,216,0.9)" }}>
                Saving your donation record... Please wait.
              </p>
            </div>
          </div>
        </div>
      );
    }

    // Receipt-style display (matches /web-app/receipt)
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6"
        style={{
          background:
            "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
        }}
      >
        {/* Confetti */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden z-10">
          {Array.from({ length: 36 }).map((_, idx) => (
            <span
              key={`conf-${idx}`}
              className="confetti-piece"
              style={{
                left: `${(idx * 97) % 100}%`,
                animationDelay: `${(idx % 12) * 0.16}s`,
                animationDuration: `${4 + (idx % 5) * 0.7}s`,
              }}
            />
          ))}
        </div>
        {confettiStyles}

        <div
          className="relative z-20 w-full max-w-2xl rounded-2xl p-5 sm:p-8"
          style={{
            background: "rgba(26,14,8,0.9)",
            border: "1px solid rgba(228,180,121,0.3)",
            boxShadow: "0 28px 70px rgba(0,0,0,0.45)",
          }}
        >
          {/* Header */}
          <p
            className="text-xs uppercase tracking-[0.18em]"
            style={{ color: "rgba(255,221,168,0.82)" }}
          >
            {receipt
              ? `Receipt Issued by ${receipt.trust_name}`
              : "Online Payment"}
          </p>
          <h2
            className="text-xl sm:text-2xl font-black mt-2"
            style={{ color: "#fff8ee" }}
          >
            Thank you for your contribution
          </h2>
          <h2
            className="text-5xl sm:text-6xl mt-2 pb-4"
            style={{
              color: "#ffd79c",
              fontFamily: '"Dancing Script", cursive',
              textShadow: "0 8px 24px rgba(0,0,0,0.35)",
              borderBottom: "1px solid rgba(228,180,121,0.22)",
            }}
          >
            {receipt?.donor_name || pendingData?.name || "Donor"}
          </h2>
          <h1
            className="text-2xl sm:text-3xl font-bold mt-2"
            style={{
              color: "#fff4e3",
              fontFamily: '"Playfair Display", serif',
            }}
          >
            Donation Receipt
          </h1>

          {/* Save Error */}
          {saveError && (
            <div
              className="mt-4 rounded-lg px-4 py-3 text-sm"
              style={{
                background: "rgba(220,110,90,0.12)",
                border: "1px solid rgba(220,110,90,0.25)",
                color: "#ffd7d0",
              }}
            >
              <p className="font-semibold mb-1">⚠️ Record Not Saved</p>
              <p>{saveError}</p>
              <p className="mt-2 text-xs" style={{ color: "rgba(245,232,216,0.7)" }}>
                Transaction ID: {txnID}
              </p>
              <button
                type="button"
                onClick={() => {
                  saveAttemptedRef.current = false;
                  setSavedDone(false);
                }}
                className="mt-2 px-3 py-1.5 rounded-lg text-xs font-bold"
                style={{
                  background: "linear-gradient(135deg, #c96b1b, #e0b860)",
                  color: "#fff",
                }}
              >
                Retry Saving
              </button>
            </div>
          )}

          {/* Receipt Details */}
          <div className="grid sm:grid-cols-2 gap-3 mt-5">
            <Info
              label="Donor"
              value={receipt?.donor_name || pendingData?.name || "—"}
            />
            <Info
              label="Date"
              value={
                receipt
                  ? new Date(receipt.created_at).toLocaleString("en-IN")
                  : new Date().toLocaleString("en-IN")
              }
            />
            {receipt?.serial_number && (
              <Info label="Serial Number" value={receipt.serial_number} />
            )}
            <Info label="Transaction ID" value={txnID || "—"} />
            <Info
              label="Total Names"
              value={`${receipt?.qty || pendingData?.qty || "—"}`}
            />
            <Info
              label="Total Amount"
              value={`₹${formatINR(receipt?.total_amount || parsedAmount)}`}
            />
            <Info label="Payment Method" value="Online Payment" />
            {(receipt?.block_id || pendingData?.block_id) && (
              <Info
                label="Block"
                value={receipt?.block_id || pendingData?.block_id || "—"}
              />
            )}
            {receipt?.phone && <Info label="Phone" value={receipt.phone} />}
            {receipt?.email && <Info label="Email" value={receipt.email} />}
          </div>

          {/* Allocation Table */}
          {receipt && receipt.allocations.length > 0 && (
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
                      <th
                        className="text-left px-3 py-2"
                        style={{ color: "#ffe9cc" }}
                      >
                        Block
                      </th>
                      <th
                        className="text-right px-3 py-2"
                        style={{ color: "#ffe9cc" }}
                      >
                        Qty
                      </th>
                      <th
                        className="text-right px-3 py-2"
                        style={{ color: "#ffe9cc" }}
                      >
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipt.allocations.map((alloc, idx) => (
                      <tr
                        key={idx}
                        style={{
                          borderTop: "1px solid rgba(228,180,121,0.1)",
                          background:
                            idx % 2 === 0
                              ? "transparent"
                              : "rgba(255,246,233,0.02)",
                        }}
                      >
                        <td
                          className="px-3 py-2"
                          style={{ color: "#fff4e3" }}
                        >
                          {alloc.block_id}
                        </td>
                        <td
                          className="text-right px-3 py-2"
                          style={{ color: "#fff4e3" }}
                        >
                          {alloc.qty}
                        </td>
                        <td
                          className="text-right px-3 py-2"
                          style={{ color: "#ffd79c" }}
                        >
                          ₹{formatINR(alloc.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Total Assigned Box */}
          {receipt && (
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
              <p
                className="text-xl sm:text-2xl font-bold"
                style={{ color: "#ffd79c" }}
              >
                {totalAssigned} Names
              </p>
            </div>
          )}

          {/* Confirmed badge */}
          {receipt && !saveError && (
            <div
              className="mt-4 rounded-lg p-3 text-center"
              style={{
                background: "rgba(72,187,120,0.08)",
                border: "1px solid rgba(72,187,120,0.25)",
              }}
            >
              <p className="text-sm font-semibold" style={{ color: "#68d391" }}>
                ✓ Donation Confirmed &amp; Saved
              </p>
              <p
                className="text-xs mt-1"
                style={{ color: "rgba(245,232,216,0.7)" }}
              >
                Your inscription will appear on the Wall of Legacy.
              </p>
            </div>
          )}

          {message && (
            <div
              className="mt-4 rounded-lg px-4 py-3 text-sm"
              style={{
                background: "rgba(255,246,233,0.06)",
                border: "1px solid rgba(228,180,121,0.15)",
                color: "rgba(245,232,216,0.9)",
              }}
            >
              <span
                className="text-xs uppercase tracking-wider"
                style={{ color: "rgba(255,230,198,0.7)" }}
              >
                Gateway Message:{" "}
              </span>
              {message}
            </div>
          )}

          {/* Actions */}
          <div className="mt-6 flex flex-wrap gap-2">
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
            <Link
              href="/web-app"
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{
                background: "rgba(255,246,233,0.1)",
                border: "1px solid rgba(228,180,121,0.26)",
                color: "#ffe9cc",
              }}
            >
              Back to Wall
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ───── Failed State ─────
  if (isFailed) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6"
        style={{
          background:
            "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
        }}
      >
        <div
          className="w-full max-w-xl rounded-2xl p-6 sm:p-8 text-center"
          style={{
            background: "rgba(26,14,8,0.9)",
            border: "1px solid rgba(228,180,121,0.3)",
            boxShadow: "0 28px 70px rgba(0,0,0,0.45)",
          }}
        >
          <div className="text-5xl mb-4">❌</div>
          <h1
            className="text-2xl font-bold mb-2"
            style={{
              fontFamily: '"Playfair Display", serif',
              color: "#fff4e3",
            }}
          >
            Payment Failed
          </h1>
          <p
            className="text-sm mb-2"
            style={{ color: "rgba(244,224,197,0.86)" }}
          >
            Your payment could not be processed.
          </p>
          {message && (
            <div
              className="rounded-lg px-4 py-3 mb-4 text-sm"
              style={{
                background: "rgba(220,110,90,0.12)",
                border: "1px solid rgba(220,110,90,0.25)",
                color: "#ffd7d0",
              }}
            >
              Reason: {message}
            </div>
          )}
          {txnID && (
            <p
              className="text-xs mb-4"
              style={{ color: "rgba(245,232,216,0.7)" }}
            >
              Transaction ID: {txnID}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Link
              href="/web-app"
              className="w-full py-3 rounded-xl font-bold text-white text-center text-sm"
              style={{
                background: "linear-gradient(135deg, #c96b1b, #e0b860)",
                boxShadow: "0 12px 28px rgba(201,107,27,0.26)",
              }}
            >
              Try Again
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ───── Unknown Status ─────
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6"
      style={{
        background:
          "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
      }}
    >
      <div
        className="w-full max-w-xl rounded-2xl p-6 sm:p-8 text-center"
        style={{
          background: "rgba(26,14,8,0.9)",
          border: "1px solid rgba(228,180,121,0.3)",
          boxShadow: "0 28px 70px rgba(0,0,0,0.45)",
        }}
      >
        <div className="text-5xl mb-4">🔄</div>
        <h1
          className="text-2xl font-bold mb-2"
          style={{
            fontFamily: '"Playfair Display", serif',
            color: "#fff4e3",
          }}
        >
          Unknown Status
        </h1>
        <p
          className="text-sm mb-4"
          style={{ color: "rgba(244,224,197,0.86)" }}
        >
          We received an unexpected response. If the amount was debited, please
          wait a few minutes for confirmation.
        </p>
        {txnID && (
          <p
            className="text-xs mb-4"
            style={{ color: "rgba(245,232,216,0.7)" }}
          >
            Transaction ID: {txnID}
          </p>
        )}
        <Link
          href="/web-app"
          className="inline-block px-6 py-3 rounded-lg text-sm font-bold"
          style={{
            background: "linear-gradient(135deg, #c96b1b, #e0b860)",
            color: "#fff",
          }}
        >
          Back to Wall of Legacy
        </Link>
      </div>
    </div>
  );
}

export default function PaymentResultPage() {
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
            <p
              className="text-sm"
              style={{ color: "rgba(255,221,168,0.82)" }}
            >
              Loading payment result...
            </p>
          </div>
        </div>
      }
    >
      <PaymentResultContent />
    </Suspense>
  );
}
