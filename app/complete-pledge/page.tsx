"use client";

import React, { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { LoadingScreen } from "@/components/shared/LoadingScreen";
import { formatINR, COST_PER_NAME } from "@/lib/mosaic/engine";

type PledgeResult = {
  serial_number: string;
  block_id: string;
  donor_name: string;
  qty: number;
  amount: number;
  pledge_due_days: number;
  pledge_due_date: string;
  phone: string;
  email?: string;
  created_at: string;
};

type GroupedPledge = {
  serial: string;
  details: PledgeResult;
};

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

type SearchApiItem = {
  kind: "name" | "phone" | "serial";
  label: string;
  block_id: string;
  qty?: number;
  created_at?: string;
  subtitle?: string;
  serial_number?: string | null;
  action_type?: string | null;
  phone?: string | null;
  email?: string | null;
};

export default function CompletePledgePage() {
  const [isMobile, setIsMobile] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    const checkMobile = () => {
      const isSmall = window.matchMedia("(max-width: 1024px)").matches;
      setIsMobile(isSmall);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [pledges, setPledges] = useState<GroupedPledge[]>([]);
  const [searchMeta, setSearchMeta] = useState(
    "Search by donor name, phone number, or serial number to find your pledge.",
  );
  const [processingSerial, setProcessingSerial] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    const query = searchQuery.trim();
    setSearchSubmitted(true);
    if (query.length < 2) {
      setPledges([]);
      setSearchMeta("Type at least 2 characters to search.");
      return;
    }

    setSearchLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = (await res.json()) as {
        query: string;
        results: SearchApiItem[];
      };

      const pledgeResults = (data.results || []).filter(
        (r) => (r.action_type || "").toLowerCase() === "pledge",
      );

      const dedupedBySerial = new Map<string, GroupedPledge>();
      for (const r of pledgeResults) {
        const serial = (r.serial_number || "").trim();
        if (!serial) continue;
        if (dedupedBySerial.has(serial)) continue;

        dedupedBySerial.set(serial, {
          serial,
          details: {
            serial_number: serial,
            block_id: r.block_id,
            donor_name: r.label,
            qty: r.qty || 1,
            amount: (r.qty || 1) * COST_PER_NAME,
            pledge_due_days: 0,
            pledge_due_date: "",
            phone: r.phone || "",
            email: r.email || undefined,
            created_at: r.created_at || new Date().toISOString(),
          },
        });
      }

      const grouped = Array.from(dedupedBySerial.values());

      setPledges(grouped);
      setSearchMeta(
        grouped.length
          ? `Found ${grouped.length} pledge${grouped.length > 1 ? "s" : ""}.`
          : "No pledges found.",
      );
    } catch {
      setPledges([]);
      setSearchMeta("Search is temporarily unavailable. Please try again.");
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery]);

  const handleDonateNow = useCallback(
    (pledge: GroupedPledge) => {
      const serial = pledge.serial;
      setProcessingSerial(serial);

      const receiptPayload: WebReceiptPayload = {
        trust_name: "KIRTAN SEVA TRUST",
        serial_number: pledge.details.serial_number,
        action_type: "donate",
        donor_name: pledge.details.donor_name,
        qty: pledge.details.qty,
        total_amount: pledge.details.amount,
        phone: pledge.details.phone || undefined,
        email: pledge.details.email || undefined,
        created_at: new Date().toISOString(),
        allocations: [
          {
            block_id: pledge.details.block_id,
            qty: pledge.details.qty,
            amount: pledge.details.amount,
            serial_number: pledge.details.serial_number,
          },
        ],
      };

      try {
        sessionStorage.setItem(
          "kirtan-web-receipt",
          JSON.stringify(receiptPayload),
        );
      } catch {
        setSearchMeta("Unable to prepare receipt right now. Please try again.");
        setProcessingSerial(null);
        return;
      }

      setTimeout(() => {
        router.push("/web-app/receipt");
      }, 250);
    },
    [router],
  );

  if (isMobile) {
    return (
      <div
        className="min-h-screen w-full flex flex-col items-center justify-center px-4 py-8"
        style={{ background: "#f2ece2" }}
      >
        <div className="text-center max-w-md">
          <h1
            className="text-3xl font-bold mb-4"
            style={{
              fontFamily: '"Playfair Display", serif',
              color: "#2a1509",
            }}
          >
            View on Desktop
          </h1>
          <p className="text-sm mb-6" style={{ color: "#5c4a3a" }}>
            The pledge completion experience is best viewed on a computer
            browser.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full overflow-x-hidden overflow-y-auto relative flex flex-col"
      style={{
        background:
          "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
      }}
    >
      <LoadingScreen visible={false} />

      <div className="w-full flex flex-col items-center justify-center px-4 py-8 lg:py-12">
        <div className="max-w-2xl w-full">
          {/* Header */}
          <div className="mb-8 text-center">
            <p
              className="text-sm font-semibold tracking-[0.14em] uppercase mb-2"
              style={{ color: "rgba(255,221,168,0.82)" }}
            >
              Pledge Completion
            </p>
            <h1
              className="text-4xl font-bold mb-3"
              style={{
                fontFamily: '"Playfair Display", serif',
                color: "#fff5e8",
              }}
            >
              Complete Your Pledge
            </h1>
            <p style={{ color: "rgba(245,232,216,0.9)" }}>
              Search for your existing pledge and complete the donation to
              secure the inscription.
            </p>
          </div>

          {/* Search Box */}
          <div
            className="p-6 rounded-2xl mb-8"
            style={{
              background:
                "linear-gradient(135deg, rgba(36,20,12,0.98), rgba(50,24,10,0.97))",
              border: "1px solid rgba(170,120,75,0.14)",
              boxShadow: "0 18px 40px rgba(10,6,4,0.36)",
            }}
          >
            <h3
              className="text-lg font-bold mb-3"
              style={{
                fontFamily: '"Playfair Display", serif',
                color: "#fff1df",
              }}
            >
              Find Your Pledge
            </h3>
            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <input
                value={searchQuery}
                onChange={(e) => {
                  const value = e.target.value;
                  setSearchQuery(value);
                  setSearchSubmitted(false);
                  if (!value.trim()) {
                    setPledges([]);
                    setSearchMeta(
                      "Search by donor name, phone number, or serial number to find your pledge.",
                    );
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runSearch();
                }}
                placeholder="e.g. Jayapataka Swami · +91 987... · PLG-A1-000123"
                className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  background: "rgba(255,250,244,0.96)",
                  border: "1px solid rgba(222,182,131,0.36)",
                  color: "#2a1509",
                }}
              />
              <button
                type="button"
                onClick={() => void runSearch()}
                className="w-full sm:w-auto px-4 py-2 rounded-lg text-sm font-bold"
                style={{
                  background: "linear-gradient(135deg, #c96b1b, #e0b860)",
                  color: "#fff",
                  opacity: searchLoading ? 0.7 : 1,
                }}
                disabled={searchLoading}
              >
                {searchLoading ? "Searching..." : "Search"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setPledges([]);
                  setSearchSubmitted(false);
                  setSearchMeta(
                    "Search by donor name, phone number, or serial number to find your pledge.",
                  );
                }}
                className="w-full sm:w-auto px-3 py-2 rounded-lg text-sm font-semibold"
                style={{
                  background: "rgba(255,246,233,0.08)",
                  border: "1px solid rgba(228,180,121,0.26)",
                  color: "#ffe9cc",
                }}
              >
                Clear
              </button>
            </div>
            <p className="text-xs" style={{ color: "rgba(245,232,216,0.78)" }}>
              {searchMeta}
            </p>
          </div>

          {/* Results */}
          <AnimatePresence mode="wait">
            {pledges.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="space-y-4"
              >
                {pledges.map((pledge) => (
                  <div
                    key={pledge.serial}
                    className="p-5 rounded-2xl overflow-hidden"
                    style={{
                      background:
                        "linear-gradient(180deg, rgba(38,20,10,0.92), rgba(48,24,12,0.82))",
                      border: "1px solid rgba(170,120,75,0.2)",
                      boxShadow: "0 16px 34px rgba(10,6,4,0.34)",
                    }}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <span
                        className="text-[11px] font-bold uppercase tracking-[0.14em]"
                        style={{ color: "rgba(255,221,168,0.82)" }}
                      >
                        Pledge Found
                      </span>
                      <span
                        className="text-sm font-bold"
                        style={{
                          background:
                            "linear-gradient(135deg, #c96b1b, #e0b860)",
                          WebkitBackgroundClip: "text",
                          color: "transparent",
                        }}
                      >
                        ₹{formatINR(pledge.details.amount)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <p
                          className="text-xs font-bold uppercase tracking-wider"
                          style={{ color: "rgba(255,221,168,0.72)" }}
                        >
                          Serial Number
                        </p>
                        <p
                          className="text-sm font-semibold mt-1"
                          style={{ color: "#fff4e3" }}
                        >
                          {pledge.details.serial_number}
                        </p>
                      </div>
                      <div>
                        <p
                          className="text-xs font-bold uppercase tracking-wider"
                          style={{ color: "rgba(255,221,168,0.72)" }}
                        >
                          Donor Name
                        </p>
                        <p
                          className="text-sm font-semibold mt-1"
                          style={{ color: "#fff4e3" }}
                        >
                          {pledge.details.donor_name}
                        </p>
                      </div>
                      <div>
                        <p
                          className="text-xs font-bold uppercase tracking-wider"
                          style={{ color: "rgba(255,221,168,0.72)" }}
                        >
                          Contact
                        </p>
                        <p
                          className="text-sm mt-1"
                          style={{ color: "#fff4e3" }}
                        >
                          {pledge.details.phone}
                        </p>
                      </div>
                      <div>
                        <p
                          className="text-xs font-bold uppercase tracking-wider"
                          style={{ color: "rgba(255,221,168,0.72)" }}
                        >
                          Block
                        </p>
                        <p
                          className="text-sm mt-1"
                          style={{ color: "#fff4e3" }}
                        >
                          {pledge.details.block_id}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDonateNow(pledge)}
                      disabled={processingSerial === pledge.serial}
                      className="w-full px-4 py-2 rounded-lg text-sm font-bold transition-opacity"
                      style={{
                        background: "linear-gradient(135deg, #c96b1b, #e0b860)",
                        color: "#fff",
                        opacity: processingSerial === pledge.serial ? 0.7 : 1,
                      }}
                    >
                      {processingSerial === pledge.serial
                        ? "Processing..."
                        : "Donate Now"}
                    </button>
                  </div>
                ))}
              </motion.div>
            )}

            {searchSubmitted && pledges.length === 0 && !searchLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center py-8"
              >
                <p style={{ color: "#5c4a3a" }}>
                  No pledges found matching your search.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Back Button */}
          <div className="mt-8 text-center">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{
                background: "rgba(255,246,233,0.08)",
                border: "1px solid rgba(228,180,121,0.26)",
                color: "#ffe9cc",
              }}
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
