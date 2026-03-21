"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const ROTATING_MESSAGES = [
  "My Temple. My Offering.",
  "Built by devotion, not by wealth",
  "Your name, etched on the Wall of Legacy",
  "Be among the first 1,00,000 devotees",
  "A rare sacred opportunity awaits you",
  "Join the Wall of Legacy — today",
  "A small offering. A lasting legacy.",
  "Let your name live here — forever",
  "Secure your place before it's filled",
];

interface Props {
  visible: boolean;
}

export function LoadingScreen({ visible }: Props) {
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => {
      setMsgIndex((prev) => (prev + 1) % ROTATING_MESSAGES.length);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[240] flex items-center justify-center"
          style={{
            background: `
              radial-gradient(circle at 20% 20%, rgba(222,174,116,0.2), transparent 32%),
              radial-gradient(circle at 80% 75%, rgba(120,70,35,0.28), transparent 36%),
              linear-gradient(145deg, rgba(27,16,10,0.98), rgba(41,23,12,0.97))
            `,
          }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div
            className="w-[min(460px,88vw)] p-8 rounded-[22px] flex flex-col items-center gap-4 text-center"
            style={{
              border: "1px solid rgba(206,153,97,0.35)",
              background:
                "linear-gradient(180deg, rgba(56,30,14,0.9), rgba(40,22,12,0.88))",
              boxShadow:
                "0 24px 60px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,235,210,0.16)",
            }}
          >
            {/* Animated frame */}
            <div
              className="w-[86px] h-[86px] rounded-[14px] relative overflow-hidden"
              style={{
                border: "3px solid #b97a3e",
                boxShadow:
                  "0 0 0 1px rgba(255,230,195,0.4), inset 0 0 0 2px rgba(255,216,160,0.2)",
              }}
            >
              <motion.div
                className="absolute inset-[-60%_20%] "
                style={{
                  background:
                    "linear-gradient(180deg, transparent, rgba(255,236,205,0.78), transparent)",
                }}
                animate={{ y: ["-80%", "80%"] }}
                transition={{
                  duration: 1.4,
                  ease: "easeInOut",
                  repeat: Infinity,
                }}
              />
              <div
                className="absolute inset-3"
                style={{ border: "1px solid rgba(255,228,190,0.35)" }}
              />
            </div>

            <h2
              className="text-xl font-bold tracking-wide"
              style={{
                fontFamily: '"Cinzel", Georgia, serif',
                color: "#fff4e3",
              }}
            >
              Preparing the Legacy Wall
            </h2>
            <p className="text-sm" style={{ color: "rgba(244,224,197,0.86)" }}>
              Framing the mosaic and loading names.
            </p>

            {/* Rotating text */}
            <div className="relative h-7 overflow-hidden w-full mt-1">
              <AnimatePresence mode="wait">
                <motion.span
                  key={msgIndex}
                  className="absolute inset-0 flex items-center justify-center text-sm font-medium tracking-wide"
                  style={{ color: "#f4e4c1", willChange: "transform, opacity" }}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                >
                  {ROTATING_MESSAGES[msgIndex]}
                </motion.span>
              </AnimatePresence>
            </div>

            {/* Dots */}
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="w-[7px] h-[7px] rounded-full"
                  style={{ background: "#f4d0a2" }}
                  animate={{
                    scale: [0.75, 1, 0.75],
                    opacity: [0.45, 1, 0.45],
                  }}
                  transition={{
                    duration: 1,
                    ease: "easeInOut",
                    repeat: Infinity,
                    delay: i * 0.16,
                  }}
                />
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
