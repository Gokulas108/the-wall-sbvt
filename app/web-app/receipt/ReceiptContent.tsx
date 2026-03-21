"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { formatINR } from "@/lib/mosaic/engine";

type AllocationReceipt = {
  block_id: string;
  qty: number;
  amount: number;
  serial_number?: string;
};

type WebReceiptPayload = {
  trust_name: string;
  serial_number: string;
  action_type: "donate" | "pledge";
  donor_name: string;
  qty: number;
  total_amount: number;
  phone?: string;
  whatsapp?: string;
  email?: string;
  pledge_due_days?: number;
  pledge_due_date?: string;
  created_at: string;
  allocations: AllocationReceipt[];
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

export function ReceiptContent() {
  const searchParams = useSearchParams();
  const customMessage = searchParams?.get("message");
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

  const [receipt] = useState<WebReceiptPayload | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem("kirtan-web-receipt");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as WebReceiptPayload;
      return parsed?.allocations?.length ? parsed : null;
    } catch {
      return null;
    }
  });

  const totalAssigned = useMemo(() => {
    if (!receipt) return 0;
    return receipt.allocations.reduce((sum, item) => sum + item.qty, 0);
  }, [receipt]);

  if (!receipt && !customMessage) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center p-6"
        style={{
          background:
            "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
        }}
      >
        <div
          className="w-full max-w-xl rounded-2xl p-6 text-center"
          style={{
            background: "rgba(26,14,8,0.85)",
            border: "1px solid rgba(228,180,121,0.24)",
          }}
        >
          <h1 className="text-2xl font-bold" style={{ color: "#fff4e3" }}>
            Receipt unavailable
          </h1>
          <p
            className="mt-2 text-sm"
            style={{ color: "rgba(244,224,197,0.86)" }}
          >
            We could not load your latest donation receipt on this device.
          </p>
          <Link
            href="/web-app"
            className="inline-block mt-5 px-4 py-2 rounded-lg text-sm font-semibold"
            style={{
              background: "linear-gradient(135deg, #c96b1b, #e0b860)",
              color: "#fff",
            }}
          >
            Back to Wall
          </Link>
        </div>
      </div>
    );
  }

  // For custom message (pledge completion)
  if (customMessage && !receipt) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6"
        style={{
          background:
            "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
        }}
      >
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
          className="relative z-20 w-full max-w-2xl rounded-2xl p-5 sm:p-8 text-center"
          style={{
            background: "rgba(26,14,8,0.9)",
            border: "1px solid rgba(228,180,121,0.3)",
            boxShadow: "0 28px 70px rgba(0,0,0,0.45)",
          }}
        >
          <h1
            className="text-4xl sm:text-5xl font-black mb-4"
            style={{
              fontFamily: '"Playfair Display", serif',
              color: "#ffd79c",
              textShadow: "0 8px 24px rgba(0,0,0,0.35)",
            }}
          >
            {customMessage}
          </h1>
          <p
            className="text-sm mb-6"
            style={{ color: "rgba(245,232,216,0.9)" }}
          >
            Your pledge donation has been recorded successfully. The inscription
            is now secured on the living wall.
          </p>
          <Link
            href="/web-app"
            className="inline-block px-6 py-3 rounded-lg text-sm font-bold"
            style={{
              background: "linear-gradient(135deg, #c96b1b, #e0b860)",
              color: "#fff",
            }}
          >
            View the Wall
          </Link>
        </div>
      </div>
    );
  }

  if (!receipt) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center p-6"
        style={{
          background:
            "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
        }}
      >
        <div
          className="w-full max-w-xl rounded-2xl p-6 text-center"
          style={{
            background: "rgba(26,14,8,0.85)",
            border: "1px solid rgba(228,180,121,0.24)",
          }}
        >
          <h1 className="text-2xl font-bold" style={{ color: "#fff4e3" }}>
            Receipt unavailable
          </h1>
          <p
            className="mt-2 text-sm"
            style={{ color: "rgba(244,224,197,0.86)" }}
          >
            We could not load your donation receipt on this device.
          </p>
          <Link
            href="/web-app"
            className="inline-block mt-5 px-4 py-2 rounded-lg text-sm font-semibold"
            style={{
              background: "linear-gradient(135deg, #c96b1b, #e0b860)",
              color: "#fff",
            }}
          >
            Back to Wall
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6"
      style={{
        background:
          "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
      }}
    >
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
        <p
          className="text-xs uppercase tracking-[0.18em]"
          style={{ color: "rgba(255,221,168,0.82)" }}
        >
          Receipt Issued by {receipt.trust_name}
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
          {receipt.donor_name}
        </h2>
        <h1
          className="text-2xl sm:text-3xl font-bold mt-2"
          style={{ color: "#fff4e3", fontFamily: '"Playfair Display", serif' }}
        >
          {receipt.action_type === "pledge"
            ? "Pledge Receipt"
            : "Donation Receipt"}
        </h1>

        <div className="grid sm:grid-cols-2 gap-3 mt-5">
          <Info label="Donor" value={receipt.donor_name} />
          <Info
            label="Date"
            value={new Date(receipt.created_at).toLocaleString("en-IN")}
          />
          <Info label="Serial Number" value={receipt.serial_number} />
          <Info label="Total Names" value={`${receipt.qty}`} />
          <Info
            label="Total Price"
            value={`₹${formatINR(receipt.total_amount)}`}
          />
          {receipt.action_type === "pledge" && receipt.pledge_due_days ? (
            <Info label="Pledge Days" value={`${receipt.pledge_due_days}`} />
          ) : null}
          {receipt.action_type === "pledge" && receipt.pledge_due_date ? (
            <Info label="Pledge Due Date" value={receipt.pledge_due_date} />
          ) : null}
          {receipt.phone ? <Info label="Phone" value={receipt.phone} /> : null}
          {receipt.whatsapp ? (
            <Info label="WhatsApp" value={receipt.whatsapp} />
          ) : null}
          {receipt.email ? <Info label="Email" value={receipt.email} /> : null}
        </div>

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
                    <td className="px-3 py-2" style={{ color: "#fff4e3" }}>
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
