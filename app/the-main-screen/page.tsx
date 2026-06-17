"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type MouseEvent as ReactMouseEvent,
  type FormEvent as ReactFormEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MosaicGrid } from "@/components/mosaic/MosaicGrid";
import { DonorPopup } from "@/components/display/DonorPopup";
import { LoadingScreen } from "@/components/shared/LoadingScreen";
import { useBlockData } from "@/hooks/useBlockData";
import { useSSE } from "@/hooks/useSSE";
import type { DonorEvent, BlockData } from "@/lib/mosaic/engine";
import {
  formatINR,
  COST_PER_NAME,
  GRID_SIZE,
  NAMES_PER_BLOCK,
  baseText,
  generateNameList,
  escapeHtml,
  SEPARATOR,
  backgroundPosition,
  parseBlockId,
} from "@/lib/mosaic/engine";
import { binaryFitFontSize } from "@/lib/mosaic/font-fitter";

type ActiveDonorPopup = {
  id: string;
  donor: DonorEvent;
  position: {
    top: string;
    left: string;
  };
};

const MAX_ACTIVE_POPUPS = 6;
const PAGE_PASSWORD = "16108";
const MAIN_SCREEN_AUTH_KEY = "kc-main-screen-auth-date";
const COL_LABELS = Array.from({ length: GRID_SIZE }, (_, index) =>
  String.fromCharCode(65 + index),
);

type HoverTooltip = {
  id: string;
  used: number;
  remaining: number;
  entries: number;
  x: number;
  y: number;
};

function buildFocusColorMarkup(
  data: BlockData | null,
  targetName?: string | null,
): string {
  if (!data?.names.length) return "";
  const nl = generateNameList(data);
  const usedByEntries = data.names.reduce(
    (sum, entry) => sum + Math.max(0, entry.qty),
    0,
  );
  const filledSlots = Math.max(
    0,
    Math.min(NAMES_PER_BLOCK, data.total_used || usedByEntries),
  );
  const normalizedTarget = targetName?.trim().toLowerCase() ?? "";
  const targetIndexes: number[] = [];
  if (normalizedTarget) {
    for (let i = 0; i < filledSlots; i++) {
      if (nl[i]?.trim().toLowerCase() === normalizedTarget) {
        targetIndexes.push(i);
      }
    }
  }
  const middleTargetIndex =
    targetIndexes.length > 0
      ? targetIndexes[Math.floor((targetIndexes.length - 1) / 2)]
      : -1;

  return nl
    .map((n, i) => {
      const sep = i < nl.length - 1 ? SEPARATOR : "";
      const escaped = escapeHtml(n);
      if (i < filledSlots) {
        const isTarget = i === middleTargetIndex;
        if (isTarget) {
          return `<span class="focus-token-target">${escaped}</span>${sep}`;
        }
        return escaped + sep;
      }
      return `<span class="hf" style="visibility:hidden;">${escaped}</span>${sep}`;
    })
    .join("");
}

