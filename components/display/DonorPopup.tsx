"use client";

import { motion } from "framer-motion";
import type { DonorEvent } from "@/lib/mosaic/engine";
import { formatINR, COST_PER_NAME } from "@/lib/mosaic/engine";

type PopupPosition = {
  top: string;
  left: string;
};

interface Props {
  donor: DonorEvent;
  position: PopupPosition;
}

export function DonorPopup({ donor, position }: Props) {
  return (
    <motion.div
      className="fixed z-50 pointer-events-none"
      style={{ top: position.top, left: position.left, x: "-50%", y: "-50%" }}
      initial={{ opacity: 0, y: 50, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -30, scale: 0.9 }}
      transition={{
        type: "spring",
        stiffness: 260,
        damping: 22,
        duration: 0.6,
      }}
    >
      <div className="relative">
        {/* Outer glow */}
        <div
          className="absolute -inset-2 rounded-3xl opacity-60 blur-xl"
          style={{
            background:
              "radial-gradient(ellipse, rgba(255,196,132,0.52), transparent 72%)",
          }}
        />

        {/* Main card */}
        <div
          className="relative px-12 py-9 rounded-2xl backdrop-blur-2xl min-w-115"
          style={{
            background:
              "linear-gradient(160deg, rgba(255,249,241,0.97), rgba(255,241,222,0.95) 46%, rgba(255,232,205,0.94))",
            border: "1px solid rgba(221,168,96,0.5)",
            boxShadow:
              "0 26px 64px rgba(96,58,27,0.26), 0 0 0 1px rgba(255,255,255,0.56), inset 0 1px 0 rgba(255,255,255,0.7)",
          }}
        >
          {/* Top accent line */}
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-0.5 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(214,151,67,0.82), transparent)",
            }}
          />

          {/* Floral accent */}
          <motion.div
            className="text-center text-3xl mb-2"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: "spring", stiffness: 400 }}
          >
            🌸🪷🌸
          </motion.div>

          {/* Label */}
          <p
            className="text-center text-xs font-semibold tracking-[0.2em] uppercase mb-2"
            style={{ color: "rgba(165,103,35,0.85)" }}
          >
            {donor.type === "donation" ? "New Offering" : "New Pledge"}
          </p>

          <h3
            className="text-center text-3xl font-black mb-2"
            style={{
              fontFamily: '"Cinzel", Georgia, serif',
              color: "#8b4e14",
              textShadow: "0 2px 12px rgba(255,255,255,0.62)",
            }}
          >
            Thank You!
          </h3>

          <p
            className="text-center text-lg font-semibold mb-3"
            style={{ color: "#7c4b1d" }}
          >
            for your contribution seva
          </p>

          {/* Donor name */}
          <motion.h2
            className="text-center text-3xl font-bold mb-2"
            style={{
              fontFamily: '"Cinzel", Georgia, serif',
              color: "#3c240f",
              textShadow: "0 3px 14px rgba(255,255,255,0.55)",
            }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            {donor.name}
          </motion.h2>

          {/* Block info */}
          <motion.div
            className="flex items-center justify-center gap-4 text-base"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <span
              className="px-3 py-1 rounded-full text-sm font-bold"
              style={{
                background: "rgba(233,186,119,0.18)",
                border: "1px solid rgba(201,136,64,0.4)",
                color: "#5a3314",
              }}
            >
              Block {donor.blockId}
            </span>
            <span style={{ color: "rgba(92,56,27,0.9)" }}>
              {donor.qty} name{donor.qty > 1 ? "s" : ""} · ₹
              {formatINR(donor.qty * COST_PER_NAME)}
            </span>
          </motion.div>

          <div className="text-center text-2xl mt-3" aria-hidden="true">
            🌼 🌺 🌼
          </div>

          {/* Bottom accent */}
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-px rounded-full"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(201,136,64,0.55), transparent)",
            }}
          />
        </div>
      </div>
    </motion.div>
  );
}
