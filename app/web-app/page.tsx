"use client";

import React, {
  startTransition,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { MosaicGrid } from "@/components/mosaic/MosaicGrid";
import { LoadingScreen } from "@/components/shared/LoadingScreen";
import { useBlockData } from "@/hooks/useBlockData";
import {
  formatINR,
  COST_PER_NAME,
  NAMES_PER_BLOCK,
  GRID_SIZE,
  baseText,
  generateNameList,
  escapeHtml,
  SEPARATOR,
  backgroundPosition,
  parseBlockId,
  type BlockData,
} from "@/lib/mosaic/engine";
import { binaryFitFontSize } from "@/lib/mosaic/font-fitter";

const COUNTRY_CODES = [
  ["India", "+91"],
  ["USA", "+1"],
  ["UK", "+44"],
  ["Australia", "+61"],
  ["Canada", "+1"],
  ["Germany", "+49"],
  ["Singapore", "+65"],
  ["UAE", "+971"],
  ["Bangladesh", "+880"],
  ["Nepal", "+977"],
  ["Sri Lanka", "+94"],
];

type SearchItem = {
  kind: "name" | "phone" | "serial";
  label: string;
  block_id: string;
  qty?: number;
  created_at?: string;
  subtitle?: string;
  serial_number?: string;
};

type DonationReceipt = {
  serial_number: string;
  block_id: string;
  name: string;
  qty: number;
  amount: number;
  created_at: string;
  email?: string;
  phone?: string;
  pledge_due_days?: number;
  pledge_due_date?: string;
};

type DonationResponse = BlockData & {
  receipt?: DonationReceipt;
};

type BlockCapacity = { id: string; remaining: number };

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

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

function isSimilarName(name: string, query: string): boolean {
  const n = normalizeName(name);
  const q = normalizeName(query);
  if (!q) return true;
  if (n.includes(q) || q.includes(n)) return true;
  const nameTokens = n.split(" ");
  const queryTokens = q.split(" ");
  if (
    queryTokens.some((token) =>
      nameTokens.some((nToken) => nToken.includes(token)),
    )
  )
    return true;
  const compactN = n.replace(/\s/g, "");
  const compactQ = q.replace(/\s/g, "");
  const distance = levenshteinDistance(compactN, compactQ);
  const threshold = compactQ.length <= 5 ? 1 : compactQ.length <= 9 ? 2 : 3;
  return distance <= threshold;
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

export default function WebAppPage() {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const checkMobile = () => {
      const isSmall = window.matchMedia("(max-width: 1024px)").matches;
      setIsMobile(isSmall);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const router = useRouter();
  const {
    blocks,
    loading,
    fetchBlock,
    submitDonation,
    submitPledge,
    deleteName,
  } = useBlockData();
  const blocksRef = useRef(blocks);
  const [wallReady, setWallReady] = useState(false);
  const [isColorMode, setIsColorMode] = useState(false);
  const [focusedBlock, setFocusedBlock] = useState<string | null>(null);
  const [focusData, setFocusData] = useState<BlockData | null>(null);
  const [hoverTooltip, setHoverTooltip] = useState<{
    id: string;
    used: number;
    remaining: number;
    entries: number;
    x: number;
    y: number;
  } | null>(null);
  const tooltipRafRef = useRef<number | null>(null);
  const tooltipLastRef = useRef<{
    id: string;
    x: number;
    y: number;
    t: number;
  } | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formQtyInput, setFormQtyInput] = useState("1");
  const [formDob, setFormDob] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhoneCode, setFormPhoneCode] = useState("+91");
  const [formPhone, setFormPhone] = useState("");
  const [formWaCode, setFormWaCode] = useState("+91");
  const [formWa, setFormWa] = useState("");
  const [formSamePhone, setFormSamePhone] = useState(false);
  const [formStatus, setFormStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [searchMeta, setSearchMeta] = useState(
    "Search by name, mobile number, or serial number.",
  );
  const [showGuide, setShowGuide] = useState(false);
  const [focusTab, setFocusTab] = useState<"donor" | "names">("donor");
  const [focusFilterQuery, setFocusFilterQuery] = useState("");
  const [focusTargetName, setFocusTargetName] = useState<string | null>(null);
  const [focusZoomKey, setFocusZoomKey] = useState(0);
  const [focusSearchQuery, setFocusSearchQuery] = useState("");
  const [latestReceipt, setLatestReceipt] = useState<DonationReceipt | null>(
    null,
  );
  const [showThankYou, setShowThankYou] = useState(false);
  const [focusLoading, setFocusLoading] = useState(false);
  const [showPledgeModal, setShowPledgeModal] = useState(false);
  const [pledgeDays, setPledgeDays] = useState<number | null>(null);

  // Focus view refs
  const focusBaseRef = useRef<HTMLDivElement>(null);
  const focusColorRef = useRef<HTMLDivElement>(null);
  const focusPreviewRef = useRef<HTMLDivElement>(null);
  const focusNameListRef = useRef<HTMLDivElement>(null);

  const filteredFocusNames = useMemo(() => {
    if (!focusData) return [];
    const query = focusFilterQuery.trim();
    if (!query) return focusData.names;
    return focusData.names.filter((entry) => isSimilarName(entry.name, query));
  }, [focusData, focusFilterQuery]);

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(() => {
    return () => {
      if (tooltipRafRef.current !== null)
        cancelAnimationFrame(tooltipRafRef.current);
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

  const openBlock = useCallback(
    async (id: string, targetName?: string) => {
      setHoverTooltip(null);
      setFocusLoading(true);
      setFocusedBlock(id);
      setFocusData(blocksRef.current.get(id) ?? null);
      try {
        const data = await fetchBlock(id);
        setFocusData(data);
        if (targetName?.trim()) {
          const query = targetName.trim();
          setFocusTab("names");
          setFocusSearchQuery(query);
          setFocusFilterQuery(query);
          setFocusTargetName(query);
          setFocusZoomKey((prev) => prev + 1);
        } else {
          setFocusTab("donor");
          setFocusSearchQuery("");
          setFocusFilterQuery("");
          setFocusTargetName(null);
        }
      } catch {
        setFormStatus("Unable to load this block right now.");
      } finally {
        setFocusLoading(false);
      }
    },
    [fetchBlock],
  );

  const closeBlock = useCallback(() => {
    setFocusedBlock(null);
    setFocusData(null);
    setFormStatus("");
    setFocusTab("donor");
    setSearchSubmitted(false);
    setSearchQuery("");
    setSearchResults([]);
    setSearchMeta("Search by name, mobile number, or serial number.");
    setFormName("");
    setFormQtyInput("1");
    setFormDob("");
    setFormEmail("");
    setFormPhone("");
    setFormWa("");
    setFormSamePhone(false);
    setFocusSearchQuery("");
    setFocusFilterQuery("");
    setFocusTargetName(null);
    setShowThankYou(false);
  }, []);

  // Fit text in focus view
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
      if (markup) {
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
            const minTy =
              containerRect.height - containerRect.height * zoomScale;
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
      } else {
        focusColorRef.current.innerHTML = "";
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

  const parsedFormQty = parseInt(formQtyInput, 10);
  const totalAmount =
    (Number.isFinite(parsedFormQty) ? Math.max(0, parsedFormQty) : 0) *
    COST_PER_NAME;
  const isBooting = loading || !wallReady;

  const queueTooltipUpdate = useCallback(
    (id: string, clientX: number, clientY: number, refreshStats = false) => {
      if (
        typeof window !== "undefined" &&
        window.matchMedia &&
        !window.matchMedia("(hover: hover) and (pointer: fine)").matches
      ) {
        return;
      }

      const now = performance.now();
      const last = tooltipLastRef.current;
      if (
        !refreshStats &&
        last &&
        last.id === id &&
        now - last.t < 50 &&
        Math.abs(last.x - clientX) < 8 &&
        Math.abs(last.y - clientY) < 8
      ) {
        return;
      }
      tooltipLastRef.current = { id, x: clientX, y: clientY, t: now };

      if (tooltipRafRef.current !== null)
        cancelAnimationFrame(tooltipRafRef.current);
      tooltipRafRef.current = requestAnimationFrame(() => {
        const x = Math.min(window.innerWidth - 16, clientX + 16);
        const y = Math.min(window.innerHeight - 16, clientY + 16);
        setHoverTooltip((prev) => {
          if (!refreshStats && prev && prev.id === id) {
            return { ...prev, x, y };
          }

          const block = blocksRef.current.get(id);
          const used = block?.total_used ?? 0;
          const remaining =
            block?.remaining ?? Math.max(0, NAMES_PER_BLOCK - used);
          const entries = block?.names.length ?? 0;
          return {
            id,
            used,
            remaining,
            entries,
            x,
            y,
          };
        });
      });
    },
    [],
  );

  const handleBlockHoverStart = useCallback(
    (id: string, event: ReactMouseEvent<HTMLDivElement>) => {
      queueTooltipUpdate(id, event.clientX, event.clientY, true);
    },
    [queueTooltipUpdate],
  );

  const handleBlockHoverMove = useCallback(
    (id: string, event: ReactMouseEvent<HTMLDivElement>) => {
      queueTooltipUpdate(id, event.clientX, event.clientY);
    },
    [queueTooltipUpdate],
  );

  const handleBlockHoverEnd = useCallback(() => {
    if (tooltipRafRef.current !== null)
      cancelAnimationFrame(tooltipRafRef.current);
    tooltipLastRef.current = null;
    setHoverTooltip(null);
  }, []);

  const handlePhoneChange = useCallback(
    (value: string) => {
      setFormPhone(value);
      if (formSamePhone) setFormWa(value);
    },
    [formSamePhone],
  );

  const handlePhoneCodeChange = useCallback(
    (value: string) => {
      setFormPhoneCode(value);
      if (formSamePhone) setFormWaCode(value);
    },
    [formSamePhone],
  );

  const handleSamePhoneChange = useCallback(
    (checked: boolean) => {
      setFormSamePhone(checked);
      if (checked) {
        setFormWa(formPhone);
        setFormWaCode(formPhoneCode);
      }
    },
    [formPhone, formPhoneCode],
  );

  const goToDonorTab = useCallback(() => {
    setFocusTab("donor");
    setFocusSearchQuery("");
    setFocusFilterQuery("");
    setFocusTargetName(null);
    setFocusZoomKey((prev) => prev + 1);
  }, []);

  const fetchCapacities = useCallback(async (): Promise<BlockCapacity[]> => {
    const res = await fetch("/api/blocks");
    const data = (await res.json()) as Record<string, { total_qty: number }>;
    const capacities: BlockCapacity[] = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const id = String.fromCharCode(65 + c) + (r + 1);
        const used = data[id]?.total_qty ?? 0;
        const remaining = Math.max(0, NAMES_PER_BLOCK - used);
        if (remaining > 0) capacities.push({ id, remaining });
      }
    }
    return capacities;
  }, []);

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

  async function handleDonorSubmit(
    actionType: "donate" | "pledge",
    selectedPledgeDays?: number,
  ) {
    if (!focusedBlock) return;
    const qtyNumber = parseInt(formQtyInput, 10);
    const donorName = formName.trim();
    if (!formName.trim()) {
      setFormStatus("Please enter a name.");
      return;
    }
    if (!Number.isFinite(qtyNumber) || qtyNumber < 1) {
      setFormStatus("Invalid quantity.");
      return;
    }
    if (!formPhone.trim()) {
      setFormStatus("Phone required.");
      return;
    }
    const wa = formSamePhone ? formPhone : formWa;
    if (!wa.trim()) {
      setFormStatus("WhatsApp required.");
      return;
    }
    if (actionType === "pledge" && !selectedPledgeDays) {
      setFormStatus("Please select pledge days.");
      return;
    }

    setSubmitting(true);
    setFormStatus("");
    try {
      const payloadBase: Record<string, unknown> = {
        name: donorName,
        date_of_birth: formDob,
        email: formEmail.trim(),
        phone: `${formPhoneCode} ${formPhone.trim()}`,
        whatsapp: `${formSamePhone ? formPhoneCode : formWaCode} ${wa.trim()}`,
      };
      const sharedSerial = buildSharedSerial(actionType, focusedBlock);
      payloadBase.receipt_serial = sharedSerial;
      if (actionType === "pledge")
        payloadBase.pledge_due_days = selectedPledgeDays;

      const capacities = await fetchCapacities();
      const plan = buildAllocationPlan(capacities, qtyNumber, focusedBlock);

      let data: DonationResponse | null = null;
      let firstReceipt: DonationReceipt | null = null;
      const allocationReceipts: AllocationReceipt[] = [];
      for (const alloc of plan) {
        const response = (
          actionType === "pledge"
            ? await submitPledge(alloc.id, { ...payloadBase, qty: alloc.qty })
            : await submitDonation(alloc.id, {
                ...payloadBase,
                qty: alloc.qty,
              })
        ) as DonationResponse;
        if (!data || alloc.id === focusedBlock) data = response;
        if (!firstReceipt && response.receipt) firstReceipt = response.receipt;
        allocationReceipts.push({
          block_id: alloc.id,
          qty: alloc.qty,
          amount: alloc.qty * COST_PER_NAME,
          serial_number: response.receipt?.serial_number,
        });
      }

      if (!data) {
        throw new Error("Unable to complete allocation.");
      }

      const receiptPayload: WebReceiptPayload = {
        trust_name: "KIRTAN SEVA TRUST",
        serial_number: sharedSerial,
        action_type: actionType,
        donor_name: donorName,
        qty: qtyNumber,
        total_amount: qtyNumber * COST_PER_NAME,
        phone: `${formPhoneCode} ${formPhone.trim()}`,
        whatsapp: `${formSamePhone ? formPhoneCode : formWaCode} ${wa.trim()}`,
        email: formEmail.trim() || undefined,
        pledge_due_days:
          actionType === "pledge" ? firstReceipt?.pledge_due_days : undefined,
        pledge_due_date:
          actionType === "pledge" ? firstReceipt?.pledge_due_date : undefined,
        created_at: firstReceipt?.created_at ?? new Date().toISOString(),
        allocations: allocationReceipts,
      };
      try {
        sessionStorage.setItem(
          "kirtan-web-receipt",
          JSON.stringify(receiptPayload),
        );
      } catch {
        setFormStatus("Submission processed, but receipt page is unavailable.");
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      setShowPledgeModal(false);
      router.push("/web-app/receipt");
      return;
    } catch (e: unknown) {
      setFormStatus((e as Error).message || "Error. Please try again.");
    }
    setSubmitting(false);
  }

  async function handleDonate() {
    await handleDonorSubmit("donate");
  }

  const downloadReceipt = useCallback(() => {
    if (!latestReceipt) return;
    const lines = [
      "Kirtan Seva Trust — Wall of Legacy",
      "",
      `Serial Number: ${latestReceipt.serial_number}`,
      `Donor Name: ${latestReceipt.name}`,
      `Block: ${latestReceipt.block_id}`,
      `Quantity: ${latestReceipt.qty}`,
      `Amount: INR ${formatINR(latestReceipt.amount)}`,
      `Date: ${new Date(latestReceipt.created_at).toLocaleString("en-IN")}`,
      latestReceipt.email ? `Email: ${latestReceipt.email}` : "",
      latestReceipt.phone ? `Phone: ${latestReceipt.phone}` : "",
      "",
      "Thank you for preserving this spiritual legacy.",
    ].filter(Boolean);

    const blob = new Blob([lines.join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${latestReceipt.serial_number}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [latestReceipt]);

  async function handleDelete(nameId: number) {
    if (!focusedBlock) return;
    setFocusLoading(true);
    try {
      const data = await deleteName(focusedBlock, nameId);
      startTransition(() => {
        setFocusData(data);
      });
    } catch {
      setFormStatus("Failed to delete name.");
    } finally {
      setFocusLoading(false);
    }
  }

  const clearFocusNameSearch = useCallback(() => {
    setFocusSearchQuery("");
    setFocusTargetName(null);
    setFocusZoomKey((prev) => prev + 1);
  }, []);

  const applyFocusNameSearch = useCallback(() => {
    const query = focusSearchQuery.trim();
    setFocusFilterQuery(query);
    setFocusTargetName(query || null);
    setFocusZoomKey((prev) => prev + 1);
  }, [focusSearchQuery]);

  const runSearch = useCallback(async () => {
    const query = searchQuery.trim();
    setSearchSubmitted(true);
    if (query.length < 2) {
      setSearchResults([]);
      setSearchMeta("Type at least 2 characters to search your inscription.");
      return;
    }

    setSearchLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = (await res.json()) as {
        query: string;
        results: SearchItem[];
      };
      const results = Array.isArray(data.results) ? data.results : [];
      setSearchResults(results);
      setSearchMeta(
        results.length
          ? `Found ${results.length} result${results.length > 1 ? "s" : ""}.`
          : "No results found.",
      );
    } catch {
      setSearchResults([]);
      setSearchMeta("Search is temporarily unavailable. Please try again.");
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery]);

  // Stats
  let totalNames = 0;
  blocks.forEach((b) => {
    totalNames += b.total_used;
  });

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
      className="min-h-screen w-full overflow-x-hidden overflow-y-auto relative flex flex-col lg:h-screen lg:w-screen lg:overflow-hidden lg:flex-row"
      style={{ background: "#f2ece2" }}
    >
      <LoadingScreen visible={isBooting} />

      {/* Info Panel (left 33%) */}
      <motion.div
        className="w-full flex flex-col justify-center gap-5 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 lg:w-1/3 lg:px-8 lg:py-6"
        style={{
          background:
            "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.97) 46%, rgba(68,34,14,0.96))",
          borderRight: "1px solid rgba(120,80,40,0.16)",
          boxShadow: "inset -18px 0 40px rgba(10,6,4,0.36)",
        }}
        initial={{ x: -50, opacity: 0 }}
        animate={{ x: isBooting ? -50 : 0, opacity: isBooting ? 0 : 1 }}
        transition={{ delay: 0.2, duration: 0.6 }}
      >
        <div>
          <p
            className="text-sm font-semibold tracking-[0.15em]"
            style={{
              fontFamily: '"Dancing Script", cursive',
              color: "rgba(255,244,232,0.96)",
              fontSize: "1.1rem",
            }}
          >
            Srila Bhaktivinoda Thakur&apos;s
          </p>
          <h1
            className="text-4xl font-black"
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
              className="text-sm font-semibold tracking-[0.2em] uppercase"
              style={{ color: "rgba(246,232,214,0.9)" }}
            >
              3-Month Campaign 2026
            </span>
          </div>
        </div>

        {/* Search */}
        <div
          className="p-5 rounded-2xl"
          style={{
            background:
              "linear-gradient(180deg, rgba(38,20,10,0.9), rgba(48,24,12,0.78))",
            border: "1px solid rgba(170,120,75,0.14)",
            boxShadow: "0 18px 40px rgba(10,6,4,0.36)",
          }}
        >
          <h3
            className="text-lg font-bold mb-2"
            style={{
              fontFamily: '"Playfair Display", serif',
              color: "#fff1df",
            }}
          >
            Find Your Inscription
          </h3>
          <p
            className="text-sm mb-3"
            style={{ color: "rgba(245,232,216,0.9)" }}
          >
            Search by devotee name, mobile number, or serial number to locate
            your block instantly.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={searchQuery}
              onChange={(e) => {
                const value = e.target.value;
                setSearchQuery(value);
                setSearchSubmitted(false);
                if (!value.trim()) {
                  setSearchResults([]);
                  setSearchMeta(
                    "Search by name, mobile number, or serial number.",
                  );
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch();
              }}
              placeholder="e.g. Jayapataka Swami · +91 987... · DON-A1-000123"
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
                setSearchResults([]);
                setSearchSubmitted(false);
                setSearchMeta(
                  "Search by name, mobile number, or serial number.",
                );
              }}
              className="w-full sm:w-auto px-3 py-2 rounded-lg text-sm font-semibold"
              style={{
                background: "rgba(255,246,233,0.1)",
                border: "1px solid rgba(228,180,121,0.26)",
                color: "#ffe9cc",
              }}
            >
              Clear
            </button>
          </div>
          <p
            className="text-xs mt-2"
            style={{ color: "rgba(245,232,216,0.78)" }}
          >
            {searchMeta}
          </p>

          {searchResults.length > 0 && (
            <div className="mt-3 max-h-[180px] overflow-y-auto space-y-2 pr-1">
              {searchResults.map((result, index) => (
                <button
                  key={`${result.kind}-${result.block_id}-${result.label}-${result.serial_number ?? index}`}
                  type="button"
                  onClick={() => void openBlock(result.block_id, result.label)}
                  className="w-full text-left px-3 py-2 rounded-lg"
                  style={{
                    background: "rgba(255,246,233,0.08)",
                    border: "1px solid rgba(228,180,121,0.2)",
                  }}
                >
                  <div
                    className="text-sm font-semibold"
                    style={{ color: "#fff5e7" }}
                  >
                    {result.label}
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: "rgba(245,232,216,0.84)" }}
                  >
                    Block {result.block_id}
                    {result.serial_number ? ` · ${result.serial_number}` : ""}
                    {result.subtitle ? ` · ${result.subtitle}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!searchLoading && searchSubmitted && searchResults.length === 0 && (
            <div
              className="mt-3 rounded-lg px-3 py-2 text-sm"
              style={{
                background: "rgba(255,246,233,0.08)",
                border: "1px solid rgba(228,180,121,0.2)",
                color: "#ffe9cc",
              }}
            >
              No results found.
            </div>
          )}
        </div>

        {/* Inscribe CTA + Accordion */}
        <div
          className="p-5 rounded-2xl"
          style={{
            background:
              "linear-gradient(180deg, rgba(38,20,10,0.9), rgba(48,24,12,0.78))",
            border: "1px solid rgba(170,120,75,0.14)",
            boxShadow: "0 18px 40px rgba(10,6,4,0.36)",
          }}
        >
          <h3
            className="text-lg font-bold"
            style={{
              fontFamily: '"Playfair Display", serif',
              color: "#fff1df",
            }}
          >
            Haven’t Inscribed Yet?
          </h3>
          <p
            className="text-sm mt-2"
            style={{ color: "rgba(245,232,216,0.9)" }}
          >
            Do it before the blocks get filled out. Don’t miss this amazing
            opportunity to inscribe your own name and your family’s names.
          </p>
          <button
            type="button"
            onClick={() => setShowGuide((prev) => !prev)}
            className="mt-3 px-4 py-2 rounded-lg text-sm font-bold"
            style={{
              background: "linear-gradient(135deg, #c96b1b, #e0b860)",
              color: "#fff",
            }}
          >
            {showGuide ? "Hide steps" : "Inscribe now"}
          </button>

          <AnimatePresence initial={false}>
            {showGuide && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: "auto", marginTop: 14 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="overflow-hidden"
              >
                {[
                  "Hover on a block to see its details and current inscriptions.",
                  "Choose a block and dedicate it for yourself or your family.",
                  "Enter details once, then inscribe one or many names together.",
                  "Complete your donation to secure the inscription instantly.",
                ].map((step, i) => (
                  <div key={i} className="flex gap-3 items-start mb-3">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                      style={{
                        background: "linear-gradient(135deg, #5b2d12, #a86b2a)",
                      }}
                    >
                      {i + 1}
                    </div>
                    <span
                      className="text-sm leading-relaxed"
                      style={{ color: "rgba(245,232,216,0.9)" }}
                    >
                      {step}
                    </span>
                  </div>
                ))}
                <p
                  className="text-xs"
                  style={{ color: "rgba(245,232,216,0.8)" }}
                >
                  Every inscription helps preserve this spiritual legacy for
                  future generations.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Complete Pledge */}
        <div
          className="p-5 rounded-2xl"
          style={{
            background:
              "linear-gradient(180deg, rgba(38,20,10,0.9), rgba(48,24,12,0.78))",
            border: "1px solid rgba(170,120,75,0.14)",
            boxShadow: "0 18px 40px rgba(10,6,4,0.36)",
          }}
        >
          <h3
            className="text-lg font-bold"
            style={{
              fontFamily: '"Playfair Display", serif',
              color: "#fff1df",
            }}
          >
            Already taken a pledge to donate?
          </h3>
          <p
            className="text-sm mt-2 mb-3"
            style={{ color: "rgba(245,232,216,0.9)" }}
          >
            Complete your pledge donation and secure the inscription for your
            chosen devotee name.
          </p>
          <button
            type="button"
            onClick={() => router.push("/complete-pledge")}
            className="px-4 py-2 rounded-lg text-sm font-bold"
            style={{
              background: "linear-gradient(135deg, #c96b1b, #e0b860)",
              color: "#fff",
            }}
          >
            Complete Now
          </button>
        </div>

        {/* Stats */}
        <div
          className="p-4 rounded-2xl"
          style={{
            background:
              "linear-gradient(135deg, rgba(201,107,27,0.08), rgba(224,184,96,0.1))",
            border: "1px solid rgba(201,107,27,0.14)",
          }}
        >
          <div className="flex justify-between items-baseline mb-1">
            <span
              className="text-xs font-bold tracking-wider uppercase"
              style={{ color: "#8d785f" }}
            >
              Names Inscribed
            </span>
            <span
              className="text-xl font-bold"
              style={{
                background: "linear-gradient(135deg, #c96b1b, #d7ad57)",
                WebkitBackgroundClip: "text",
                color: "transparent",
              }}
            >
              {formatINR(totalNames)}
            </span>
          </div>
          <div
            className="w-full h-3 rounded-full overflow-hidden mt-2"
            style={{
              background: "rgba(61,45,19,0.12)",
              border: "1px solid rgba(201,107,27,0.14)",
            }}
          >
            <motion.div
              className="h-full rounded-full"
              style={{
                background: "linear-gradient(to right, #c96b1b, #d7ad57)",
              }}
              animate={{
                width: `${Math.min(100, (totalNames / (NAMES_PER_BLOCK * GRID_SIZE * GRID_SIZE)) * 100)}%`,
              }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        </div>
      </motion.div>

      {/* Mosaic area (right 67%) */}
      <motion.div
        className="w-full flex-1 flex items-center justify-center relative p-4 pb-16 sm:p-5 sm:pb-16 lg:p-6 lg:pb-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: isBooting ? 0 : 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        <div
          style={{
            width: "min(92vw, 72vh, 840px)",
            height: "min(92vw, 72vh, 840px)",
          }}
        >
          <MosaicGrid
            blocks={blocks}
            isColorMode={isColorMode}
            selectedBlock={focusedBlock}
            onBlockClick={openBlock}
            onBlockHoverStart={handleBlockHoverStart}
            onBlockHoverMove={handleBlockHoverMove}
            onBlockHoverEnd={handleBlockHoverEnd}
            className="w-full h-full"
          />
        </div>

        {hoverTooltip && !focusedBlock && (
          <div
            className="fixed z-50 pointer-events-none px-3 py-2 rounded-lg"
            style={{
              left: hoverTooltip.x,
              top: hoverTooltip.y,
              transform: "translate(0, -100%)",
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
              Used {formatINR(hoverTooltip.used)} / {formatINR(NAMES_PER_BLOCK)}{" "}
              · Remaining {formatINR(hoverTooltip.remaining)} · Entries{" "}
              {hoverTooltip.entries}
            </div>
          </div>
        )}

        {/* Color toggle */}
        <button
          className="absolute top-3 right-3 sm:top-4 sm:right-4 flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-xs font-bold tracking-wide transition-all"
          style={{
            background: "rgba(255,255,255,0.85)",
            backdropFilter: "blur(14px)",
            border: "1px solid rgba(61,45,19,0.08)",
            color: "#21170d",
            boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
          }}
          onClick={() => setIsColorMode((v) => !v)}
        >
          Color
          <div
            className="w-[34px] h-[18px] rounded-full relative transition-colors"
            style={{
              background: isColorMode
                ? "linear-gradient(135deg, #c96b1b, #e0b860)"
                : "rgba(0,0,0,0.12)",
            }}
          >
            <motion.div
              className="w-[14px] h-[14px] rounded-full bg-white absolute top-[2px]"
              style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}
              animate={{ left: isColorMode ? 18 : 2 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          </div>
        </button>
      </motion.div>

      {/* Donor marquee (bottom) */}
      <motion.div
        className="hidden sm:flex absolute bottom-0 left-0 right-0 h-[45px] items-center overflow-hidden z-10"
        style={{
          background: "rgba(255,255,255,0.8)",
          backdropFilter: "blur(10px)",
          borderTop: "1px solid rgba(61,45,19,0.08)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: isBooting ? 0 : 1 }}
        transition={{ delay: 0.5 }}
      >
        <WebAppMarquee blocks={blocks} />
      </motion.div>

      {/* ── Focus Overlay ── */}
      <AnimatePresence>
        {focusedBlock && focusData && (
          <motion.div
            className="fixed inset-0 z-[100] flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden"
            style={{
              background: "rgba(245,240,232,0.97)",
              backdropFilter: "blur(28px)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Left: block preview */}
            <motion.div
              className="w-full flex-1 flex flex-col items-center justify-start px-4 py-4 sm:px-6 sm:py-5 lg:p-8 lg:pt-4"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
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

            {/* Right: sidebar */}
            <motion.div
              className="w-full lg:w-[400px] flex flex-col gap-4 overflow-y-auto p-4 sm:p-5 lg:p-6"
              style={{
                background:
                  "linear-gradient(145deg, #23120a, #351b0d 52%, #43220f)",
                borderLeft: "1px solid rgba(211,156,93,0.26)",
                boxShadow: "-8px 0 28px rgba(0,0,0,0.28)",
              }}
              initial={{ x: 50, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.25 }}
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
                  {formatINR(NAMES_PER_BLOCK)} slots
                </span>
              </h2>

              <div
                className="p-1 rounded-xl flex gap-1"
                style={{
                  background: "rgba(255,246,233,0.08)",
                  border: "1px solid rgba(228,180,121,0.2)",
                }}
              >
                <button
                  type="button"
                  onClick={goToDonorTab}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold"
                  style={{
                    background:
                      focusTab === "donor"
                        ? "linear-gradient(135deg, #c96b1b, #e0b860)"
                        : "transparent",
                    color: focusTab === "donor" ? "#fff" : "#ffe9cc",
                  }}
                >
                  New Donor
                </button>
                <button
                  type="button"
                  onClick={() => setFocusTab("names")}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold"
                  style={{
                    background:
                      focusTab === "names"
                        ? "linear-gradient(135deg, #c96b1b, #e0b860)"
                        : "transparent",
                    color: focusTab === "names" ? "#fff" : "#ffe9cc",
                  }}
                >
                  Names in this block
                </button>
              </div>

              <div className="flex gap-2">
                {[
                  { label: "Used", value: formatINR(focusData.total_used) },
                  { label: "Remaining", value: formatINR(focusData.remaining) },
                  { label: "Entries", value: String(focusData.names.length) },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="flex-1 text-center p-2 rounded-xl"
                    style={{
                      background: "rgba(255,246,233,0.08)",
                      border: "1px solid rgba(228,180,121,0.2)",
                    }}
                  >
                    <span
                      className="block text-[10px] font-bold tracking-wider uppercase"
                      style={{ color: "rgba(255,230,198,0.82)" }}
                    >
                      {s.label}
                    </span>
                    <span
                      className="block text-base font-bold mt-0.5"
                      style={{ color: "#fff5e7" }}
                    >
                      {s.value}
                    </span>
                  </div>
                ))}
              </div>

              {focusTab === "donor" && (
                <div
                  className="flex flex-col gap-3 p-4 rounded-2xl"
                  style={{
                    background: "rgba(255,246,233,0.07)",
                    border: "1px solid rgba(228,180,121,0.2)",
                  }}
                >
                  <div className="flex gap-2">
                    <div className="flex-1 flex flex-col gap-1">
                      <label
                        className="text-[10px] font-bold tracking-wider uppercase"
                        style={{ color: "rgba(255,230,198,0.85)" }}
                      >
                        Name
                      </label>
                      <input
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        maxLength={40}
                        placeholder="Name"
                        className="px-3 py-2 rounded-lg text-sm outline-none"
                        style={{
                          background: "rgba(255,250,244,0.96)",
                          border: "1px solid rgba(222,182,131,0.36)",
                          color: "#2a1509",
                        }}
                      />
                    </div>
                    <div className="w-16 flex flex-col gap-1">
                      <label
                        className="text-[10px] font-bold tracking-wider uppercase"
                        style={{ color: "rgba(255,230,198,0.85)" }}
                      >
                        Qty
                      </label>
                      <input
                        type="text"
                        value={formQtyInput}
                        min={1}
                        inputMode="numeric"
                        maxLength={4}
                        onChange={(e) =>
                          setFormQtyInput(e.target.value.replace(/\D/g, ""))
                        }
                        className="px-2 py-2 rounded-lg text-sm outline-none"
                        style={{
                          background: "rgba(255,250,244,0.96)",
                          border: "1px solid rgba(222,182,131,0.36)",
                          color: "#2a1509",
                        }}
                      />
                    </div>
                  </div>
                  <p
                    className="text-[11px]"
                    style={{ color: "rgba(245,232,216,0.72)" }}
                  >
                    Enter the name you want to inscribe and the quantity.
                  </p>

                  <div className="flex gap-2">
                    <select
                      value={formPhoneCode}
                      onChange={(e) => handlePhoneCodeChange(e.target.value)}
                      className="w-24 px-1 py-2 rounded-lg text-xs outline-none"
                      style={{
                        background: "rgba(255,250,244,0.96)",
                        border: "1px solid rgba(222,182,131,0.36)",
                        color: "#2a1509",
                      }}
                    >
                      {COUNTRY_CODES.map(([c, code]) => (
                        <option key={`p-${c}`} value={code}>
                          {c} ({code})
                        </option>
                      ))}
                    </select>
                    <input
                      type="tel"
                      value={formPhone}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      maxLength={20}
                      placeholder="Phone"
                      className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                      style={{
                        background: "rgba(255,250,244,0.96)",
                        border: "1px solid rgba(222,182,131,0.36)",
                        color: "#2a1509",
                      }}
                    />
                  </div>
                  <p
                    className="text-[11px]"
                    style={{ color: "rgba(245,232,216,0.72)" }}
                  >
                    Please provide your primary contact number.
                  </p>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formSamePhone}
                      onChange={(e) => handleSamePhoneChange(e.target.checked)}
                      className="w-3.5 h-3.5"
                    />
                    <span
                      className="text-xs font-semibold"
                      style={{ color: "#ffe9cc" }}
                    >
                      WhatsApp same as phone
                    </span>
                  </label>

                  {!formSamePhone && (
                    <>
                      <div className="flex gap-2">
                        <select
                          value={formWaCode}
                          onChange={(e) => setFormWaCode(e.target.value)}
                          className="w-24 px-1 py-2 rounded-lg text-xs outline-none"
                          style={{
                            background: "rgba(255,250,244,0.96)",
                            border: "1px solid rgba(222,182,131,0.36)",
                            color: "#2a1509",
                          }}
                        >
                          {COUNTRY_CODES.map(([c, code]) => (
                            <option key={`w-${c}`} value={code}>
                              {c} ({code})
                            </option>
                          ))}
                        </select>
                        <input
                          type="tel"
                          value={formWa}
                          onChange={(e) => setFormWa(e.target.value)}
                          maxLength={20}
                          placeholder="WhatsApp"
                          className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                          style={{
                            background: "rgba(255,250,244,0.96)",
                            border: "1px solid rgba(222,182,131,0.36)",
                            color: "#2a1509",
                          }}
                        />
                      </div>
                      <p
                        className="text-[11px]"
                        style={{ color: "rgba(245,232,216,0.72)" }}
                      >
                        Provide your WhatsApp number for receipt and further
                        communication.
                      </p>
                    </>
                  )}

                  {formSamePhone && (
                    <p
                      className="text-[11px]"
                      style={{ color: "rgba(245,232,216,0.72)" }}
                    >
                      WhatsApp will use your mobile number for receipt and
                      further communication.
                    </p>
                  )}

                  <input
                    type="date"
                    value={formDob}
                    onChange={(e) => setFormDob(e.target.value)}
                    placeholder="DOB"
                    className="px-3 py-2 rounded-lg text-sm outline-none"
                    style={{
                      background: "rgba(255,250,244,0.96)",
                      border: "1px solid rgba(222,182,131,0.36)",
                      color: "#2a1509",
                    }}
                  />
                  <p
                    className="text-[11px]"
                    style={{ color: "rgba(245,232,216,0.72)" }}
                  >
                    Date of birth is optional and helps us personalize donor
                    communication.
                  </p>

                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    maxLength={80}
                    placeholder="Email"
                    className="px-3 py-2 rounded-lg text-sm outline-none"
                    style={{
                      background: "rgba(255,250,244,0.96)",
                      border: "1px solid rgba(222,182,131,0.36)",
                      color: "#2a1509",
                    }}
                  />
                  <p
                    className="text-[11px]"
                    style={{ color: "rgba(245,232,216,0.72)" }}
                  >
                    Email is optional. Provide your email for further
                    communication.
                  </p>

                  <div
                    className="flex justify-between items-center px-3 py-2 rounded-lg"
                    style={{
                      background: "rgba(255,246,233,0.12)",
                      border: "1px solid rgba(228,180,121,0.24)",
                    }}
                  >
                    <span
                      className="text-[10px] font-bold tracking-wider uppercase"
                      style={{ color: "rgba(255,230,198,0.88)" }}
                    >
                      Total
                    </span>
                    <span
                      className="text-sm font-extrabold"
                      style={{ color: "#fff5e7" }}
                    >
                      ₹{formatINR(totalAmount)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className="w-full py-2.5 rounded-lg text-sm font-bold text-white"
                      style={{
                        background: "linear-gradient(135deg, #c96b1b, #e0b860)",
                        opacity: submitting ? 0.7 : 1,
                      }}
                      disabled={submitting}
                      onClick={handleDonate}
                    >
                      {submitting ? "Processing..." : "Donate Now"}
                    </button>

                    <button
                      className="w-full py-2.5 rounded-lg text-sm font-bold text-white"
                      style={{
                        background: "linear-gradient(135deg, #6b4326, #8f6138)",
                        opacity: submitting ? 0.7 : 1,
                      }}
                      disabled={submitting}
                      onClick={() => {
                        setPledgeDays(null);
                        setShowPledgeModal(true);
                      }}
                    >
                      Take a Pledge
                    </button>
                  </div>

                  {formStatus && (
                    <div
                      className="flex items-center gap-2 text-xs"
                      style={{ color: "#f6d8af" }}
                    >
                      <p>{formStatus}</p>
                    </div>
                  )}
                </div>
              )}

              {focusTab === "names" && (
                <>
                  <p
                    className="text-[10px] font-bold tracking-wider uppercase pb-1"
                    style={{
                      color: "rgba(255,230,198,0.82)",
                      borderBottom: "1px solid rgba(228,180,121,0.2)",
                    }}
                  >
                    Names in this block
                  </p>

                  <div
                    className="p-3 rounded-xl"
                    style={{
                      background: "rgba(255,246,233,0.07)",
                      border: "1px solid rgba(228,180,121,0.2)",
                    }}
                  >
                    <div className="flex gap-2">
                      <input
                        value={focusSearchQuery}
                        onChange={(e) => {
                          const value = e.target.value;
                          setFocusSearchQuery(value);
                          if (!value.trim()) {
                            setFocusFilterQuery("");
                            setFocusTargetName(null);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !focusFilterQuery.trim()) {
                            applyFocusNameSearch();
                          }
                        }}
                        placeholder="Search similar names in this block"
                        className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                        style={{
                          background: "rgba(255,250,244,0.96)",
                          border: "1px solid rgba(222,182,131,0.36)",
                          color: "#2a1509",
                        }}
                      />

                      {!focusFilterQuery.trim() ? (
                        <button
                          type="button"
                          onClick={applyFocusNameSearch}
                          className="px-3 py-2 rounded-lg text-sm font-bold"
                          style={{
                            background:
                              "linear-gradient(135deg, #c96b1b, #e0b860)",
                            color: "#fff",
                          }}
                        >
                          Search
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={clearFocusNameSearch}
                          className="px-3 py-2 rounded-lg text-sm font-semibold"
                          style={{
                            background: "rgba(255,246,233,0.1)",
                            border: "1px solid rgba(228,180,121,0.26)",
                            color: "#ffe9cc",
                          }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  <div
                    ref={focusNameListRef}
                    className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 pr-1"
                  >
                    {focusLoading && (
                      <div className="flex items-center justify-center py-3">
                        <span
                          className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[#f6d8af] border-r-transparent"
                          aria-hidden="true"
                        />
                      </div>
                    )}
                    {focusData.names.length === 0 ? (
                      <p
                        className="text-sm"
                        style={{ color: "rgba(245,232,216,0.84)" }}
                      >
                        No names in this block yet.
                      </p>
                    ) : filteredFocusNames.length === 0 ? (
                      <p
                        className="text-sm"
                        style={{ color: "rgba(245,232,216,0.84)" }}
                      >
                        No similar names found.
                      </p>
                    ) : (
                      filteredFocusNames.map((entry) => {
                        const match =
                          focusTargetName?.trim().toLowerCase() ===
                          entry.name.trim().toLowerCase();

                        return (
                          <div
                            key={entry.id}
                            data-entry-name={entry.name}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                            style={{
                              background: match
                                ? "rgba(230,153,63,0.25)"
                                : "rgba(255,246,233,0.06)",
                              border: match
                                ? "1px solid rgba(240,182,97,0.48)"
                                : "1px solid rgba(228,180,121,0.2)",
                            }}
                          >
                            <button
                              type="button"
                              disabled={Boolean(focusTargetName)}
                              onClick={() => {
                                setFocusTargetName(entry.name);
                                setFocusZoomKey((prev) => prev + 1);
                              }}
                              className="flex-1 text-left text-sm truncate"
                              style={{
                                color: match
                                  ? "#fff5e5"
                                  : "rgba(245,232,216,0.95)",
                                fontWeight: match ? 700 : 500,
                                cursor: focusTargetName
                                  ? "not-allowed"
                                  : "pointer",
                                opacity: focusTargetName ? 0.75 : 1,
                              }}
                              title={entry.name}
                            >
                              {entry.name}
                            </button>
                            <span
                              className="text-[10px] px-2 py-0.5 rounded-md"
                              style={{
                                background: "rgba(255,246,233,0.1)",
                                border: "1px solid rgba(228,180,121,0.22)",
                                color: "rgba(245,232,216,0.86)",
                              }}
                            >
                              x{entry.qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleDelete(entry.id)}
                              className="w-7 h-7 rounded-md text-sm"
                              style={{
                                background: "rgba(220,110,90,0.18)",
                                border: "1px solid rgba(220,110,90,0.35)",
                                color: "#ffd7d0",
                              }}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </motion.div>

            {/* Back button */}
            <motion.button
              className="fixed top-5 left-5 px-5 py-2.5 rounded-xl text-sm font-bold z-[110]"
              style={{
                background:
                  "linear-gradient(150deg, rgba(49,25,12,0.95), rgba(69,34,15,0.93))",
                border: "1px solid rgba(228,180,121,0.26)",
                color: "#ffe9cc",
                boxShadow: "0 6px 20px rgba(0,0,0,0.26)",
              }}
              onClick={closeBlock}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              whileHover={{
                background:
                  "linear-gradient(150deg, rgba(61,31,15,0.97), rgba(88,42,18,0.95))",
                boxShadow: "0 10px 24px rgba(0,0,0,0.32)",
              }}
            >
              ← Back to wall
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPledgeModal && focusedBlock && (
          <motion.div
            className="fixed inset-0 z-120 flex items-center justify-center p-4"
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
              className="w-full max-w-sm p-5 rounded-2xl"
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
                    void handleDonorSubmit("pledge", pledgeDays);
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
        {showThankYou && latestReceipt && (
          <motion.div
            className="fixed inset-0 z-[220] flex items-center justify-center p-6"
            style={{
              background: "rgba(20,12,8,0.56)",
              backdropFilter: "blur(10px)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-[min(560px,92vw)] rounded-2xl p-6"
              style={{
                background:
                  "linear-gradient(170deg, rgba(45,24,12,0.96), rgba(33,18,10,0.95))",
                border: "1px solid rgba(228,180,121,0.32)",
                boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
              }}
              initial={{ y: 16, scale: 0.96, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 16, scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
            >
              <p
                className="text-xs tracking-[0.18em] uppercase"
                style={{ color: "rgba(255,221,168,0.78)" }}
              >
                Thank You for Your Offering
              </p>
              <h3
                className="text-2xl font-bold mt-2"
                style={{
                  fontFamily: '"Playfair Display", serif',
                  color: "#fff4e3",
                }}
              >
                Haribol, {latestReceipt.name}!
              </h3>
              <p
                className="text-sm mt-2"
                style={{ color: "rgba(245,232,216,0.9)" }}
              >
                Your donation has been recorded successfully. Your inscription
                is now reflected in Block {latestReceipt.block_id}.
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <div
                  className="px-3 py-2 rounded-lg"
                  style={{ background: "rgba(255,246,233,0.08)" }}
                >
                  <p
                    className="text-[10px] uppercase"
                    style={{ color: "rgba(255,230,198,0.75)" }}
                  >
                    Serial
                  </p>
                  <p className="text-sm" style={{ color: "#fff5e7" }}>
                    {latestReceipt.serial_number}
                  </p>
                </div>
                <div
                  className="px-3 py-2 rounded-lg"
                  style={{ background: "rgba(255,246,233,0.08)" }}
                >
                  <p
                    className="text-[10px] uppercase"
                    style={{ color: "rgba(255,230,198,0.75)" }}
                  >
                    Amount
                  </p>
                  <p className="text-sm" style={{ color: "#fff5e7" }}>
                    ₹{formatINR(latestReceipt.amount)}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={downloadReceipt}
                  className="px-4 py-2 rounded-lg text-sm font-bold"
                  style={{
                    background: "linear-gradient(135deg, #c96b1b, #e0b860)",
                    color: "#fff",
                  }}
                >
                  Download Receipt
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowThankYou(false);
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-semibold"
                  style={{
                    background: "rgba(255,246,233,0.1)",
                    border: "1px solid rgba(228,180,121,0.26)",
                    color: "#ffe9cc",
                  }}
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function WebAppMarquee({ blocks }: { blocks: Map<string, BlockData> }) {
  const names = new Set<string>();
  blocks.forEach((b) => b.names.forEach((n) => names.add(n.name)));
  const allNames = Array.from(names);
  if (allNames.length === 0) return null;
  const duration = Math.max(20, allNames.length * 5);
  const items = allNames.map((name, i) => (
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
        🪔
      </span>
      {name}
    </span>
  ));
  return (
    <div
      className="flex whitespace-nowrap"
      style={{ animation: `marquee ${duration}s linear infinite` }}
    >
      {items}
      {items}
    </div>
  );
}