export default function TheMainScreen() {
  const [isMobile, setIsMobile] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const isSmall = window.matchMedia("(max-width: 1024px)").matches;
      setIsMobile(isSmall);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const savedDate = localStorage.getItem(MAIN_SCREEN_AUTH_KEY);
    if (savedDate === today) {
      setIsAuthorized(true);
    }
    setAuthChecked(true);
  }, []);

  const handlePasswordSubmit = useCallback(
    (event: ReactFormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (passwordInput === PAGE_PASSWORD) {
        const today = new Date().toISOString().slice(0, 10);
        localStorage.setItem(MAIN_SCREEN_AUTH_KEY, today);
        setIsAuthorized(true);
        setPasswordError(false);
      } else {
        setPasswordError(true);
        setPasswordInput("");
      }
    },
    [passwordInput],
  );

  const { blocks, loading, fetchBlock } = useBlockData();
  const [wallReady, setWallReady] = useState(false);
  const [activePopups, setActivePopups] = useState<ActiveDonorPopup[]>([]);
  const [popupQueue, setPopupQueue] = useState<DonorEvent[]>([]);
  const [highlightedBlock, setHighlightedBlock] = useState<string | null>(null);
  const [hoverTooltip, setHoverTooltip] = useState<HoverTooltip | null>(null);
  const [focusedBlock, setFocusedBlock] = useState<string | null>(null);
  const [focusData, setFocusData] = useState<BlockData | null>(null);
  const [focusLoading, setFocusLoading] = useState(false);
  const [focusSearchQuery, setFocusSearchQuery] = useState("");
  const [focusTargetName, setFocusTargetName] = useState<string | null>(null);
  const [focusZoomKey, setFocusZoomKey] = useState(0);
  const popupTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightFetchesRef = useRef<Set<string>>(new Set());
  const blocksRef = useRef(blocks);
  const focusBaseRef = useRef<HTMLDivElement>(null);
  const focusColorRef = useRef<HTMLDivElement>(null);
  const focusPreviewRef = useRef<HTMLDivElement>(null);
  const focusNameListRef = useRef<HTMLDivElement>(null);
  const focusSwitchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  const removePopup = useCallback((popupId: string) => {
    setActivePopups((prev) => prev.filter((popup) => popup.id !== popupId));
    const timer = popupTimersRef.current.get(popupId);
    if (timer) {
      clearTimeout(timer);
      popupTimersRef.current.delete(popupId);
    }
  }, []);

  const randomPosition = useCallback((existing: ActiveDonorPopup[]) => {
    const SLOTS = [
      { top: 25, left: 16 },
      { top: 25, left: 50 },
      { top: 25, left: 84 },
      { top: 58, left: 16 },
      { top: 58, left: 50 },
      { top: 58, left: 84 },
    ];

    const availableSlots = SLOTS.filter((slot) => {
      // Check if slot is already occupied by any active popup
      return !existing.some((popup) => {
        const pt = Number.parseFloat(popup.position.top);
        const pl = Number.parseFloat(popup.position.left);
        // Increase detection radius to ensure we don't accidentally reuse a slot
        return Math.abs(pt - slot.top) < 20 && Math.abs(pl - slot.left) < 20;
      });
    });

    // Pick an available predefined slot, or ultimate fallback if screen is cramped
    const slot = availableSlots.length > 0
      ? availableSlots[Math.floor(Math.random() * availableSlots.length)]
      : SLOTS[Math.floor(Math.random() * SLOTS.length)];

    // Add slight natural jitter (±2%) so it feels organic rather than a rigid grid
    const jitterTop = (Math.random() * 3) - 1.5;
    const jitterLeft = (Math.random() * 3) - 1.5;

    return {
      top: `${slot.top + jitterTop}%`,
      left: `${slot.left + jitterLeft}%`,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function settleWall() {
      if (loading) {
        setWallReady(false);
        return;
      }

      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (fonts?.ready) await fonts.ready;

      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );

      if (!cancelled) setWallReady(true);
    }

    void settleWall();
    return () => {
      cancelled = true;
    };
  }, [loading]);

  useEffect(() => {
    return () => {
      popupTimersRef.current.forEach((timer) => clearTimeout(timer));
      popupTimersRef.current.clear();
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      if (focusSwitchTimerRef.current !== null) {
        window.clearTimeout(focusSwitchTimerRef.current);
      }
    };
  }, []);

  const isBooting = loading || !wallReady;

  const updateHoverTooltip = useCallback(
    (id: string, event: ReactMouseEvent<HTMLDivElement>) => {
      const block = blocksRef.current.get(id);
      if (!block) return;
      setHoverTooltip({
        id,
        used: block.total_used,
        remaining: block.remaining,
        entries: block.names.length,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [],
  );

  const handleBlockHoverStart = useCallback(
    (id: string, event: ReactMouseEvent<HTMLDivElement>) => {
      updateHoverTooltip(id, event);
    },
    [updateHoverTooltip],
  );

  const handleBlockHoverMove = useCallback(
    (id: string, event: ReactMouseEvent<HTMLDivElement>) => {
      updateHoverTooltip(id, event);
    },
    [updateHoverTooltip],
  );

  const handleBlockHoverEnd = useCallback(() => {
    setHoverTooltip(null);
  }, []);

  const openBlock = useCallback(
    async (id: string) => {
      setHoverTooltip(null);
      setFocusLoading(true);
      setFocusedBlock(id);
      setFocusData(blocksRef.current.get(id) ?? null);
      setFocusSearchQuery("");
      setFocusTargetName(null);
      try {
        const data = await fetchBlock(id);
        setFocusData(data);
      } finally {
        setFocusLoading(false);
      }
    },
    [fetchBlock],
  );

  const closeBlock = useCallback(() => {
    setFocusedBlock(null);
    setFocusData(null);
    setFocusSearchQuery("");
    setFocusTargetName(null);
    if (focusSwitchTimerRef.current !== null) {
      window.clearTimeout(focusSwitchTimerRef.current);
      focusSwitchTimerRef.current = null;
    }
  }, []);

  const handleFocusNameClick = useCallback((name: string) => {
    if (focusSwitchTimerRef.current !== null) {
      window.clearTimeout(focusSwitchTimerRef.current);
      focusSwitchTimerRef.current = null;
    }

    setFocusTargetName(null);
    focusSwitchTimerRef.current = window.setTimeout(() => {
      setFocusTargetName(name);
      setFocusZoomKey((prev) => prev + 1);
      focusSwitchTimerRef.current = null;
    }, 30);
  }, []);

  const filteredFocusNames = useMemo(() => {
    if (!focusData) return [];
    const query = focusSearchQuery.trim().toLowerCase();
    if (!query) return focusData.names;
    return focusData.names.filter((entry) =>
      entry.name.toLowerCase().includes(query),
    );
  }, [focusData, focusSearchQuery]);

  useEffect(() => {
    if (!focusedBlock || !focusData) return;
    let zoomTimer: number | null = null;

    const text = baseText(focusData);
    const markup = buildFocusColorMarkup(focusData, focusTargetName);
    const { row, col } = parseBlockId(focusedBlock);
    const bp = backgroundPosition(row, col);
    const bgSize = `${GRID_SIZE * 100}% ${GRID_SIZE * 100}%`;

    if (focusBaseRef.current) {
      focusBaseRef.current.textContent = text;
      focusBaseRef.current.style.backgroundPosition = bp;
      focusBaseRef.current.style.backgroundSize = bgSize;
      binaryFitFontSize(focusBaseRef.current, 0.5, 40, 18);
    }

    if (focusColorRef.current) {
      focusColorRef.current.innerHTML = markup;
      focusColorRef.current.style.backgroundPosition = bp;
      focusColorRef.current.style.backgroundSize = bgSize;
      binaryFitFontSize(focusColorRef.current, 0.5, 40, 18);

      if (focusTargetName) {
        requestAnimationFrame(() => {
          if (!focusColorRef.current || !focusBaseRef.current) return;
          const targetEl = focusColorRef.current.querySelector<HTMLElement>(
            ".focus-token-target",
          );
          if (!targetEl) return;

          const containerRect = focusColorRef.current.getBoundingClientRect();
          const targetRect = targetEl.getBoundingClientRect();
          const centerX =
            targetRect.left + targetRect.width / 2 - containerRect.left;
          const centerY =
            targetRect.top + targetRect.height / 2 - containerRect.top;
          const zoomScale = 4.8;
          const desiredTx = containerRect.width / 2 - centerX * zoomScale;
          const desiredTy = containerRect.height / 2 - centerY * zoomScale;
          const minTx = containerRect.width - containerRect.width * zoomScale;
          const maxTx = 0;
          const minTy = containerRect.height - containerRect.height * zoomScale;
          const maxTy = 0;
          const tx = Math.min(maxTx, Math.max(minTx, desiredTx));
          const ty = Math.min(maxTy, Math.max(minTy, desiredTy));

          const applyZoomIn = () => {
            if (!focusBaseRef.current || !focusColorRef.current) return;
            [focusBaseRef.current, focusColorRef.current].forEach((layer) => {
              layer.style.transformOrigin = "0 0";
              layer.style.transition =
                "transform 380ms cubic-bezier(0.22, 1, 0.36, 1)";
              layer.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${zoomScale})`;
            });

            if (focusPreviewRef.current) {
              focusPreviewRef.current.style.transition =
                "box-shadow 320ms cubic-bezier(0.22, 1, 0.36, 1)";
              focusPreviewRef.current.style.boxShadow =
                "0 40px 90px rgba(201,107,27,0.35)";
            }
          };

          const hasExistingZoom =
            focusBaseRef.current.style.transform &&
            focusBaseRef.current.style.transform !==
              "translate3d(0, 0, 0) scale(1)";

          if (hasExistingZoom) {
            [focusBaseRef.current, focusColorRef.current].forEach((layer) => {
              layer.style.transformOrigin = "0 0";
              layer.style.transition = "transform 220ms ease-out";
              layer.style.transform = "translate3d(0, 0, 0) scale(1)";
            });

            if (focusPreviewRef.current) {
              focusPreviewRef.current.style.transition =
                "box-shadow 220ms ease-out";
              focusPreviewRef.current.style.boxShadow =
                "0 30px 80px rgba(0,0,0,0.1)";
            }

            zoomTimer = window.setTimeout(() => {
              applyZoomIn();
            }, 240);
          } else {
            applyZoomIn();
          }
        });
      } else {
        [focusBaseRef.current, focusColorRef.current].forEach((layer) => {
          if (!layer) return;
          layer.style.transformOrigin = "0 0";
          layer.style.transition = "transform 260ms ease-out";
          layer.style.transform = "translate3d(0, 0, 0) scale(1)";
        });
        if (focusPreviewRef.current) {
          focusPreviewRef.current.style.transition =
            "box-shadow 260ms ease-out";
          focusPreviewRef.current.style.boxShadow =
            "0 30px 80px rgba(0,0,0,0.1)";
        }
      }
    }

    return () => {
      if (zoomTimer !== null) window.clearTimeout(zoomTimer);
    };
  }, [focusedBlock, focusData, focusTargetName, focusZoomKey]);

  useEffect(() => {
    if (!focusTargetName || !focusNameListRef.current) return;
    const normalizedTarget = focusTargetName.trim().toLowerCase();
    const targetEl = Array.from(
      focusNameListRef.current.querySelectorAll<HTMLElement>(
        "[data-entry-name]",
      ),
    ).find(
      (el) =>
        (el.dataset.entryName || "").trim().toLowerCase() === normalizedTarget,
    );
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusTargetName, focusData, focusZoomKey]);

  // SSE handler
  const handleSSEMessage = useCallback(
    (data: unknown) => {
      const donor = data as DonorEvent;
      if (donor.blockId && donor.name) {
        if (!inFlightFetchesRef.current.has(donor.blockId)) {
          inFlightFetchesRef.current.add(donor.blockId);
          void fetchBlock(donor.blockId).finally(() => {
            inFlightFetchesRef.current.delete(donor.blockId);
          });
        }

        setPopupQueue((prev) => [...prev, donor]);

        setHighlightedBlock(donor.blockId);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => {
          setHighlightedBlock((current) =>
            current === donor.blockId ? null : current,
          );
        }, 2600);
      }
    },
    [fetchBlock],
  );

  useEffect(() => {
    if (activePopups.length < MAX_ACTIVE_POPUPS && popupQueue.length > 0) {
      const nextDonor = popupQueue[0];
      const popupId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      setPopupQueue((prev) => prev.slice(1));

      setActivePopups((prev) => {
        const position = randomPosition(prev);
        return [...prev, { id: popupId, donor: nextDonor, position }];
      });

      const timer = setTimeout(() => removePopup(popupId), 12000);
      popupTimersRef.current.set(popupId, timer);
    }
  }, [activePopups.length, popupQueue, randomPosition, removePopup]);

  useSSE("/api/events", handleSSEMessage, !isBooting);

  // Get total stats
  const [totalNames, setTotalNames] = useState(0);
  const [totalCollected, setTotalCollected] = useState(0);

  useEffect(() => {
    if (!loading) {
      let total = 0;
      blocks.forEach((b) => {
        total += b.total_used;
      });
      setTotalNames(total);
      setTotalCollected(total * COST_PER_NAME);
    }
  }, [blocks, loading]);

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
        className="min-h-screen w-full flex items-center justify-center px-4"
        style={{ background: "#f2ece2", color: "#2a1509" }}
      >
        <form
          onSubmit={handlePasswordSubmit}
          className="w-full max-w-sm flex flex-col gap-4 p-8 rounded-2xl"
          style={{
            background: "rgba(255,255,255,0.7)",
            border: "1px solid rgba(61,45,19,0.12)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.12)",
          }}
        >
          <div>
            <h1
              className="text-2xl font-black leading-none"
              style={{ fontFamily: '"Cinzel", Georgia, serif', color: "#2d1c0e" }}
            >
              Wall of Legacy
            </h1>
            <p className="text-sm mt-2" style={{ color: "#8d785f" }}>
              Enter the password to view the wall.
            </p>
          </div>
          <input
            type="password"
            autoFocus
            value={passwordInput}
            onChange={(e) => {
              setPasswordInput(e.target.value);
              if (passwordError) setPasswordError(false);
            }}
            placeholder="Password"
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{
              background: "rgba(255,250,244,0.96)",
              border: passwordError
                ? "1px solid rgba(200,60,40,0.6)"
                : "1px solid rgba(222,182,131,0.5)",
              color: "#2a1509",
            }}
          />
          {passwordError && (
            <p className="text-xs" style={{ color: "#b3371f" }}>
              Incorrect password. Please try again.
            </p>
          )}
          <button
            type="submit"
            className="w-full py-2.5 rounded-lg text-sm font-bold text-white"
            style={{ background: "linear-gradient(135deg, #c96b1b, #e0b860)" }}
          >
            Unlock
          </button>
        </form>
      </div>
    );
  }

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
            The living wall experience is best viewed on a computer browser.
            Please open this page on a desktop or laptop for the full
            interactive experience.
          </p>
          <p className="text-xs" style={{ color: "#8d785f" }}>
            You can still submit inscriptions from the{" "}
            <a
              href="/donor-form"
              className="font-semibold"
              style={{ color: "#c96b1b" }}
            >
              donation form
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-screen w-screen overflow-hidden relative flex items-center justify-center"
      style={{
        background: `
          radial-gradient(circle at top left, rgba(201,107,27,0.08), transparent 26%),
          radial-gradient(circle at 85% 18%, rgba(215,173,87,0.1), transparent 24%),
          linear-gradient(135deg, rgba(255,255,255,0.4), rgba(255,248,237,0.08)),
          #f2ece2
        `,
      }}
    >
      <LoadingScreen visible={isBooting} />

      {/* Top bar — minimal heading */}
      <motion.div
        className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-8 py-4"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: isBooting ? 0 : 1, y: isBooting ? -20 : 0 }}
        transition={{ delay: 0.3, duration: 0.6 }}
      >
        <div className="flex items-center gap-4">
          <div>
            <p
              className="text-sm font-semibold tracking-[0.15em]"
              style={{
                color: "rgba(59,33,14,0.9)",
                fontFamily: '"Dancing Script", cursive',
                fontSize: "1.05rem",
              }}
            >
              Srila Bhaktivinoda Thakur&apos;s
            </p>
            <h1
              className="text-3xl font-black leading-none"
              style={{
                fontFamily: '"Cinzel", Georgia, serif',
                color: "#2d1c0e",
                textShadow: "0 6px 24px rgba(255,255,255,0.45)",
              }}
            >
              Wall of Legacy
            </h1>
            <div className="flex items-center gap-3 mt-1.5">
              <div
                className="w-7 h-px"
                style={{ background: "rgba(201,107,27,0.75)" }}
              />
              <span
                className="text-xs font-semibold tracking-[0.2em] uppercase"
                style={{ color: "rgba(73,47,26,0.88)" }}
              >
                Living Legacy Seva
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <p
              className="text-xs font-bold tracking-wider uppercase"
              style={{ color: "#8d785f" }}
            >
              Names Inscribed
            </p>
            <p
              className="text-xl font-bold"
              style={{
                background: "linear-gradient(135deg, #c96b1b, #d7ad57)",
                WebkitBackgroundClip: "text",
                color: "transparent",
              }}
            >
              {formatINR(totalNames)}
            </p>
          </div>
          <div className="text-right">
            <p
              className="text-xs font-bold tracking-wider uppercase"
              style={{ color: "#8d785f" }}
            >
              Amount Raised
            </p>
            <p
              className="text-xl font-bold"
              style={{
                background: "linear-gradient(135deg, #c96b1b, #d7ad57)",
                WebkitBackgroundClip: "text",
                color: "transparent",
              }}
            >
              ₹{formatINR(totalCollected)}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Mosaic — centered, immersive */}
      <motion.div
        className="relative"
        style={{ width: "min(82vh, 70vw)", height: "min(82vh, 70vw)" }}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: isBooting ? 0 : 1, scale: isBooting ? 0.95 : 1 }}
        transition={{ delay: 0.2, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      >
        <div
          className="absolute -top-7 left-0 right-0 grid z-10"
          style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)` }}
        >
          {COL_LABELS.map((label) => (
            <span
              key={`col-${label}`}
              className="text-center text-xs font-bold tracking-wider"
              style={{ color: "rgba(66,44,25,0.8)" }}
            >
              {label}
            </span>
          ))}
        </div>

        <div
          className="absolute -left-7 top-0 bottom-0 grid z-10"
          style={{ gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)` }}
        >
          {Array.from({ length: GRID_SIZE }, (_, index) => (
            <span
              key={`row-${index + 1}`}
              className="flex items-center justify-center text-xs font-bold tracking-wider"
              style={{ color: "rgba(66,44,25,0.8)" }}
            >
              {index + 1}
            </span>
          ))}
        </div>

        <MosaicGrid
          blocks={blocks}
          isColorMode={false}
          highlightedBlock={highlightedBlock}
          onBlockClick={openBlock}
          onBlockHoverStart={handleBlockHoverStart}
          onBlockHoverMove={handleBlockHoverMove}
          onBlockHoverEnd={handleBlockHoverEnd}
          className="w-full h-full"
        />
      </motion.div>

      {hoverTooltip && (
        <div
          className="fixed z-40 pointer-events-none px-3 py-2 rounded-lg"
          style={{
            left: hoverTooltip.x + 14,
            top: hoverTooltip.y + 16,
            transform: "translateY(-50%)",
            background:
              "linear-gradient(180deg, rgba(31,18,11,0.96), rgba(45,24,12,0.94))",
            border: "1px solid rgba(201,107,27,0.24)",
            boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
          }}
        >
          <div className="text-sm font-bold" style={{ color: "#fff5e7" }}>
            Block {hoverTooltip.id}
          </div>
          <div
            className="text-[11px] mt-0.5"
            style={{ color: "rgba(255,230,198,0.86)" }}
          >
            Used {formatINR(hoverTooltip.used)} / {formatINR(NAMES_PER_BLOCK)} ·
            Remaining {formatINR(hoverTooltip.remaining)} · Entries{" "}
            {hoverTooltip.entries}
          </div>
        </div>
      )}

      {/* Bottom marquee area */}
      <motion.div
        className="absolute bottom-0 left-0 right-0 h-11.25 flex items-center overflow-hidden z-10"
        style={{
          background: "rgba(255,255,255,0.8)",
          backdropFilter: "blur(10px)",
          borderTop: "1px solid rgba(61,45,19,0.08)",
          boxShadow: "0 -4px 20px rgba(0,0,0,0.03)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: isBooting ? 0 : 1 }}
        transition={{ delay: 0.6 }}
      >
        <DonorMarquee blocks={blocks} />
      </motion.div>

      <AnimatePresence>
        {popupQueue.length > 0 && (
          <motion.div
            className="fixed bottom-[80px] right-6 z-[99] p-4 rounded-xl flex flex-col pointer-events-none"
            style={{
              background: "linear-gradient(145deg, rgba(35,18,10,0.95), rgba(53,27,13,0.92) 52%, rgba(67,34,15,0.9))",
              border: "1px solid rgba(228,180,121,0.4)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
              minWidth: "220px",
            }}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
          >
            <h3 className="text-sm font-bold tracking-wider uppercase mb-2 flex items-center justify-between" style={{ color: "#c96b1b", fontFamily: '"Playfair Display", serif' }}>
              <span>Upcoming Names</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-sans" style={{ background: "rgba(201,107,27,0.2)", color: "#fff5e7" }}>
                {popupQueue.length}
              </span>
            </h3>
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
              {popupQueue.slice(0, 10).map((qDonor, idx) => (
                <div key={idx} className="text-sm truncate" style={{ color: "#fff5e7" }}>
                  <span className="opacity-70 mr-2 text-xs">{idx + 1}.</span>
                  {qDonor.name}
                </div>
              ))}
              {popupQueue.length > 10 && (
                <div className="text-xs italic opacity-60 mt-1 text-center" style={{ color: "#fff5e7" }}>
                  + {popupQueue.length - 10} more
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Donor popup overlay */}
      <AnimatePresence>
        {activePopups.map((popup) => (
          <DonorPopup
            key={popup.id}
            donor={popup.donor}
            position={popup.position}
          />
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {focusedBlock && (
          <motion.div
            className="fixed inset-0 z-80 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden"
            style={{
              background: "rgba(245,240,232,0.97)",
              backdropFilter: "blur(18px)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full flex-1 flex flex-col items-center justify-start px-4 py-5 sm:px-6 lg:p-8"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
            >
              <div className="w-[min(92vw,72vh,820px)] h-11 mb-3">
                <div
                  className="h-full rounded-lg px-3 py-2 flex items-center justify-between"
                  style={{
                    visibility: focusTargetName ? "visible" : "hidden",
                    background:
                      "linear-gradient(145deg, rgba(35,18,10,0.95), rgba(53,27,13,0.92) 52%, rgba(67,34,15,0.9))",
                    border: "1px solid rgba(255,218,159,0.45)",
                  }}
                >
                  <span
                    className="text-sm font-semibold"
                    style={{ color: "#fff1df" }}
                  >
                    {focusTargetName ? `In Focus : ${focusTargetName}` : " "}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFocusTargetName(null)}
                    className="px-2 py-1 rounded-md text-xs font-semibold"
                    style={{
                      background: "rgba(35,20,12,0.55)",
                      border: "1px solid rgba(228,180,121,0.26)",
                      color: "#ffe9cc",
                    }}
                  >
                    Zoom out
                  </button>
                </div>
              </div>

              <div
                ref={focusPreviewRef}
                className="relative rounded-2xl overflow-hidden bg-white"
                style={{
                  width: "min(92vw,72vh,820px)",
                  aspectRatio: "1",
                  border: "1px solid rgba(61,45,19,0.08)",
                  boxShadow: "0 30px 80px rgba(0,0,0,0.1)",
                  transformOrigin: "center center",
                  willChange: "transform",
                }}
              >
                <div
                  ref={focusBaseRef}
                  className="focus-stencil"
                  style={{
                    filter: "grayscale(1) contrast(1.15) brightness(1.08)",
                  }}
                />
                <div
                  ref={focusColorRef}
                  className="focus-stencil focus-stencil-color"
                  style={{
                    filter: "saturate(1.5) contrast(1.1) brightness(1.05)",
                  }}
                />
                {focusLoading && (
                  <div
                    className="absolute inset-0 flex items-center justify-center z-20"
                    style={{
                      background: "rgba(24,14,9,0.35)",
                      backdropFilter: "blur(2px)",
                    }}
                  >
                    <span
                      className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-[#f6d8af] border-r-transparent"
                      aria-hidden="true"
                    />
                  </div>
                )}
              </div>
            </motion.div>

            <motion.div
              className="w-full lg:w-105 flex flex-col gap-4 overflow-y-auto p-4 sm:p-5 lg:p-6"
              style={{
                background:
                  "linear-gradient(145deg, #23120a, #351b0d 52%, #43220f)",
                borderLeft: "1px solid rgba(211,156,93,0.26)",
                boxShadow: "-8px 0 28px rgba(0,0,0,0.28)",
              }}
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
            >
              <h2
                className="text-xl font-bold flex items-center gap-3"
                style={{ color: "#fff5e7" }}
              >
                Block {focusedBlock}
                <span
                  className="text-xs px-2.5 py-1 rounded-full font-normal"
                  style={{
                    background: "rgba(244,203,153,0.12)",
                    border: "1px solid rgba(244,203,153,0.26)",
                    color: "#ffe9cc",
                  }}
                >
                  Names
                </span>
              </h2>

              <input
                value={focusSearchQuery}
                onChange={(e) => setFocusSearchQuery(e.target.value)}
                placeholder="Search names in this block"
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  background: "rgba(255,250,244,0.96)",
                  border: "1px solid rgba(222,182,131,0.36)",
                  color: "#2a1509",
                }}
              />

              <div
                className="rounded-xl overflow-hidden"
                style={{
                  border: "1px solid rgba(228,180,121,0.2)",
                  background: "rgba(255,246,233,0.08)",
                }}
              >
                {filteredFocusNames.length === 0 ? (
                  <p
                    className="p-4 text-sm"
                    style={{ color: "rgba(245,232,216,0.82)" }}
                  >
                    No names found for this block.
                  </p>
                ) : (
                  <div
                    ref={focusNameListRef}
                    className="max-h-[56vh] overflow-y-auto divide-y"
                    style={{ borderColor: "rgba(228,180,121,0.12)" }}
                  >
                    {filteredFocusNames.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        data-entry-name={entry.name}
                        onClick={() => handleFocusNameClick(entry.name)}
                        className="w-full px-3 py-2.5 flex items-center justify-between gap-3 text-left"
                        style={{
                          background:
                            focusTargetName?.trim().toLowerCase() ===
                            entry.name.trim().toLowerCase()
                              ? "rgba(201,107,27,0.16)"
                              : "transparent",
                        }}
                      >
                        <div>
                          <p
                            className="text-sm font-semibold"
                            style={{ color: "#fff5e7" }}
                          >
                            {entry.name}
                          </p>
                          <p
                            className="text-[11px]"
                            style={{ color: "rgba(245,232,216,0.72)" }}
                          >
                            {entry.created_at || entry.createdAt || ""}
                          </p>
                        </div>
                        <span
                          className="text-xs px-2 py-1 rounded-full font-semibold"
                          style={{
                            background: "rgba(244,203,153,0.12)",
                            border: "1px solid rgba(244,203,153,0.26)",
                            color: "#ffe9cc",
                          }}
                        >
                          Qty {entry.qty}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={closeBlock}
                className="w-full py-2.5 rounded-lg text-sm font-bold text-white"
                style={{
                  background: "linear-gradient(135deg, #c96b1b, #e0b860)",
                }}
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Simple marquee component
function DonorMarquee({ blocks }: { blocks: Map<string, BlockData> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const donorTotals = new Map<string, number>();

  blocks.forEach((b) => {
    b.names.forEach((n) => {
      const dateStr = n.created_at || n.createdAt;
      if (!dateStr) return;
      
      const d = new Date(dateStr);
      const today = new Date();
      if (
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
      ) {
        const current = donorTotals.get(n.name) || 0;
        donorTotals.set(n.name, current + (n.qty || 0));
      }
    });
  });

  const allDonors = Array.from(donorTotals.entries());

  useEffect(() => {
    const checkWidth = () => {
      if (containerRef.current) {
        const firstChild = containerRef.current.firstElementChild as HTMLElement;
        const wrapper = containerRef.current.parentElement;
        if (firstChild && wrapper) {
          setShouldAnimate(firstChild.scrollWidth > wrapper.clientWidth);
        }
      }
    };

    checkWidth();
    const initTimer = setTimeout(checkWidth, 150);

    let resizeTimer: number;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(checkWidth, 100);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      clearTimeout(initTimer);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", handleResize);
    };
  }, [allDonors.length]);

  const duration = Math.max(20, allDonors.length * 5);
  const items = allDonors.map(([name, qty], i) => (
    <span
      key={i}
      className="inline-flex items-center px-10 text-2xl"
      style={{
        fontFamily: '"Cookie", cursive',
        color: "#21170d",
        whiteSpace: "nowrap",
      }}
    >
      <span className="mr-3 text-base" style={{ color: "#c96b1b" }}>
        🪷
      </span>
      {name} (₹{formatINR(qty * COST_PER_NAME)})
    </span>
  ));

  return (
    <>
      <div 
        className="shrink-0 h-full flex items-center px-6 font-bold uppercase tracking-wider text-xs z-20 relative"
        style={{
          background: "linear-gradient(to right, rgba(255,255,255,1), rgba(255,255,255,0.85))",
          color: "#8d785f",
          borderRight: "1px solid rgba(61,45,19,0.08)",
          boxShadow: "4px 0 20px rgba(0,0,0,0.05)",
          fontFamily: '"Cinzel", Georgia, serif',
        }}
      >
        Today's Donor List
      </div>
      <div className="flex-1 overflow-hidden h-full flex items-center relative">
        <div
          ref={containerRef}
          className={`flex whitespace-nowrap ${shouldAnimate ? "" : "w-full justify-center"}`}
          style={{ animation: shouldAnimate ? `marquee ${duration}s linear infinite` : "none" }}
        >
          <div className="flex whitespace-nowrap">{items}</div>
          {shouldAnimate && items.length > 0 && <div className="flex whitespace-nowrap">{items}</div>}
        </div>
      </div>
    </>
  );
}
