"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  formatINR,
  COST_PER_NAME,
  NAMES_PER_BLOCK,
  GRID_SIZE,
  blockId as bid,
} from "@/lib/mosaic/engine";

const COUNTRY_CODES = [
  ["India", "+91"],
  ["United States", "+1"],
  ["United Kingdom", "+44"],
  ["Australia", "+61"],
  ["Canada", "+1"],
  ["Germany", "+49"],
  ["France", "+33"],
  ["Singapore", "+65"],
  ["UAE", "+971"],
  ["Bangladesh", "+880"],
  ["Nepal", "+977"],
  ["Sri Lanka", "+94"],
  ["Malaysia", "+60"],
  ["South Africa", "+27"],
];

const PAGE_PASSWORD = "16108";
const DONOR_FORM_AUTH_KEY = "kc-donor-form-auth-date";

type BlockCapacity = { id: string; remaining: number };
type DonationPaymentMethod = "cash" | "upi";

function buildRandomQrPattern(seed: number) {
  const size = 21;
  const cells: number[] = [];
  let value = seed || 1;
  for (let i = 0; i < size * size; i++) {
    value = (value * 1664525 + 1013904223) >>> 0;
    cells.push((value >> 28) & 1);
  }
  return { size, cells };
}

function buildSharedSerial(
  actionType: "donate" | "pledge",
  primaryBlockId: string,
): string {
  const prefix = actionType === "pledge" ? "PLG" : "DON";
  const base = (Date.now() + Math.floor(Math.random() * 1000)) % 1_000_000;
  const suffix = String(base).padStart(6, "0");
  return `${prefix}-${primaryBlockId.toUpperCase()}-${suffix}`;
}

export default function DonorFormPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [dob, setDob] = useState("");
  const [email, setEmail] = useState("");
  const [phoneCode, setPhoneCode] = useState("+91");
  const [phone, setPhone] = useState("");
  const [whatsappCode, setWhatsappCode] = useState("+91");
  const [whatsapp, setWhatsapp] = useState("");
  const [sameAsPhone, setSameAsPhone] = useState(false);
  const [blockIdStr, setBlockIdStr] = useState("");
  const [isBlockManuallyChosen, setIsBlockManuallyChosen] = useState(false);
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const [assignedBlocks, setAssignedBlocks] = useState<
    Array<{ id: string; qty: number }>
  >([]);
  const [showPledgeModal, setShowPledgeModal] = useState(false);
  const [pledgeDays, setPledgeDays] = useState<number | null>(null);
  const [showDonatePaymentModal, setShowDonatePaymentModal] = useState(false);
  const [donationPaymentMethod, setDonationPaymentMethod] =
    useState<DonationPaymentMethod>("cash");
  const [donationPaymentReference, setDonationPaymentReference] = useState("");
  const [qrSeed, setQrSeed] = useState<number>(() => Date.now());

  // Auto-assign block if not selected
  const [availableBlocks, setAvailableBlocks] = useState<
    { id: string; remaining: number }[]
  >([]);

  const pickRandomFittingBlock = useCallback(
    (blocks: { id: string; remaining: number }[], neededQty: number) => {
      const fitting = blocks.filter((b) => b.remaining >= neededQty);
      if (fitting.length === 0) return null;
      const idx = Math.floor(Math.random() * fitting.length);
      return fitting[idx];
    },
    [],
  );

  const loadAvailableBlocks = useCallback(
    async (
      preferredBlockId?: string,
      requiredQty?: number,
      forceAutoSelect?: boolean,
    ) => {
      const res = await fetch("/api/blocks");
      const data = (await res.json()) as Record<string, { total_qty: number }>;
      const blocks: { id: string; remaining: number }[] = [];
      for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
          const id = bid(r, c);
          const used = data[id]?.total_qty ?? 0;
          const rem = NAMES_PER_BLOCK - used;
          if (rem > 0) blocks.push({ id, remaining: rem });
        }
      }
      blocks.sort((a, b) => b.remaining - a.remaining);
      setAvailableBlocks(blocks);

      if (blocks.length === 0) {
        setBlockIdStr("");
        return;
      }

      const preferred = preferredBlockId?.trim();
      const stillExists = preferred
        ? blocks.some((b) => b.id === preferred)
        : false;

      if (stillExists && !forceAutoSelect) {
        setBlockIdStr(preferred!);
        return;
      }

      const needed = Number.isFinite(requiredQty)
        ? Math.max(1, requiredQty as number)
        : 1;
      const qtyMatched = pickRandomFittingBlock(blocks, needed);

      if (qtyMatched) {
        setBlockIdStr(qtyMatched.id);
        return;
      }

      setBlockIdStr(stillExists ? preferred! : blocks[0].id);
    },
    [pickRandomFittingBlock],
  );

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const savedDate = localStorage.getItem(DONOR_FORM_AUTH_KEY);
    if (savedDate === today) {
      setIsAuthorized(true);
      setAuthChecked(true);
      return;
    }

    let value = window.prompt("Enter password");
    while (value !== null && value !== PAGE_PASSWORD) {
      value = window.prompt("Incorrect password. Enter password");
    }

    if (value === PAGE_PASSWORD) {
      localStorage.setItem(DONOR_FORM_AUTH_KEY, today);
      setIsAuthorized(true);
    } else {
      setIsAuthorized(false);
    }
    setAuthChecked(true);
  }, []);

  useEffect(() => {
    void loadAvailableBlocks();
  }, [loadAvailableBlocks]);

  useEffect(() => {
    const qtyNumber = parseInt(qty, 10);
    const needed = Number.isFinite(qtyNumber) ? Math.max(1, qtyNumber) : 1;
    if (availableBlocks.length === 0) return;
    if (isBlockManuallyChosen) return;
    setBlockIdStr((current) => {
      const currentBlock = availableBlocks.find((b) => b.id === current);
      if (currentBlock && currentBlock.remaining >= needed) return current;
      const matched = pickRandomFittingBlock(availableBlocks, needed);
      return matched ? matched.id : current;
    });
  }, [qty, availableBlocks, isBlockManuallyChosen, pickRandomFittingBlock]);

  useEffect(() => {
    if (sameAsPhone) {
      setWhatsapp(phone);
      setWhatsappCode(phoneCode);
    }
  }, [sameAsPhone, phone, phoneCode]);

  const parsedQty = parseInt(qty, 10);
  const totalAmount =
    (Number.isFinite(parsedQty) ? Math.max(0, parsedQty) : 0) * COST_PER_NAME;

  const buildAllocationPlan = useCallback(
    (
      capacities: BlockCapacity[],
      requestedQty: number,
      preferredBlockId?: string,
    ) => {
      const totalRemaining = capacities.reduce(
        (sum, b) => sum + b.remaining,
        0,
      );
      if (totalRemaining < requestedQty) {
        throw new Error(
          `Only ${totalRemaining} slots are available in the wall right now.`,
        );
      }

      const preferred = preferredBlockId?.trim();
      const ordered = [...capacities].sort((a, b) => b.remaining - a.remaining);
      if (preferred) {
        const idx = ordered.findIndex((b) => b.id === preferred);
        if (idx > 0) {
          const [picked] = ordered.splice(idx, 1);
          ordered.unshift(picked);
        }
      }

      let left = requestedQty;
      const plan: Array<{ id: string; qty: number }> = [];
      for (const block of ordered) {
        if (left <= 0) break;
        if (block.remaining <= 0) continue;
        const qtyForBlock = Math.min(left, block.remaining);
        if (qtyForBlock > 0) {
          plan.push({ id: block.id, qty: qtyForBlock });
          left -= qtyForBlock;
        }
      }

      if (left > 0) {
        throw new Error("Unable to allocate all names. Please try again.");
      }

      return plan;
    },
    [],
  );

  const fetchCapacities = useCallback(async (): Promise<BlockCapacity[]> => {
    const res = await fetch("/api/blocks");
    const data = (await res.json()) as Record<string, { total_qty: number }>;
    const capacities: BlockCapacity[] = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const id = bid(r, c);
        const used = data[id]?.total_qty ?? 0;
        const remaining = Math.max(0, NAMES_PER_BLOCK - used);
        if (remaining > 0) capacities.push({ id, remaining });
      }
    }
    return capacities;
  }, []);

  async function handleSubmit(
    actionType: "donate" | "pledge",
    selectedPledgeDays?: number,
    paymentMethod?: DonationPaymentMethod,
    paymentReference?: string,
  ) {
    const qtyNumber = parseInt(qty, 10);
    if (!name.trim()) {
      setStatus("Please enter your name.");
      return;
    }
    if (!Number.isFinite(qtyNumber) || qtyNumber < 1) {
      setStatus("Please enter a valid quantity.");
      return;
    }
    if (!phone.trim()) {
      setStatus("Please enter your phone number.");
      return;
    }
    const whatsappVal = sameAsPhone ? phone : whatsapp;
    if (!whatsappVal.trim()) {
      setStatus("Please enter your WhatsApp number.");
      return;
    }
    if (!blockIdStr) {
      setStatus("Please select a block.");
      return;
    }
    if (actionType === "pledge" && !selectedPledgeDays) {
      setStatus("Please select pledge days.");
      return;
    }

    setSubmitting(true);
    setStatus("Processing...");

    const payloadBase: Record<string, unknown> = {
      name: name.trim(),
      date_of_birth: dob,
      email: email.trim(),
      phone: `${phoneCode} ${phone.trim()}`,
      whatsapp: `${sameAsPhone ? phoneCode : whatsappCode} ${whatsappVal.trim()}`,
    };
    if (actionType === "donate" && paymentMethod) {
      payloadBase.payment_method = paymentMethod;
      if (paymentMethod === "upi") {
        payloadBase.payment_reference = (paymentReference || "").trim();
      }
    }
    payloadBase.receipt_serial = buildSharedSerial(actionType, blockIdStr);
    if (actionType === "pledge")
      payloadBase.pledge_due_days = selectedPledgeDays;

    try {
      const capacities = await fetchCapacities();
      const plan = buildAllocationPlan(capacities, qtyNumber, blockIdStr);

      let firstReceipt: Record<string, unknown> | null = null;
      for (const alloc of plan) {
        const endpoint =
          actionType === "pledge"
            ? `/api/blocks/${alloc.id}/pledge`
            : `/api/blocks/${alloc.id}/donate`;
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payloadBase, qty: alloc.qty }),
        });
        const data = await res.json();
        if (!res.ok) {
          setStatus(data.error || "Something went wrong.");
          setSubmitting(false);
          return;
        }
        if (!firstReceipt && data?.receipt) {
          firstReceipt = data.receipt as Record<string, unknown>;
        }
      }

      setReceipt(firstReceipt);
      setAssignedBlocks(
        plan.map((alloc) => ({ id: alloc.id, qty: alloc.qty })),
      );
      setShowSuccess(true);
      setStatus("");
      await loadAvailableBlocks(undefined, 1, true);
      // Reset form
      setName("");
      setQty("1");
      setDob("");
      setEmail("");
      setPhone("");
      setWhatsapp("");
      setSameAsPhone(false);
      setIsBlockManuallyChosen(false);
      setPledgeDays(null);
      setShowPledgeModal(false);
      setShowDonatePaymentModal(false);
      setDonationPaymentMethod("cash");
      setDonationPaymentReference("");
      setQrSeed(Date.now());
    } catch {
      setStatus("Network error. Please try again.");
    }
    setSubmitting(false);
  }

  const qrPattern = buildRandomQrPattern(qrSeed);

  if (!authChecked) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center"
        style={{ background: "#f2ece2", color: "#2a1509" }}
      >
        <p>Checking access...</p>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center"
        style={{ background: "#f2ece2", color: "#2a1509" }}
      >
        <p>Access denied.</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-3 sm:p-4 md:p-8"
      style={{
        background: `
          radial-gradient(circle at 20% 20%, rgba(222,174,116,0.15), transparent 40%),
          radial-gradient(circle at 80% 80%, rgba(120,70,35,0.12), transparent 40%),
          linear-gradient(145deg, #1a0f0a, #2a150c 50%, #1a0f0a)
        `,
      }}
    >
      {/* Success overlay */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
            style={{
              background: "rgba(14,7,4,0.7)",
              backdropFilter: "blur(8px)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowSuccess(false)}
          >
            <motion.div
              className="w-full max-w-md p-5 sm:p-8 rounded-2xl text-center"
              style={{
                background:
                  "linear-gradient(145deg, #2a150b, #3c1f0f 52%, #4a2610)",
                border: "1px solid rgba(228,180,121,0.35)",
                boxShadow: "0 24px 60px rgba(0,0,0,0.46)",
              }}
              initial={{ scale: 0.8, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: -20 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              onClick={(e) => e.stopPropagation()}
            >
              <motion.div
                className="text-5xl mb-4"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 400 }}
              >
                🪔
              </motion.div>
              <h2
                className="text-2xl font-bold mb-2"
                style={{
                  fontFamily: '"Cinzel", Georgia, serif',
                  color: "#fff4e3",
                }}
              >
                Thank You!
              </h2>
              <p
                className="text-sm mb-4"
                style={{ color: "rgba(244,224,197,0.86)" }}
              >
                Your donation has been recorded. Your name will appear on the
                Wall of Legacy.
              </p>
              {assignedBlocks.length > 0 && (
                <div
                  className="text-left p-4 rounded-xl mb-4"
                  style={{
                    background: "rgba(255,246,233,0.08)",
                    border: "1px solid rgba(228,180,121,0.2)",
                  }}
                >
                  <p
                    className="text-xs font-bold tracking-wider uppercase mb-2"
                    style={{ color: "rgba(255,230,198,0.7)" }}
                  >
                    Assigned Blocks
                  </p>
                  <p className="text-sm" style={{ color: "#fff5e7" }}>
                    {assignedBlocks
                      .map((block) => `${block.id} (${block.qty})`)
                      .join(", ")}
                  </p>
                </div>
              )}
              {receipt && (
                <div
                  className="text-left p-4 rounded-xl mb-4"
                  style={{
                    background: "rgba(255,246,233,0.08)",
                    border: "1px solid rgba(228,180,121,0.2)",
                  }}
                >
                  <p
                    className="text-xs font-bold tracking-wider uppercase mb-2"
                    style={{ color: "rgba(255,230,198,0.7)" }}
                  >
                    Receipt
                  </p>
                  <p className="text-sm font-bold" style={{ color: "#fff5e7" }}>
                    Serial: {(receipt as Record<string, string>).serial_number}
                  </p>
                  <p
                    className="text-sm"
                    style={{ color: "rgba(244,224,197,0.8)" }}
                  >
                    Amount: ₹
                    {formatINR((receipt as Record<string, number>).amount ?? 0)}
                  </p>
                </div>
              )}
              <button
                className="w-full py-3 rounded-xl font-bold text-white"
                style={{
                  background: "linear-gradient(135deg, #c96b1b, #e0b860)",
                  boxShadow: "0 12px 28px rgba(201,107,27,0.26)",
                }}
                onClick={() => setShowSuccess(false)}
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pledge modal */}
      <AnimatePresence>
        {showPledgeModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
            style={{
              background: "rgba(14,7,4,0.7)",
              backdropFilter: "blur(8px)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowPledgeModal(false)}
          >
            <motion.div
              className="w-full max-w-md p-5 sm:p-6 rounded-2xl"
              style={{
                background:
                  "linear-gradient(145deg, #2a150b, #3c1f0f 52%, #4a2610)",
                border: "1px solid rgba(228,180,121,0.35)",
                boxShadow: "0 24px 60px rgba(0,0,0,0.46)",
              }}
              initial={{ scale: 0.92, y: 18 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: -10 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                className="text-xl font-bold mb-2"
                style={{
                  fontFamily: '"Cinzel", Georgia, serif',
                  color: "#fff4e3",
                }}
              >
                Take a Pledge
              </h3>
              <p
                className="text-sm mb-4"
                style={{ color: "rgba(244,224,197,0.86)" }}
              >
                Donation will be done in
              </p>

              <div className="grid grid-cols-3 gap-2 mb-4">
                {[25, 35, 45].map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="py-2.5 rounded-xl text-sm font-bold"
                    style={{
                      background:
                        pledgeDays === d
                          ? "rgba(201,107,27,0.3)"
                          : "rgba(255,246,233,0.08)",
                      border: `1px solid ${pledgeDays === d ? "rgba(201,107,27,0.55)" : "rgba(228,180,121,0.2)"}`,
                      color: "#fff5e7",
                    }}
                    onClick={() => setPledgeDays(d)}
                  >
                    {d} Days
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 py-2.5 rounded-xl font-semibold"
                  style={{
                    background: "rgba(255,246,233,0.1)",
                    border: "1px solid rgba(228,180,121,0.2)",
                    color: "#ffe9cc",
                  }}
                  onClick={() => setShowPledgeModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="flex-1 py-2.5 rounded-xl font-bold text-white"
                  style={{
                    background: "linear-gradient(135deg, #c96b1b, #e0b860)",
                    opacity: submitting || !pledgeDays ? 0.65 : 1,
                  }}
                  disabled={submitting || !pledgeDays}
                  onClick={() => {
                    if (!pledgeDays) return;
                    void handleSubmit("pledge", pledgeDays);
                  }}
                >
                  {submitting ? "Processing..." : "Continue"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDonatePaymentModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
            style={{
              background: "rgba(14,7,4,0.7)",
              backdropFilter: "blur(8px)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowDonatePaymentModal(false)}
          >
            <motion.div
              className="w-full max-w-md p-5 sm:p-6 rounded-2xl"
              style={{
                background:
                  "linear-gradient(145deg, #2a150b, #3c1f0f 52%, #4a2610)",
                border: "1px solid rgba(228,180,121,0.35)",
                boxShadow: "0 24px 60px rgba(0,0,0,0.46)",
              }}
              initial={{ scale: 0.92, y: 18 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: -10 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                className="text-xl font-bold mb-2"
                style={{
                  fontFamily: '"Cinzel", Georgia, serif',
                  color: "#fff4e3",
                }}
              >
                Complete Donation
              </h3>
              <p
                className="text-sm mb-4"
                style={{ color: "rgba(244,224,197,0.86)" }}
              >
                Select payment method to continue.
              </p>

              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  { value: "cash", label: "Cash" },
                  { value: "upi", label: "UPI" },
                ].map((method) => (
                  <button
                    key={method.value}
                    type="button"
                    className="py-2.5 rounded-xl text-sm font-bold"
                    style={{
                      background:
                        donationPaymentMethod === method.value
                          ? "rgba(201,107,27,0.3)"
                          : "rgba(255,246,233,0.08)",
                      border: `1px solid ${donationPaymentMethod === method.value ? "rgba(201,107,27,0.55)" : "rgba(228,180,121,0.2)"}`,
                      color: "#fff5e7",
                    }}
                    onClick={() =>
                      setDonationPaymentMethod(
                        method.value as DonationPaymentMethod,
                      )
                    }
                  >
                    {method.label}
                  </button>
                ))}
              </div>

              {donationPaymentMethod === "upi" && (
                <div
                  className="rounded-xl p-3 mb-4"
                  style={{
                    background: "rgba(255,246,233,0.08)",
                    border: "1px solid rgba(228,180,121,0.2)",
                  }}
                >
                  <div className="flex items-center justify-center mb-3">
                    <div
                      className="rounded-lg p-2"
                      style={{
                        background: "#fff",
                        border: "1px solid rgba(0,0,0,0.12)",
                      }}
                    >
                      <div
                        style={{
                          width: 180,
                          height: 180,
                          display: "grid",
                          gridTemplateColumns: `repeat(${qrPattern.size}, 1fr)`,
                          gap: 1,
                          background: "#fff",
                        }}
                      >
                        {qrPattern.cells.map((cell, index) => (
                          <span
                            key={index}
                            style={{
                              width: "100%",
                              height: "100%",
                              background: cell ? "#111" : "#fff",
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <label
                    className="text-xs font-bold tracking-wider uppercase"
                    style={{ color: "rgba(255,230,198,0.85)" }}
                  >
                    Payment Reference
                  </label>
                  <input
                    type="text"
                    value={donationPaymentReference}
                    onChange={(e) =>
                      setDonationPaymentReference(e.target.value)
                    }
                    maxLength={50}
                    placeholder="Enter UPI reference"
                    className="mt-1 w-full px-3 py-2.5 rounded-xl text-base outline-none"
                    style={{
                      background: "rgba(255,250,244,0.96)",
                      border: "1px solid rgba(222,182,131,0.36)",
                      color: "#2a1509",
                      fontSize: "16px",
                    }}
                  />
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 py-2.5 rounded-xl font-semibold"
                  style={{
                    background: "rgba(255,246,233,0.1)",
                    border: "1px solid rgba(228,180,121,0.2)",
                    color: "#ffe9cc",
                  }}
                  onClick={() => setShowDonatePaymentModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="flex-1 py-2.5 rounded-xl font-bold text-white"
                  style={{
                    background: "linear-gradient(135deg, #c96b1b, #e0b860)",
                    opacity:
                      submitting ||
                      (donationPaymentMethod === "upi" &&
                        !donationPaymentReference.trim())
                        ? 0.65
                        : 1,
                  }}
                  disabled={
                    submitting ||
                    (donationPaymentMethod === "upi" &&
                      !donationPaymentReference.trim())
                  }
                  onClick={() =>
                    void handleSubmit(
                      "donate",
                      undefined,
                      donationPaymentMethod,
                      donationPaymentReference,
                    )
                  }
                >
                  {submitting ? "Processing..." : "Continue"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form card */}
      <motion.div
        className="w-full max-w-lg rounded-2xl overflow-hidden"
        style={{
          background:
            "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
          border: "1px solid rgba(170,120,75,0.2)",
          boxShadow:
            "0 30px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        {/* Header */}
        <div className="p-4 sm:p-6 pb-3 sm:pb-4">
          <p
            className="text-sm font-semibold tracking-[0.15em] mb-1"
            style={{
              fontFamily: '"Dancing Script", cursive',
              color: "rgba(255,244,232,0.96)",
              fontSize: "1.1rem",
            }}
          >
            Srila Bhaktivinoda Thakur&apos;s
          </p>
          <h1
            className="text-3xl sm:text-4xl font-black"
            style={{
              fontFamily: '"Cinzel", Georgia, serif',
              color: "#fff6ea",
              textShadow: "0 6px 28px rgba(45,20,10,0.32)",
            }}
          >
            Wall of Legacy
          </h1>
          <div className="flex items-center gap-3 mt-2">
            <div
              className="w-7 h-px"
              style={{ background: "rgba(198,136,74,0.86)" }}
            />
            <span
              className="text-xs sm:text-sm font-semibold tracking-[0.2em] uppercase"
              style={{ color: "rgba(246,232,214,0.9)" }}
            >
              Living Legacy Seva
            </span>
          </div>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "rgba(244,224,197,0.75)" }}
          >
            Add your name to the Living Wall. Each name becomes part of the
            sacred portrait.
          </p>
        </div>

        {/* Form body */}
        <div className="px-4 sm:px-6 pb-5 sm:pb-6 flex flex-col gap-4">
          {/* Name + Qty */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 flex flex-col gap-1.5">
              <label
                className="text-xs font-bold tracking-wider uppercase"
                style={{ color: "rgba(255,230,198,0.85)" }}
              >
                Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder="Your name"
                className="w-full px-3 py-2.5 rounded-xl text-base font-medium outline-none transition-all"
                style={{
                  background: "rgba(255,250,244,0.96)",
                  border: "1px solid rgba(222,182,131,0.36)",
                  color: "#2a1509",
                  fontSize: "16px",
                }}
              />
            </div>
            <div className="w-full sm:w-20 flex flex-col gap-1.5">
              <label
                className="text-xs font-bold tracking-wider uppercase"
                style={{ color: "rgba(255,230,198,0.85)" }}
              >
                Qty
              </label>
              <input
                type="text"
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
                maxLength={4}
                inputMode="numeric"
                className="w-full px-3 py-2.5 rounded-xl text-base font-medium outline-none"
                style={{
                  background: "rgba(255,250,244,0.96)",
                  border: "1px solid rgba(222,182,131,0.36)",
                  color: "#2a1509",
                  fontSize: "16px",
                }}
              />
            </div>
          </div>

          {/* Phone */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="w-full sm:w-2/5 flex flex-col gap-1.5">
              <label
                className="text-xs font-bold tracking-wider uppercase"
                style={{ color: "rgba(255,230,198,0.85)" }}
              >
                Country
              </label>
              <select
                value={phoneCode}
                onChange={(e) => setPhoneCode(e.target.value)}
                className="w-full px-2 py-2.5 rounded-xl text-base outline-none"
                style={{
                  background: "rgba(255,250,244,0.96)",
                  border: "1px solid rgba(222,182,131,0.36)",
                  color: "#2a1509",
                  fontSize: "16px",
                }}
              >
                {COUNTRY_CODES.map(([country, code]) => (
                  <option key={`${country}-${code}`} value={code}>
                    {country} ({code})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 flex flex-col gap-1.5">
              <label
                className="text-xs font-bold tracking-wider uppercase"
                style={{ color: "rgba(255,230,198,0.85)" }}
              >
                Phone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={20}
                placeholder="Phone number"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="tel-national"
                className="w-full px-3 py-2.5 rounded-xl text-base outline-none"
                style={{
                  background: "rgba(255,250,244,0.96)",
                  border: "1px solid rgba(222,182,131,0.36)",
                  color: "#2a1509",
                  fontSize: "16px",
                }}
              />
            </div>
          </div>

          {/* Same as phone checkbox */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={sameAsPhone}
              onChange={(e) => setSameAsPhone(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <span
              className="text-xs font-semibold"
              style={{ color: "#ffe9cc" }}
            >
              WhatsApp same as phone
            </span>
          </label>

          {/* WhatsApp */}
          {!sameAsPhone && (
            <motion.div
              className="flex flex-col sm:flex-row gap-3"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
            >
              <div className="w-full sm:w-2/5 flex flex-col gap-1.5">
                <label
                  className="text-xs font-bold tracking-wider uppercase"
                  style={{ color: "rgba(255,230,198,0.85)" }}
                >
                  Country
                </label>
                <select
                  value={whatsappCode}
                  onChange={(e) => setWhatsappCode(e.target.value)}
                  className="w-full px-2 py-2.5 rounded-xl text-base outline-none"
                  style={{
                    background: "rgba(255,250,244,0.96)",
                    border: "1px solid rgba(222,182,131,0.36)",
                    color: "#2a1509",
                    fontSize: "16px",
                  }}
                >
                  {COUNTRY_CODES.map(([country, code]) => (
                    <option key={`w-${country}-${code}`} value={code}>
                      {country} ({code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 flex flex-col gap-1.5">
                <label
                  className="text-xs font-bold tracking-wider uppercase"
                  style={{ color: "rgba(255,230,198,0.85)" }}
                >
                  WhatsApp
                </label>
                <input
                  type="tel"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  maxLength={20}
                  placeholder="WhatsApp number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="tel-national"
                  className="w-full px-3 py-2.5 rounded-xl text-base outline-none"
                  style={{
                    background: "rgba(255,250,244,0.96)",
                    border: "1px solid rgba(222,182,131,0.36)",
                    color: "#2a1509",
                    fontSize: "16px",
                  }}
                />
              </div>
            </motion.div>
          )}

          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-bold tracking-wider uppercase"
              style={{ color: "rgba(255,230,198,0.85)" }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={80}
              placeholder="your@email.com"
              className="w-full px-3 py-2.5 rounded-xl text-base outline-none"
              style={{
                background: "rgba(255,250,244,0.96)",
                border: "1px solid rgba(222,182,131,0.36)",
                color: "#2a1509",
                fontSize: "16px",
              }}
            />
          </div>

          {/* DOB */}
          <div className="flex flex-col gap-1.5 min-w-0 w-full">
            <label
              className="text-xs font-bold tracking-wider uppercase"
              style={{ color: "rgba(255,230,198,0.85)" }}
            >
              Date of Birth
            </label>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className="w-full min-w-0 max-w-full px-3 py-2.5 rounded-xl text-base outline-none"
              style={{
                background: "rgba(255,250,244,0.96)",
                border: "1px solid rgba(222,182,131,0.36)",
                color: "#2a1509",
                fontSize: "16px",
                boxSizing: "border-box",
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                WebkitAppearance: "none",
                appearance: "none",
              }}
            />
          </div>

          {/* Block selector */}
          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-bold tracking-wider uppercase"
              style={{ color: "rgba(255,230,198,0.85)" }}
            >
              Block (auto-assigned or choose)
            </label>
            <select
              value={blockIdStr}
              onChange={(e) => {
                setBlockIdStr(e.target.value);
                setIsBlockManuallyChosen(true);
              }}
              className="w-full px-3 py-2.5 rounded-xl text-base outline-none"
              style={{
                background: "rgba(255,250,244,0.96)",
                border: "1px solid rgba(222,182,131,0.36)",
                color: "#2a1509",
                fontSize: "16px",
              }}
            >
              {availableBlocks.map((b) => (
                <option key={b.id} value={b.id}>
                  Block {b.id} — {b.remaining} slots remaining
                </option>
              ))}
            </select>
          </div>

          {/* Total */}
          <div
            className="flex justify-between items-center px-3 py-2.5 rounded-xl"
            style={{
              background: "rgba(255,246,233,0.12)",
              border: "1px solid rgba(228,180,121,0.24)",
            }}
          >
            <span
              className="text-xs font-bold tracking-wider uppercase"
              style={{ color: "rgba(255,230,198,0.88)" }}
            >
              Total Amount
            </span>
            <span
              className="text-lg font-extrabold"
              style={{ color: "#fff5e7" }}
            >
              ₹{formatINR(totalAmount)}
            </span>
          </div>

          {/* Status */}
          {status && (
            <p className="text-sm" style={{ color: "#f6d8af" }}>
              {status}
            </p>
          )}

          {/* Submit */}
          <div className="grid grid-cols-2 gap-2">
            <motion.button
              className="w-full py-3.5 rounded-xl font-bold text-white text-base"
              style={{
                background: "linear-gradient(135deg, #c96b1b, #e0b860)",
                boxShadow: "0 12px 28px rgba(201,107,27,0.26)",
                opacity: submitting ? 0.7 : 1,
              }}
              whileHover={{
                y: -1,
                boxShadow: "0 16px 36px rgba(201,107,27,0.35)",
              }}
              whileTap={{ scale: 0.98 }}
              disabled={submitting}
              onClick={() => {
                setDonationPaymentMethod("cash");
                setDonationPaymentReference("");
                setQrSeed(Date.now() + Math.floor(Math.random() * 1000));
                setShowDonatePaymentModal(true);
              }}
            >
              {submitting ? "Processing..." : "Donate Now"}
            </motion.button>

            <motion.button
              className="w-full py-3.5 rounded-xl font-bold text-white text-base"
              style={{
                background: "linear-gradient(135deg, #6b4326, #8f6138)",
                boxShadow: "0 12px 28px rgba(106,67,38,0.26)",
                opacity: submitting ? 0.7 : 1,
              }}
              whileHover={{
                y: -1,
                boxShadow: "0 16px 36px rgba(106,67,38,0.35)",
              }}
              whileTap={{ scale: 0.98 }}
              disabled={submitting}
              onClick={() => {
                setPledgeDays(null);
                setShowPledgeModal(true);
              }}
            >
              Take a Pledge
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
