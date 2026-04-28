"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { WallFrame } from "@/components/mosaic/WallFrame";
import { LoadingScreen } from "@/components/shared/LoadingScreen";
import { useBlockData } from "@/hooks/useBlockData";
import { formatINR, COST_PER_NAME, NAMES_PER_BLOCK, GRID_SIZE, BlockData } from "@/lib/mosaic/engine";
import { motion, AnimatePresence } from "framer-motion";
import { COUNTRY_CODES } from "@/app/donor-form/countries";

const COL_LABELS = Array.from({ length: GRID_SIZE }, (_, i) =>
  String.fromCharCode(65 + i),
);

// Refined pattern for the maroon sidebar
const SIDEBAR_PATTERN = `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M20 20.5V18H0v-2h20v-2.5L22.5 15 25 12.5V0h2v12.5L29.5 15 32 18.5V20h8v2h-8v1.5L29.5 27 27 29.5V40h-2V29.5L22.5 27 20 23.5V22H0v-2h20z' fill='%23d7ad57' fill-opacity='0.05' fill-rule='evenodd'/%3E%3C/svg%3E")`;
const FRAME_PATTERN = `url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M12 0l4 4h-8l4-4zM4 12l-4-4v8l4-4zm16 0l4 4v-8l-4 4zM12 24l-4-4h8l-4 4z' fill='%235c3a10' fill-opacity='0.15' fill-rule='evenodd'/%3E%3C/svg%3E")`;
const BG_PATTERN = `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d7ad57' fill-opacity='0.06'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`;

const CornerOrnament = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 0H48V3H3V48H0V0Z" fill="url(#goldGradient)" />
    <path d="M6 6H38C38 23.6731 23.6731 38 6 38V6Z" fill="url(#goldGradient)" fillOpacity="0.5" />
    <path d="M11 11H26C26 19.2843 19.2843 26 11 26V11Z" fill="url(#goldGradient)" />
    <circle cx="11" cy="11" r="3" fill="#4a2e00" />
    <defs>
      <linearGradient id="goldGradient" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop stopColor="#fceabb" />
        <stop offset="0.5" stopColor="#d7ad57" />
        <stop offset="1" stopColor="#8a5a19" />
      </linearGradient>
    </defs>
  </svg>
);

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1, cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) for (let j = 1; j < cols; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
  }
  return dp[a.length][b.length];
}

function isSimilarName(name: string, query: string): boolean {
  const n = normalizeName(name), q = normalizeName(query);
  if (!q) return true;
  if (n.includes(q) || q.includes(n)) return true;
  const nameTokens = n.split(" "), queryTokens = q.split(" ");
  if (queryTokens.some(t => nameTokens.some(nt => nt.includes(t)))) return true;
  const cn = n.replace(/\s/g, ""), cq = q.replace(/\s/g, "");
  const d = levenshteinDistance(cn, cq);
  const threshold = cq.length <= 5 ? 1 : cq.length <= 9 ? 2 : 3;
  return d <= threshold;
}

function buildSharedSerial(actionType: "donate" | "pledge", primaryBlockId: string): string {
  const prefix = actionType === "pledge" ? "PLG" : "DON";
  const base = (Date.now() + Math.floor(Math.random() * 1000)) % 1_000_000;
  const suffix = String(base).padStart(6, "0");
  return `${prefix}-${primaryBlockId.toUpperCase()}-${suffix}`;
}

type BlockCapacity = { id: string; remaining: number };

type SearchItem = {
  kind: "name" | "phone" | "serial";
  label: string;
  block_id: string;
  qty?: number;
  created_at?: string;
  subtitle?: string;
  serial_number?: string;
};

export default function WallFramePage() {
  const router = useRouter();
  const { blocks, loading, fetchBlock, submitDonation } = useBlockData();
  const [ready, setReady] = useState(false);
  const [focusedBlock, setFocusedBlock] = useState<string | null>(null);
  const [focusData, setFocusData] = useState<BlockData | null>(null);
  const [hoveredBlock, setHoveredBlock] = useState<string | null>(null);
  const [mobileCol, setMobileCol] = useState<string | null>(null);
  const [mobileRow, setMobileRow] = useState<number | null>(null);
  const [mobileTab, setMobileTab] = useState<'new-donor' | 'view-donation'>('new-donor');
  const searchModeRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get('search') === 'true') {
      searchModeRef.current = true;
      setMobileTab('view-donation');
    }
  }, []);

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
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [blockSwitching, setBlockSwitching] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);

  // Name search state
  const [nameSearchQuery, setNameSearchQuery] = useState("");
  const [nameFilterQuery, setNameFilterQuery] = useState("");
  const [highlightName, setHighlightName] = useState<string | null>(null);

  // Inscription submissions for the highlighted name
  type SubmissionDetail = {
    id: number;
    serial_number: string | null;
    action_type: string;
    name: string;
    qty: number;
    amount: number;
    payment_method: string | null;
    payment_reference: string | null;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    created_at: string;
  };
  const [highlightSubmissions, setHighlightSubmissions] = useState<SubmissionDetail[]>([]);
  const [highlightSubmissionsLoading, setHighlightSubmissionsLoading] = useState(false);
  const [receiptOverlay, setReceiptOverlay] = useState<SubmissionDetail | null>(null);

  useEffect(() => {
    if (!focusedBlock || !highlightName) {
      setHighlightSubmissions([]);
      return;
    }
    let cancelled = false;
    setHighlightSubmissionsLoading(true);
    fetch(`/api/blocks/${focusedBlock}/submissions?name=${encodeURIComponent(highlightName)}`)
      .then(r => r.json())
      .then((d: { submissions?: SubmissionDetail[] }) => {
        if (cancelled) return;
        setHighlightSubmissions(d.submissions ?? []);
      })
      .catch(() => { if (!cancelled) setHighlightSubmissions([]); })
      .finally(() => { if (!cancelled) setHighlightSubmissionsLoading(false); });
    return () => { cancelled = true; };
  }, [focusedBlock, highlightName]);

  // Global search state (across all blocks)
  const SEARCH_PLACEHOLDER_META = "Search by name, mobile number, or serial number.";
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [searchMeta, setSearchMeta] = useState(SEARCH_PLACEHOLDER_META);

  const applyNameSearch = useCallback(() => {
    const q = nameSearchQuery.trim();
    setNameFilterQuery(q);
    setHighlightName(q || null);
  }, [nameSearchQuery]);

  const clearNameSearch = useCallback(() => {
    setNameSearchQuery("");
    setNameFilterQuery("");
    setHighlightName(null);
  }, []);

  const runSearch = useCallback(async () => {
    const query = searchQuery.trim();
    setSearchSubmitted(true);
    if (query.length < 2) {
      setSearchResults([]);
      setSearchMeta("Type at least 2 characters to search.");
      return;
    }
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = (await res.json()) as { query: string; results: SearchItem[] };
      const results = Array.isArray(data.results) ? data.results : [];
      setSearchResults(results);
      setSearchMeta(results.length ? `Found ${results.length} result${results.length > 1 ? "s" : ""}.` : "No results found.");
    } catch {
      setSearchResults([]);
      setSearchMeta("Search is temporarily unavailable. Please try again.");
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery]);

  const clearGlobalSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
    setSearchSubmitted(false);
    setSearchMeta(SEARCH_PLACEHOLDER_META);
  }, []);

  const parsedFormQty = parseInt(formQtyInput, 10);
  const totalAmount = (Number.isFinite(parsedFormQty) ? Math.max(0, parsedFormQty) : 0) * COST_PER_NAME;

  const openBlockRef = useRef<(id: string) => void>(() => {});
  const blockSwitchingRef = useRef(false);
  useEffect(() => { blockSwitchingRef.current = blockSwitching; }, [blockSwitching]);
  const blocksLookupRef = useRef(blocks);
  useEffect(() => { blocksLookupRef.current = blocks; }, [blocks]);

  const handleWallBlockClick = useCallback((id: string) => {
    if (blockSwitchingRef.current) return;
    const block = blocksLookupRef.current.get(id);
    if (block && block.remaining <= 0) return;
    openBlockRef.current(id);
  }, []);
  const handleWallBlockHover = useCallback((id: string | null) => {
    setHoveredBlock(id);
  }, []);
  const handleWallFirstPaint = useCallback(() => {
    setCanvasReady(true);
  }, []);

  const handlePhoneChange = useCallback((value: string) => {
    setFormPhone(value);
    if (formSamePhone) setFormWa(value);
  }, [formSamePhone]);

  const handleSamePhoneChange = useCallback((checked: boolean) => {
    setFormSamePhone(checked);
    if (checked) { setFormWa(formPhone); setFormWaCode("+91"); }
  }, [formPhone]);

  const openBlock = useCallback(async (id: string, targetName?: string) => {
    setFocusedBlock(id);
    setFormStatus("");
    setPaymentError("");
    const trimmedTarget = targetName?.trim();
    if (trimmedTarget) {
      setNameSearchQuery(trimmedTarget);
      setNameFilterQuery(trimmedTarget);
      setHighlightName(trimmedTarget);
    } else {
      setNameSearchQuery("");
      setNameFilterQuery("");
      setHighlightName(null);
    }
    const cached = blocks.get(id);
    if (cached) {
      // Cached data is kept fresh via SSE; no need to refetch (which would force a full canvas redraw).
      setFocusData(cached);
      return;
    }
    setBlockSwitching(true);
    try {
      const data = await fetchBlock(id);
      setFocusData(data);
    } catch { setFormStatus("Unable to load this block right now."); }
    finally { setBlockSwitching(false); }
  }, [fetchBlock, blocks]);

  useEffect(() => { openBlockRef.current = (id) => { void openBlock(id); }; }, [openBlock]);

  const closeBlock = useCallback(() => {
    setFocusedBlock(null);
    setFocusData(null);
    setFormStatus("");
    setFormName("");
    setFormQtyInput("1");
    setFormDob("");
    setFormEmail("");
    setFormPhone("");
    setFormWa("");
    setFormSamePhone(false);
    setPaymentError("");
    setNameSearchQuery("");
    setNameFilterQuery("");
    setHighlightName(null);
    setSearchQuery("");
    setSearchResults([]);
    setSearchSubmitted(false);
    setSearchMeta(SEARCH_PLACEHOLDER_META);
  }, []);

  const backToSearch = useCallback(() => {
    setFocusedBlock(null);
    setFocusData(null);
    setHighlightName(null);
    setNameSearchQuery("");
    setNameFilterQuery("");
    setFormStatus("");
    setPaymentError("");
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

  const buildAllocationPlan = useCallback((capacities: BlockCapacity[], requestedQty: number, preferredBlockId?: string) => {
    const totalRemaining = capacities.reduce((sum, b) => sum + b.remaining, 0);
    if (totalRemaining < requestedQty) throw new Error(`Only ${totalRemaining} slots available.`);
    const preferred = preferredBlockId?.trim();
    const ordered = [...capacities].sort((a, b) => b.remaining - a.remaining);
    if (preferred) { const idx = ordered.findIndex(b => b.id === preferred); if (idx > 0) { const [picked] = ordered.splice(idx, 1); ordered.unshift(picked); } }
    let left = requestedQty;
    const plan: Array<{ id: string; qty: number }> = [];
    for (const block of ordered) { if (left <= 0) break; if (block.remaining <= 0) continue; const q = Math.min(left, block.remaining); plan.push({ id: block.id, qty: q }); left -= q; }
    if (left > 0) throw new Error("Unable to allocate all names.");
    return plan;
  }, []);

  function validateFormFields(actionType: "donate" | "pledge", selectedPledgeDays?: number): boolean {
    if (!formName.trim()) { setFormStatus("Please enter a name."); return false; }
    const q = parseInt(formQtyInput, 10);
    if (!Number.isFinite(q) || q < 1) { setFormStatus("Invalid quantity."); return false; }
    if (!formPhone.trim()) { setFormStatus("Phone required."); return false; }
    const phCountry = COUNTRY_CODES.find(c => c.code === formPhoneCode);
    if (phCountry) { const d = formPhone.replace(/\D/g, "").length; if (d < phCountry.min || d > phCountry.max) { setFormStatus(`Mobile number must be ${phCountry.min === phCountry.max ? phCountry.min : `${phCountry.min}-${phCountry.max}`} digits.`); return false; } }
    const wa = formSamePhone ? formPhone : formWa;
    if (!wa.trim()) { setFormStatus("WhatsApp required."); return false; }
    if (!formSamePhone) { const waC = COUNTRY_CODES.find(c => c.code === formWaCode); if (waC) { const d = wa.replace(/\D/g, "").length; if (d < waC.min || d > waC.max) { setFormStatus(`WhatsApp must be ${waC.min === waC.max ? waC.min : `${waC.min}-${waC.max}`} digits.`); return false; } } }
    if (!formEmail.trim()) { setFormStatus("Email is required."); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail.trim())) { setFormStatus("Please enter a valid email."); return false; }
    if (actionType === "pledge" && !selectedPledgeDays) { setFormStatus("Please select pledge days."); return false; }
    return true;
  }

  async function handleDonorSubmit(actionType: "donate" | "pledge", selectedPledgeDays?: number) {
    if (!focusedBlock) return;
    if (!validateFormFields(actionType)) return;
    const qtyNumber = parseInt(formQtyInput, 10);
    const donorName = formName.trim();
    const wa = formSamePhone ? formPhone : formWa;
    setSubmitting(true); setFormStatus("");
    try {
      const payloadBase: Record<string, unknown> = { name: donorName, date_of_birth: formDob, email: formEmail.trim(), phone: `${formPhoneCode} ${formPhone.trim()}`, whatsapp: `${formSamePhone ? formPhoneCode : formWaCode} ${wa.trim()}` };
      const sharedSerial = buildSharedSerial("donate", focusedBlock);
      payloadBase.receipt_serial = sharedSerial;
      const capacities = await fetchCapacities();
      const plan = buildAllocationPlan(capacities, qtyNumber, focusedBlock);
      const allocationReceipts: { block_id: string; qty: number; amount: number; serial_number?: string }[] = [];
      let firstReceipt: { serial_number: string; created_at: string } | null = null;
      for (const alloc of plan) {
        const response = await submitDonation(alloc.id, { ...payloadBase, qty: alloc.qty }) as BlockData & { receipt?: { serial_number: string; created_at: string } };
        if (!firstReceipt && response.receipt) firstReceipt = response.receipt;
        allocationReceipts.push({ block_id: alloc.id, qty: alloc.qty, amount: alloc.qty * COST_PER_NAME, serial_number: response.receipt?.serial_number });
      }
      const receiptPayload = { trust_name: "KIRTAN SEVA TRUST", serial_number: sharedSerial, action_type: "donate", donor_name: donorName, qty: qtyNumber, total_amount: qtyNumber * COST_PER_NAME, phone: `${formPhoneCode} ${formPhone.trim()}`, whatsapp: `${formSamePhone ? formPhoneCode : formWaCode} ${wa.trim()}`, email: formEmail.trim() || undefined, created_at: firstReceipt?.created_at ?? new Date().toISOString(), allocations: allocationReceipts };
      try { sessionStorage.setItem("kirtan-web-receipt", JSON.stringify(receiptPayload)); } catch { setFormStatus("Processed, but receipt page unavailable."); setSubmitting(false); return; }
      setSubmitting(false); router.push("/web-app/receipt");
    } catch (e: unknown) { setFormStatus((e as Error).message || "Error. Please try again."); }
    setSubmitting(false);
  }

  async function handlePayOnline() {
    if (!focusedBlock) return;
    if (!validateFormFields("donate")) return;
    const qtyNumber = parseInt(formQtyInput, 10);
    const donorName = formName.trim();
    const phone = formPhone.trim();
    const wa = formSamePhone ? formPhone : formWa;
    const payAmount = qtyNumber * COST_PER_NAME;
    setPaymentLoading(true); setPaymentError(""); setFormStatus("");
    let redirecting = false;
    try {
      const pendingRes = await fetch("/api/payment/pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ block_id: focusedBlock, name: donorName, qty: qtyNumber, date_of_birth: formDob, email: formEmail.trim(), phone: `${formPhoneCode} ${phone}`, whatsapp: `${formSamePhone ? formPhoneCode : formWaCode} ${wa.trim()}`, amount: payAmount }) });
      const pendingData = await pendingRes.json() as { success: boolean; api_key_hash?: string; error?: string };
      if (!pendingData.success || !pendingData.api_key_hash) { const msg = pendingData.error ?? "Could not initiate payment."; setPaymentError(msg); setFormStatus(msg); return; }
      const params = new URLSearchParams({ name: donorName, email: formEmail.trim(), mobile: phone, amount: String(payAmount), api: "1", api_key: `api_${pendingData.api_key_hash}` }).toString();
      redirecting = true;
      window.location.href = `https://birnagar.org/payment/redirect-to-gateway?${params}`;
    } catch { setPaymentError("Network error."); setFormStatus("Network error."); } finally { if (!redirecting) setPaymentLoading(false); }
  }

  useEffect(() => {
    if (!loading) {
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (fonts?.ready) {
        fonts.ready.then(() => setReady(true));
      } else {
        setReady(true);
      }
    }
  }, [loading]);

  // Safety: dismiss LoadingScreen even if canvas paint signal is missed.
  useEffect(() => {
    if (canvasReady || loading) return;
    const t = window.setTimeout(() => setCanvasReady(true), 1500);
    return () => window.clearTimeout(t);
  }, [canvasReady, loading]);

  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (loading || autoSelectedRef.current || focusedBlock) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    if (searchModeRef.current) { autoSelectedRef.current = true; return; }
    const available: string[] = [];
    blocks.forEach((b, id) => { if (b.remaining > 0) available.push(id); });
    if (available.length === 0) return;
    const randomId = available[Math.floor(Math.random() * available.length)];
    autoSelectedRef.current = true;
    void openBlock(randomId);
  }, [loading, blocks, focusedBlock, openBlock]);

  const autoMobileSelectedRef = useRef(false);
  useEffect(() => {
    if (loading || autoMobileSelectedRef.current || focusedBlock) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 768px)").matches) return;
    const available: string[] = [];
    blocks.forEach((b, id) => { if (b.remaining > 0) available.push(id); });
    if (available.length === 0) return;
    const randomId = available[Math.floor(Math.random() * available.length)];
    autoMobileSelectedRef.current = true;
    setMobileCol(randomId.charAt(0));
    setMobileRow(parseInt(randomId.slice(1), 10));
  }, [loading, blocks, focusedBlock]);

  const dataReady = !loading && ready;
  const isBooting = !dataReady || !canvasReady;

  // Stats
  let totalNames = 0;
  blocks.forEach((b) => {
    totalNames += b.total_used;
  });
  const totalCollected = totalNames * COST_PER_NAME;

  return (
    <div
      className="h-screen w-screen overflow-hidden flex flex-col md:flex-row relative"
      style={{
        background: `
          radial-gradient(circle at top left, rgba(201,107,27,0.1), transparent 30%),
          radial-gradient(circle at 85% 18%, rgba(215,173,87,0.15), transparent 25%),
          radial-gradient(circle at 50% 80%, rgba(65, 15, 20, 0.08), transparent 45%),
          linear-gradient(135deg, rgba(255,255,255,0.4), rgba(255,248,237,0.08)),
          #f2ece2
        `,
      }}
    >
      {/* Subtle Background Elements */}
      <div className="absolute inset-0 pointer-events-none z-0" style={{ backgroundImage: BG_PATTERN }} />
      <div className="absolute top-10 left-1/4 w-96 h-96 bg-[#c96b1b] rounded-full blur-[120px] opacity-10 pointer-events-none" />
      <div className="absolute bottom-10 right-1/4 w-96 h-96 bg-[#d7ad57] rounded-full blur-[150px] opacity-10 pointer-events-none" />

      <LoadingScreen visible={isBooting} />

      {/* Sidebar (Tablet/Desktop) */}
      {!isBooting && (
        <motion.div 
          className="hidden md:flex flex-col w-80 lg:w-96 h-full z-20 relative shadow-[25px_0_50px_-10px_rgba(0,0,0,0.6)]"
          style={{
            background: `linear-gradient(180deg, rgba(50, 10, 15, 0.95) 0%, rgba(25, 5, 8, 0.98) 100%)`,
            borderRight: "2px solid rgba(215,173,87,0.4)"
          }}
          initial={{ x: -100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          {/* Pattern Overlay for Sidebar */}
          <div className="absolute inset-0 pointer-events-none opacity-60" style={{ backgroundImage: SIDEBAR_PATTERN }} />
          {/* Inner border to make the sidebar look like a framed panel itself */}
          <div className="absolute inset-2 border border-[#d7ad57]/20 pointer-events-none rounded-sm" />
          
          <div className="p-6 flex flex-col h-full relative z-10 overflow-y-auto">
            <AnimatePresence mode="wait">
              {focusedBlock && focusData && highlightName ? (
                <motion.div key="highlight-sidebar" className="flex flex-col gap-4 flex-1" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                  <button onClick={backToSearch} className="self-start inline-flex items-center gap-2 px-3 py-2 rounded-md text-[11px] font-bold tracking-widest uppercase transition-all hover:brightness-110 active:scale-[0.99]" style={{ background: "rgba(255,246,233,0.08)", border: "1px solid rgba(228,180,121,0.28)", color: "#ffe9cc", fontFamily: '"Cinzel", Georgia, serif' }}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                    Back to Search
                  </button>
                  {(() => {
                    const totalQty = highlightSubmissions.reduce((sum, s) => sum + (s.qty || 0), 0);
                    const totalAmt = highlightSubmissions.reduce((sum, s) => sum + (s.amount || 0), 0);
                    const fmtDate = (iso: string) => {
                      const d = new Date(iso);
                      return isNaN(d.getTime()) ? "—" : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
                    };
                    const fmtMethod = (m: string | null | undefined) => {
                      if (!m) return "—";
                      const lower = m.toLowerCase();
                      if (lower === "online") return "Online";
                      if (lower === "cash") return "Cash";
                      if (lower === "upi") return "UPI";
                      return m.charAt(0).toUpperCase() + m.slice(1);
                    };
                    return (
                      <div className="flex flex-col gap-3 p-4 rounded-2xl" style={{ background: "linear-gradient(180deg, rgba(40,8,12,0.95), rgba(20,4,6,0.98))", border: "1px solid rgba(215,173,87,0.3)", boxShadow: "0 18px 48px rgba(0,0,0,0.45), inset 0 1px 0 rgba(252,234,187,0.08)" }}>
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.9)" }}>Inscription Details</p>
                          {highlightSubmissions.length > 1 && (
                            <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.7)" }}>{highlightSubmissions.length} donations</span>
                          )}
                        </div>

                        <div className="flex flex-col gap-2">
                          <div className="flex justify-between items-start gap-3 px-3 py-2 rounded-lg" style={{ background: "rgba(255,246,233,0.06)", border: "1px solid rgba(228,180,121,0.18)" }}>
                            <span className="text-[10px] font-bold tracking-wider uppercase shrink-0" style={{ color: "rgba(215,173,87,0.85)" }}>Name</span>
                            <span className="text-sm font-extrabold text-right break-words" style={{ color: "#fff5e7" }}>{highlightName}</span>
                          </div>
                          <div className="flex justify-between items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "rgba(255,246,233,0.06)", border: "1px solid rgba(228,180,121,0.18)" }}>
                            <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Block</span>
                            <span className="text-sm font-extrabold" style={{ color: "#fff5e7" }}>{focusedBlock}</span>
                          </div>
                          <div className="flex justify-between items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "rgba(255,246,233,0.06)", border: "1px solid rgba(228,180,121,0.18)" }}>
                            <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Slots Inscribed</span>
                            <span className="text-sm font-extrabold" style={{ color: "#fff5e7" }}>{totalQty}</span>
                          </div>
                          <div className="flex justify-between items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "rgba(215,173,87,0.12)", border: "1px solid rgba(215,173,87,0.28)" }}>
                            <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.95)" }}>Amount Donated</span>
                            <span className="text-sm font-extrabold" style={{ color: "#fceabb" }}>₹{formatINR(totalAmt)}</span>
                          </div>
                        </div>

                        {highlightSubmissionsLoading && highlightSubmissions.length === 0 && (
                          <p className="text-xs text-center" style={{ color: "rgba(215,173,87,0.7)" }}>Loading donation details…</p>
                        )}

                        {highlightSubmissions.length === 0 && !highlightSubmissionsLoading && (
                          <p className="text-xs text-center" style={{ color: "rgba(215,173,87,0.7)" }}>No detailed donation record on file.</p>
                        )}

                        {highlightSubmissions.map((s) => {
                          return (
                            <div key={s.id} className="flex flex-col gap-2 p-3 rounded-xl" style={{ background: "rgba(255,246,233,0.04)", border: "1px solid rgba(228,180,121,0.18)" }}>
                              <div className="flex justify-between items-center gap-2">
                                <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Serial No.</span>
                                <span className="text-xs font-bold break-all text-right" style={{ color: "#fceabb" }}>{s.serial_number ?? "—"}</span>
                              </div>
                              <div className="flex justify-between items-center gap-2">
                                <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Type</span>
                                <span className="text-xs font-bold uppercase" style={{ color: "#fff5e7" }}>{s.action_type === "pledge" ? "Pledge" : "Donation"}</span>
                              </div>
                              <div className="flex justify-between items-center gap-2">
                                <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Payment</span>
                                <span className="text-xs font-bold" style={{ color: "#fff5e7" }}>{fmtMethod(s.payment_method)}</span>
                              </div>
                              <div className="flex justify-between items-center gap-2">
                                <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Slots</span>
                                <span className="text-xs font-bold" style={{ color: "#fff5e7" }}>{s.qty}</span>
                              </div>
                              <div className="flex justify-between items-center gap-2">
                                <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Amount</span>
                                <span className="text-xs font-bold" style={{ color: "#fceabb" }}>₹{formatINR(s.amount)}</span>
                              </div>
                              <div className="flex justify-between items-center gap-2">
                                <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Date</span>
                                <span className="text-xs font-bold" style={{ color: "#fff5e7" }}>{fmtDate(s.created_at)}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setReceiptOverlay(s)}
                                className="mt-1 w-full inline-flex items-center justify-center gap-2 py-2 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all hover:brightness-110 active:scale-[0.99]"
                                style={{ background: "linear-gradient(135deg, #d77a26 0%, #8a3a0a 60%, #5a2308 100%)", color: "#fff5e7", border: "1px solid rgba(252,234,187,0.5)", boxShadow: "0 6px 14px rgba(201,107,27,0.4), inset 0 1px 0 rgba(252,234,187,0.4)", fontFamily: '"Cinzel", Georgia, serif', textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                View Receipt
                              </button>
                              <a
                                href={`https://pdf-gen-sbvt.onrender.com/download-ticket?name=${encodeURIComponent(s.name)}&qty=${s.qty}&block=${encodeURIComponent(focusedBlock!)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full inline-flex items-center justify-center gap-2 py-2 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all hover:brightness-110 active:scale-[0.99]"
                                style={{ background: "linear-gradient(135deg, #b08124 0%, #6b4a12 60%, #3f2a08 100%)", color: "#fff5e7", border: "1px solid rgba(252,234,187,0.5)", boxShadow: "0 6px 14px rgba(176,129,36,0.4), inset 0 1px 0 rgba(252,234,187,0.4)", fontFamily: '"Cinzel", Georgia, serif', textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                                View Certificate
                              </a>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </motion.div>
              ) : focusedBlock && focusData ? (
                <motion.div key="focused-sidebar" className="flex flex-col gap-4 flex-1" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                  {/* Header with back button */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className="px-3 py-1.5 rounded-md flex flex-col items-center" style={{ background: "linear-gradient(135deg, rgba(201,107,27,0.35), rgba(138,90,25,0.2))", border: "1px solid rgba(252,234,187,0.45)", boxShadow: "0 0 18px rgba(201,107,27,0.45), inset 0 0 12px rgba(252,234,187,0.15)" }}>
                        <span className="text-[9px] font-bold uppercase tracking-[0.25em] leading-none mb-1 text-center" style={{ color: "rgba(252,234,187,0.75)" }}>Block</span>
                        <h2 className="text-3xl lg:text-4xl font-black leading-none text-center" style={{ fontFamily: '"Cinzel", Georgia, serif', background: "linear-gradient(135deg, #fff5e7, #fceabb, #d7ad57)", WebkitBackgroundClip: "text", color: "transparent", textShadow: "0 0 24px rgba(252,234,187,0.6)", letterSpacing: "0.05em" }}>
                          {focusedBlock}
                        </h2>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#a88e6f" }}>Used: <span style={{ color: "#fceabb" }}>{focusData.total_used}</span></span>
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#a88e6f" }}>Left: <span style={{ color: "#fceabb" }}>{focusData.remaining}</span></span>
                      </div>
                    </div>
                    <button onClick={closeBlock} className="p-2.5 rounded-full transition-all" style={{ background: "rgba(255,246,233,0.08)", border: "1px solid rgba(228,180,121,0.2)" }}>
                      <svg className="w-4 h-4" style={{ color: "#d7ad57" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>

                  {/* Donor Form */}
                  <div className="flex flex-col gap-3 p-4 rounded-xl" style={{ background: "rgba(255,246,233,0.07)", border: "1px solid rgba(228,180,121,0.2)" }}>
                    <p className="text-xs font-bold tracking-wider uppercase" style={{ color: "rgba(255,230,198,0.85)" }}>New Donor</p>
                    <div className="flex gap-2">
                      <div className="flex-1 flex flex-col gap-1">
                        <label className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(255,230,198,0.85)" }}>Name</label>
                        <input value={formName} onChange={e => setFormName(e.target.value)} maxLength={40} placeholder="Donor name" className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: "rgba(255,250,244,0.96)", border: "1px solid rgba(222,182,131,0.36)", color: "#2a1509", fontSize: "14px" }} />
                      </div>
                      <div className="w-14 flex flex-col gap-1">
                        <label className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(255,230,198,0.85)" }}>Qty</label>
                        <input type="text" value={formQtyInput} inputMode="numeric" maxLength={4} onChange={e => setFormQtyInput(e.target.value.replace(/\D/g, ""))} className="px-2 py-2 rounded-lg text-sm outline-none" style={{ background: "rgba(255,250,244,0.96)", border: "1px solid rgba(222,182,131,0.36)", color: "#2a1509", fontSize: "14px" }} />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(255,230,198,0.85)" }}>Mobile Number</label>
                      <div className="flex gap-2">
                        <select value={formPhoneCode} onChange={e => setFormPhoneCode(e.target.value)} className="w-20 px-1 py-2 rounded-lg text-xs outline-none" style={{ background: "rgba(255,250,244,0.96)", border: "1px solid rgba(222,182,131,0.36)", color: "#2a1509" }}>
                          {COUNTRY_CODES.map(c => <option key={`ph-${c.name}`} value={c.code}>{c.name} ({c.code})</option>)}
                        </select>
                        <input type="tel" value={formPhone} onChange={e => handlePhoneChange(e.target.value)} maxLength={20} placeholder="Phone number" inputMode="numeric" className="flex-1 px-3 py-2 rounded-lg text-sm outline-none" style={{ background: "rgba(255,250,244,0.96)", border: "1px solid rgba(222,182,131,0.36)", color: "#2a1509", fontSize: "14px" }} />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={formSamePhone} onChange={e => handleSamePhoneChange(e.target.checked)} className="w-3.5 h-3.5" />
                      <span className="text-xs font-semibold" style={{ color: "#ffe9cc" }}>WhatsApp same as phone</span>
                    </label>
                    {!formSamePhone && (
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(255,230,198,0.85)" }}>WhatsApp Number</label>
                        <div className="flex gap-2">
                          <select value={formWaCode} onChange={e => setFormWaCode(e.target.value)} className="w-20 px-1 py-2 rounded-lg text-xs outline-none" style={{ background: "rgba(255,250,244,0.96)", border: "1px solid rgba(222,182,131,0.36)", color: "#2a1509" }}>
                            {COUNTRY_CODES.map(c => <option key={`wf-${c.name}`} value={c.code}>{c.name} ({c.code})</option>)}
                          </select>
                          <input type="tel" value={formWa} onChange={e => setFormWa(e.target.value)} maxLength={20} placeholder="WhatsApp" className="flex-1 px-3 py-2 rounded-lg text-sm outline-none" style={{ background: "rgba(255,250,244,0.96)", border: "1px solid rgba(222,182,131,0.36)", color: "#2a1509", fontSize: "14px" }} />
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(255,230,198,0.85)" }}>Date of Birth <span style={{ color: "rgba(255,230,198,0.5)" }}>(optional)</span></label>
                      <input type="date" value={formDob} onChange={e => setFormDob(e.target.value)} className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: "rgba(255,250,244,0.96)", border: "1px solid rgba(222,182,131,0.36)", color: "#2a1509", fontSize: "14px" }} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(255,230,198,0.85)" }}>Email <span style={{ color: "#f6a05a" }}>*</span></label>
                      <input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} maxLength={80} placeholder="Email address" className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: "rgba(255,250,244,0.96)", border: "1px solid rgba(222,182,131,0.36)", color: "#2a1509", fontSize: "14px" }} />
                    </div>
                    <div className="flex justify-between items-center px-3 py-2 rounded-lg" style={{ background: "rgba(255,246,233,0.12)", border: "1px solid rgba(228,180,121,0.24)" }}>
                      <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(255,230,198,0.88)" }}>Total</span>
                      <span className="text-sm font-extrabold" style={{ color: "#fff5e7" }}>₹{formatINR(totalAmount)}</span>
                    </div>
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-[10px] leading-snug" style={{ background: "rgba(224,184,96,0.1)", border: "1px solid rgba(224,184,96,0.28)", color: "rgba(255,230,170,0.9)" }}>
                      <span className="shrink-0 mt-px">⚠️</span>
                      <span>Some banks have issues with net banking. Use UPI or card for now.</span>
                    </div>
                    <button className="w-full py-2.5 rounded-lg text-sm font-bold tracking-wider uppercase transition-all hover:brightness-110 active:scale-[0.99]" style={{ background: "linear-gradient(135deg, #d77a26 0%, #8a3a0a 60%, #5a2308 100%)", color: "#fff5e7", border: "1px solid rgba(252,234,187,0.5)", boxShadow: "0 8px 20px rgba(201,107,27,0.45), inset 0 1px 0 rgba(252,234,187,0.4)", fontFamily: '"Cinzel", Georgia, serif', textShadow: "0 1px 2px rgba(0,0,0,0.5)", opacity: paymentLoading || submitting ? 0.7 : 1 }} disabled={paymentLoading || submitting} onClick={() => void handlePayOnline()}>
                      {paymentLoading ? <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-r-transparent" />Redirecting</span> : "Pay Online"}
                    </button>
                    {paymentError && <div className="flex items-center gap-2 text-xs p-2 rounded-lg" style={{ background: "rgba(220,110,90,0.12)", border: "1px solid rgba(220,110,90,0.25)", color: "#ffd7d0" }}><p className="flex-1">{paymentError}</p><button type="button" className="px-2 py-1 rounded text-xs font-bold shrink-0" style={{ background: "rgba(255,246,233,0.1)", border: "1px solid rgba(228,180,121,0.26)", color: "#ffe9cc" }} onClick={() => void handlePayOnline()} disabled={paymentLoading}>Retry</button></div>}
                    {formStatus && <div className="text-xs" style={{ color: "#f6d8af" }}><p>{formStatus}</p></div>}
                  </div>
                </motion.div>
              ) : (
                <motion.div key="default-sidebar" className="flex flex-col flex-1 min-h-0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.3 }}>
                  <div className="shrink-0 mb-6 mt-4 text-center">
                    <div className="flex justify-center mb-4">
                      <svg width="60" height="15" viewBox="0 0 60 15" fill="none">
                        <path d="M30 0L35 7.5L30 15L25 7.5L30 0Z" fill="#d7ad57" opacity="0.8"/>
                        <path d="M0 7.5H20M40 7.5H60" stroke="#d7ad57" strokeOpacity="0.4" strokeWidth="1"/>
                      </svg>
                    </div>
                    <p className="text-sm font-semibold tracking-[0.15em] mb-2" style={{ color: "#d7ad57", fontFamily: '"Dancing Script", cursive', fontSize: "1.15rem" }}>
                      Srila Bhaktivinoda Thakur&apos;s
                    </p>
                    <h1 className="text-4xl font-black leading-none mb-4" style={{ fontFamily: '"Cinzel", Georgia, serif', background: "linear-gradient(135deg, #fceabb, #d7ad57, #c96b1b)", WebkitBackgroundClip: "text", color: "transparent", textShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
                      Wall of Legacy
                    </h1>
                    <div className="flex items-center justify-center gap-3">
                      <div className="w-8 h-px bg-gradient-to-r from-transparent to-[#c96b1b]" />
                      <span className="text-xs font-semibold tracking-[0.2em] uppercase" style={{ color: "rgba(215,173,87,0.9)" }}>Wall Frame View</span>
                      <div className="w-8 h-px bg-gradient-to-l from-transparent to-[#c96b1b]" />
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col min-h-0 mb-4">
                    <label className="shrink-0 block text-xs font-bold tracking-wider uppercase mb-3 text-center" style={{ color: "#a88e6f" }}>Find Inscription</label>
                    <div className="shrink-0 relative">
                      <div className="absolute inset-0 bg-gradient-to-r from-[#c58c38]/20 to-[#d7ad57]/20 rounded blur-sm pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => {
                          const value = e.target.value;
                          setSearchQuery(value);
                          setSearchSubmitted(false);
                          if (!value.trim()) {
                            setSearchResults([]);
                            setSearchMeta(SEARCH_PLACEHOLDER_META);
                          }
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
                        placeholder="Name, mobile or serial..."
                        className="relative w-full bg-[#3a0b10]/90 border border-[#c58c38]/50 rounded px-4 py-3 pr-10 text-sm text-[#ffe2b6] placeholder-[#d7ad57]/60 focus:outline-none focus:border-[#fceabb] focus:ring-1 focus:ring-[#fceabb] transition-all shadow-inner text-center"
                      />
                      <svg className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 text-[#d7ad57] pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <div className="shrink-0 flex gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => void runSearch()}
                        disabled={searchLoading}
                        className="flex-1 px-3 py-2 rounded text-[11px] font-bold tracking-widest uppercase transition-all disabled:opacity-60"
                        style={{ background: "linear-gradient(135deg, #c96b1b, #8a5a19)", color: "#fff5e7", border: "1px solid rgba(255,218,159,0.3)", fontFamily: '"Cinzel", Georgia, serif' }}
                      >
                        {searchLoading ? "Searching..." : "Search"}
                      </button>
                      <button
                        type="button"
                        onClick={clearGlobalSearch}
                        className="px-3 py-2 rounded text-[11px] font-bold tracking-widest uppercase"
                        style={{ background: "rgba(255,246,233,0.08)", border: "1px solid rgba(228,180,121,0.26)", color: "#ffe9cc", fontFamily: '"Cinzel", Georgia, serif' }}
                      >
                        Clear
                      </button>
                    </div>
                    <p className="shrink-0 text-[10px] mt-2 text-center" style={{ color: "rgba(245,232,216,0.7)" }}>{searchMeta}</p>
                    {searchResults.length > 0 && (
                      <div className="relative flex-1 min-h-0 mt-3">
                        <div className="absolute inset-0 overflow-y-auto space-y-2 pr-1 pb-6">
                          {searchResults.map((result, index) => (
                            <button
                              key={`${result.kind}-${result.block_id}-${result.label}-${result.serial_number ?? index}`}
                              type="button"
                              onClick={() => void openBlock(result.block_id, result.label)}
                              className="w-full text-left px-3 py-2 rounded-lg transition-all hover:brightness-125"
                              style={{ background: "rgba(255,246,233,0.06)", border: "1px solid rgba(228,180,121,0.2)" }}
                            >
                              <div className="text-sm font-semibold truncate" style={{ color: "#fff5e7" }}>{result.label}</div>
                              <div className="text-[10px] truncate" style={{ color: "rgba(245,232,216,0.7)" }}>
                                Block <span className="font-bold" style={{ color: "#fceabb" }}>{result.block_id}</span>
                                {result.serial_number ? ` · ${result.serial_number}` : ""}
                                {result.subtitle ? ` · ${result.subtitle}` : ""}
                              </div>
                            </button>
                          ))}
                        </div>
                        {searchResults.length > 4 && (
                          <>
                            <div className="pointer-events-none absolute bottom-0 left-0 right-1 h-10 rounded-b-lg" style={{ background: "linear-gradient(to top, rgba(50,10,15,0.98), rgba(50,10,15,0.6) 50%, transparent)" }} />
                            <div className="pointer-events-none absolute bottom-1 left-0 right-0 flex justify-center">
                              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: "rgba(201,107,27,0.18)", border: "1px solid rgba(252,234,187,0.25)" }}>
                                <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "#fceabb" }}>Scroll for more</span>
                                <svg className="w-3 h-3 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: "#fceabb" }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {!searchLoading && searchSubmitted && searchResults.length === 0 && searchQuery.trim().length >= 2 && (
                      <div className="shrink-0 mt-3 rounded-lg px-3 py-2 text-xs text-center" style={{ background: "rgba(255,246,233,0.06)", border: "1px solid rgba(228,180,121,0.2)", color: "#ffe9cc" }}>
                        No matching inscription found.
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 relative bg-[#2a060a]/80 p-6 rounded border border-[#c58c38]/30 shadow-inner overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#d7ad57]/10 via-transparent to-transparent pointer-events-none" />
                    <div className="relative z-10 space-y-6 text-center">
                      <div>
                        <p className="text-[10px] font-bold tracking-[0.2em] uppercase mb-1" style={{ color: "#a88e6f" }}>Names Inscribed</p>
                        <p className="text-3xl font-bold tracking-wide" style={{ fontFamily: '"Cinzel", Georgia, serif', background: "linear-gradient(135deg, #fceabb, #d7ad57)", WebkitBackgroundClip: "text", color: "transparent", textShadow: "0 2px 10px rgba(215,173,87,0.3)" }}>{formatINR(totalNames)}</p>
                      </div>
                      <div className="flex justify-center items-center py-2">
                        <div className="w-12 h-px bg-gradient-to-r from-transparent via-[#d7ad57]/50 to-transparent" />
                        <div className="w-1.5 h-1.5 rotate-45 bg-[#d7ad57]/60 mx-2" />
                        <div className="w-12 h-px bg-gradient-to-r from-transparent via-[#d7ad57]/50 to-transparent" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold tracking-[0.2em] uppercase mb-1" style={{ color: "#a88e6f" }}>Amount Raised</p>
                        <p className="text-3xl font-bold tracking-wide" style={{ fontFamily: '"Cinzel", Georgia, serif', background: "linear-gradient(135deg, #fceabb, #d7ad57)", WebkitBackgroundClip: "text", color: "transparent", textShadow: "0 2px 10px rgba(215,173,87,0.3)" }}>₹{formatINR(totalCollected)}</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        
        {/* Top bar (Mobile only) — hidden when block is focused */}
        {!isBooting && !focusedBlock && (
          <motion.div 
            className="absolute top-0 left-0 right-0 z-10 flex md:hidden items-center justify-center px-4 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.15)] border-b border-[#d7ad57]/20"
            style={{
              background: `rgba(242, 236, 226, 0.95)`,
              backdropFilter: "blur(12px)"
            }}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <div className="relative z-10 flex w-full max-w-sm p-1 rounded-lg" style={{ background: "rgba(60, 15, 20, 0.9)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.5)" }}>
              <button 
                onClick={() => setMobileTab('new-donor')}
                className={`relative flex-1 text-center text-[11px] font-bold tracking-widest uppercase px-2 py-2.5 rounded-md transition-all duration-300 z-10 ${mobileTab === 'new-donor' ? 'text-[#fff5e7] shadow-md' : 'text-[#d7ad57] opacity-70 hover:opacity-100'}`}
              >
                {mobileTab === 'new-donor' && (
                  <motion.div
                    layoutId="mobileTabIndicator"
                    className="absolute inset-0 rounded-md"
                    style={{
                      background: "linear-gradient(135deg, #c96b1b, #8a5a19)",
                      border: "1px solid rgba(255,218,159,0.3)"
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-20">New Donor</span>
              </button>
              
              <button 
                onClick={() => setMobileTab('view-donation')}
                className={`relative flex-1 text-center text-[11px] font-bold tracking-widest uppercase px-2 py-2.5 rounded-md transition-all duration-300 z-10 ${mobileTab === 'view-donation' ? 'text-[#fff5e7] shadow-md' : 'text-[#d7ad57] opacity-70 hover:opacity-100'}`}
              >
                {mobileTab === 'view-donation' && (
                  <motion.div
                    layoutId="mobileTabIndicator"
                    className="absolute inset-0 rounded-md"
                    style={{
                      background: "linear-gradient(135deg, #c96b1b, #8a5a19)",
                      border: "1px solid rgba(255,218,159,0.3)"
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-20">Find your name</span>
              </button>
            </div>
          </motion.div>
        )}

        {/* Hover State Indicator */}
        <AnimatePresence>
          {hoveredBlock && !focusedBlock && !isBooting && (
            <motion.div
              className="absolute bottom-20 right-8 z-30 px-5 py-2 rounded-lg pointer-events-none hidden md:flex items-center gap-3"
              style={{
                background: "rgba(20, 5, 8, 0.8)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(215,173,87,0.3)",
                boxShadow: "0 10px 30px rgba(0,0,0,0.6)"
              }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
            >
              <div className="w-2 h-2 rounded-full bg-[#fceabb] shadow-[0_0_8px_#fceabb]" />
              <span className="text-[#a88e6f] text-xs uppercase tracking-widest font-bold">Focusing</span>
              <span className="text-[#fceabb] font-bold text-xl font-serif tracking-widest">{hoveredBlock}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* View Donation Mobile Container */}
        {!isBooting && mobileTab === 'view-donation' && !focusedBlock && (
          <motion.div
            className="absolute inset-x-0 top-[70px] bottom-0 overflow-y-auto md:hidden z-[5] px-4 pb-6 pt-2"
            style={{ WebkitOverflowScrolling: 'touch' }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <div className="p-6 rounded-2xl shadow-2xl relative overflow-hidden border border-[#c96b1b]/30"
                 style={{
                   background: `linear-gradient(180deg, rgba(40, 8, 12, 0.95) 0%, rgba(20, 4, 6, 0.98) 100%)`,
                 }}
            >
              {/* Pattern Overlay for Mobile Card */}
              <div className="absolute inset-0 pointer-events-none opacity-40 mix-blend-overlay" style={{ backgroundImage: SIDEBAR_PATTERN }} />
              <div className="absolute inset-1.5 border border-[#d7ad57]/10 pointer-events-none rounded-xl" />

              <div className="relative z-10">
                <div className="mb-8 mt-2 text-center">
                  <div className="flex justify-center mb-3">
                    <svg width="50" height="12" viewBox="0 0 60 15" fill="none">
                      <path d="M30 0L35 7.5L30 15L25 7.5L30 0Z" fill="#d7ad57" opacity="0.8"/>
                      <path d="M0 7.5H20M40 7.5H60" stroke="#d7ad57" strokeOpacity="0.4" strokeWidth="1"/>
                    </svg>
                  </div>
                  <h2
                    className="text-2xl font-black leading-none mb-4"
                    style={{
                      fontFamily: '"Cinzel", Georgia, serif',
                      background: "linear-gradient(135deg, #fceabb, #d7ad57, #c96b1b)",
                      WebkitBackgroundClip: "text",
                      color: "transparent",
                      textShadow: "0 4px 12px rgba(0,0,0,0.5)",
                    }}
                  >
                    Find Your Block
                  </h2>
                  <p className="text-[10px] font-semibold tracking-[0.15em] text-[#d7ad57] uppercase">
                    Locate an inscription
                  </p>
                </div>
                
                <div className="mb-8">
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-r from-[#c58c38]/20 to-[#d7ad57]/20 rounded-lg blur-sm pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        const value = e.target.value;
                        setSearchQuery(value);
                        setSearchSubmitted(false);
                        if (!value.trim()) {
                          setSearchResults([]);
                          setSearchMeta(SEARCH_PLACEHOLDER_META);
                        }
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
                      placeholder="Name, mobile or serial..."
                      className="relative w-full bg-[#1a0407]/90 border border-[#c58c38]/50 rounded-lg px-4 py-3.5 pr-11 text-sm text-[#ffe2b6] placeholder-[#d7ad57]/50 focus:outline-none focus:border-[#fceabb] focus:ring-1 focus:ring-[#fceabb] transition-all shadow-inner text-center"
                      style={{ fontSize: '16px' }}
                    />
                    <svg className="w-5 h-5 absolute right-4 top-1/2 -translate-y-1/2 text-[#d7ad57] pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => void runSearch()}
                      disabled={searchLoading}
                      className="flex-1 px-3 py-2.5 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all disabled:opacity-60 active:scale-[0.99]"
                      style={{ background: "linear-gradient(135deg, #c96b1b, #8a5a19)", color: "#fff5e7", border: "1px solid rgba(255,218,159,0.3)", fontFamily: '"Cinzel", Georgia, serif' }}
                    >
                      {searchLoading ? "Searching..." : "Search"}
                    </button>
                    <button
                      type="button"
                      onClick={clearGlobalSearch}
                      className="px-3 py-2.5 rounded-lg text-[11px] font-bold tracking-widest uppercase"
                      style={{ background: "rgba(255,246,233,0.08)", border: "1px solid rgba(228,180,121,0.26)", color: "#ffe9cc", fontFamily: '"Cinzel", Georgia, serif' }}
                    >
                      Clear
                    </button>
                  </div>
                  <p className="text-[10px] mt-2 text-center" style={{ color: "rgba(245,232,216,0.7)" }}>{searchMeta}</p>
                  {searchResults.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {searchResults.map((result, index) => (
                        <button
                          key={`m-${result.kind}-${result.block_id}-${result.label}-${result.serial_number ?? index}`}
                          type="button"
                          onClick={() => void openBlock(result.block_id, result.label)}
                          className="w-full text-left px-3 py-2 rounded-lg transition-all active:scale-[0.99]"
                          style={{ background: "rgba(255,246,233,0.06)", border: "1px solid rgba(228,180,121,0.2)" }}
                        >
                          <div className="text-sm font-semibold truncate" style={{ color: "#fff5e7" }}>{result.label}</div>
                          <div className="text-[10px] truncate" style={{ color: "rgba(245,232,216,0.7)" }}>
                            Block <span className="font-bold" style={{ color: "#fceabb" }}>{result.block_id}</span>
                            {result.serial_number ? ` · ${result.serial_number}` : ""}
                            {result.subtitle ? ` · ${result.subtitle}` : ""}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {!searchLoading && searchSubmitted && searchResults.length === 0 && searchQuery.trim().length >= 2 && (
                    <div className="mt-3 rounded-lg px-3 py-2 text-xs text-center" style={{ background: "rgba(255,246,233,0.06)", border: "1px solid rgba(228,180,121,0.2)", color: "#ffe9cc" }}>
                      No matching inscription found.
                    </div>
                  )}
                </div>

                <div className="mt-8 relative bg-[#1a0407]/80 p-5 rounded-xl border border-[#c58c38]/20 shadow-inner overflow-hidden">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#d7ad57]/5 via-transparent to-transparent pointer-events-none" />
                  
                  <div className="relative z-10 space-y-5 text-center">
                    <div>
                      <p className="text-[9px] font-bold tracking-[0.2em] uppercase mb-1" style={{ color: "#a88e6f" }}>
                        Names Inscribed
                      </p>
                      <p className="text-2xl font-bold tracking-wide" style={{ 
                          fontFamily: '"Cinzel", Georgia, serif',
                          background: "linear-gradient(135deg, #fceabb, #d7ad57)",
                          WebkitBackgroundClip: "text",
                          color: "transparent",
                          textShadow: "0 2px 10px rgba(215,173,87,0.3)"
                      }}>
                        {formatINR(totalNames)}
                      </p>
                    </div>
                    
                    <div className="flex justify-center items-center py-1">
                      <div className="w-10 h-px bg-gradient-to-r from-transparent via-[#d7ad57]/40 to-transparent" />
                      <div className="w-1 h-1 rotate-45 bg-[#d7ad57]/50 mx-2" />
                      <div className="w-10 h-px bg-gradient-to-r from-transparent via-[#d7ad57]/40 to-transparent" />
                    </div>
                    
                    <div>
                      <p className="text-[9px] font-bold tracking-[0.2em] uppercase mb-1" style={{ color: "#a88e6f" }}>
                        Amount Raised
                      </p>
                      <p className="text-2xl font-bold tracking-wide" style={{ 
                          fontFamily: '"Cinzel", Georgia, serif',
                          background: "linear-gradient(135deg, #fceabb, #d7ad57)",
                          WebkitBackgroundClip: "text",
                          color: "transparent",
                          textShadow: "0 2px 10px rgba(215,173,87,0.3)"
                      }}>
                        ₹{formatINR(totalCollected)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Canvas Centering Container */}
        {/* Canvas Centering Container — on mobile, when block focused, show full scrollable focused view */}
        {focusedBlock ? (
          /* ── Mobile Focused Block Full View ── */
          <div className="flex-1 w-full flex flex-col overflow-y-auto md:hidden px-4 pt-4 pb-8 gap-4">
            {/* Header: block title or focused name + back button */}
            <div className="flex items-center justify-between gap-3">
              {highlightName ? (
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(66,44,25,0.7)" }}>In Focus · Block {focusedBlock}</p>
                  <h2 className="text-lg font-black truncate" style={{ fontFamily: '"Cinzel", Georgia, serif', color: "#3a1c0d", textShadow: "0 1px 8px rgba(255,255,255,0.8)" }}>{highlightName}</h2>
                </div>
              ) : (
                <div>
                  <h2 className="text-lg font-black" style={{ fontFamily: '"Cinzel", Georgia, serif', color: "#3a1c0d", textShadow: "0 1px 8px rgba(255,255,255,0.8)" }}>Block {focusedBlock}</h2>
                  {focusData && (
                    <div className="flex gap-3 mt-0.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "rgba(66,44,25,0.7)" }}>Used: <span style={{ color: "#3a1c0d" }}>{focusData.total_used}</span></span>
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "rgba(66,44,25,0.7)" }}>Left: <span style={{ color: "#3a1c0d" }}>{focusData.remaining}</span></span>
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={highlightName ? () => { setFocusedBlock(null); setFocusData(null); setHighlightName(null); setNameSearchQuery(""); setNameFilterQuery(""); } : closeBlock}
                className="px-4 py-2 rounded-md text-xs font-bold tracking-widest uppercase shrink-0"
                style={{ background: "linear-gradient(180deg, rgba(50,10,15,0.95), rgba(25,5,8,0.98))", color: "#e6c18a", fontFamily: '"Cinzel", Georgia, serif', border: "1px solid rgba(215,173,87,0.4)" }}
              >
                ← {highlightName ? 'Back to Search' : 'Back'}
              </button>
            </div>
            {/* Single block canvas — only shown when a name is in focus */}
            {highlightName && (
              <div className="w-full rounded-2xl overflow-hidden shrink-0" style={{ aspectRatio: '1/1', minHeight: 'min(65vh, 92vw)', background: "#0a0604", boxShadow: "0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(201,107,27,0.3)" }}>
                <WallFrame blocks={blocks} singleBlockId={focusedBlock} highlightName={highlightName} className="w-full h-full" />
              </div>
            )}
            {/* Inscription details — shown when a name is in focus */}
            {highlightName && (() => {
              const totalQty = highlightSubmissions.reduce((sum, s) => sum + (s.qty || 0), 0);
              const totalAmt = highlightSubmissions.reduce((sum, s) => sum + (s.amount || 0), 0);
              const fmtDate = (iso: string) => {
                const d = new Date(iso);
                return isNaN(d.getTime()) ? "—" : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
              };
              const fmtMethod = (m: string | null | undefined) => {
                if (!m) return "—";
                const lower = m.toLowerCase();
                if (lower === "online") return "Online";
                if (lower === "cash") return "Cash";
                if (lower === "upi") return "UPI";
                return m.charAt(0).toUpperCase() + m.slice(1);
              };
              return (
                <div className="flex flex-col gap-3 p-4 rounded-2xl" style={{ background: "linear-gradient(180deg, rgba(40,8,12,0.95), rgba(20,4,6,0.98))", border: "1px solid rgba(215,173,87,0.3)" }}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.9)" }}>Inscription Details</p>
                    {highlightSubmissions.length > 1 && (
                      <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.7)" }}>{highlightSubmissions.length} donations</span>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-start gap-3 px-3 py-2 rounded-lg" style={{ background: "rgba(255,246,233,0.06)", border: "1px solid rgba(228,180,121,0.18)" }}>
                      <span className="text-[10px] font-bold tracking-wider uppercase shrink-0" style={{ color: "rgba(215,173,87,0.85)" }}>Name</span>
                      <span className="text-sm font-extrabold text-right break-words" style={{ color: "#fff5e7" }}>{highlightName}</span>
                    </div>
                    <div className="flex justify-between items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "rgba(255,246,233,0.06)", border: "1px solid rgba(228,180,121,0.18)" }}>
                      <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Block</span>
                      <span className="text-sm font-extrabold" style={{ color: "#fff5e7" }}>{focusedBlock}</span>
                    </div>
                    <div className="flex justify-between items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "rgba(255,246,233,0.06)", border: "1px solid rgba(228,180,121,0.18)" }}>
                      <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Slots Inscribed</span>
                      <span className="text-sm font-extrabold" style={{ color: "#fff5e7" }}>{totalQty}</span>
                    </div>
                    <div className="flex justify-between items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "rgba(215,173,87,0.12)", border: "1px solid rgba(215,173,87,0.28)" }}>
                      <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.95)" }}>Amount Donated</span>
                      <span className="text-sm font-extrabold" style={{ color: "#fceabb" }}>₹{formatINR(totalAmt)}</span>
                    </div>
                  </div>

                  {highlightSubmissionsLoading && highlightSubmissions.length === 0 && (
                    <p className="text-xs text-center" style={{ color: "rgba(215,173,87,0.7)" }}>Loading donation details…</p>
                  )}

                  {highlightSubmissions.length === 0 && !highlightSubmissionsLoading && (
                    <p className="text-xs text-center" style={{ color: "rgba(215,173,87,0.7)" }}>No detailed donation record on file.</p>
                  )}

                  {highlightSubmissions.map((s) => (
                    <div key={s.id} className="flex flex-col gap-2 p-3 rounded-xl" style={{ background: "rgba(255,246,233,0.04)", border: "1px solid rgba(228,180,121,0.18)" }}>
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Serial No.</span>
                        <span className="text-xs font-bold break-all text-right" style={{ color: "#fceabb" }}>{s.serial_number ?? "—"}</span>
                      </div>
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Type</span>
                        <span className="text-xs font-bold uppercase" style={{ color: "#fff5e7" }}>{s.action_type === "pledge" ? "Pledge" : "Donation"}</span>
                      </div>
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Payment</span>
                        <span className="text-xs font-bold" style={{ color: "#fff5e7" }}>{fmtMethod(s.payment_method)}</span>
                      </div>
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Slots</span>
                        <span className="text-xs font-bold" style={{ color: "#fff5e7" }}>{s.qty}</span>
                      </div>
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Amount</span>
                        <span className="text-xs font-bold" style={{ color: "#fceabb" }}>₹{formatINR(s.amount)}</span>
                      </div>
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Date</span>
                        <span className="text-xs font-bold" style={{ color: "#fff5e7" }}>{fmtDate(s.created_at)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReceiptOverlay(s)}
                        className="mt-1 w-full inline-flex items-center justify-center gap-2 py-2 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all hover:brightness-110 active:scale-[0.99]"
                        style={{ background: "linear-gradient(135deg, #d77a26 0%, #8a3a0a 60%, #5a2308 100%)", color: "#fff5e7", border: "1px solid rgba(252,234,187,0.5)", boxShadow: "0 6px 14px rgba(201,107,27,0.4), inset 0 1px 0 rgba(252,234,187,0.4)", fontFamily: '"Cinzel", Georgia, serif', textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        View Receipt
                      </button>
                      <a
                        href={`https://pdf-gen-sbvt.onrender.com/download-ticket?name=${encodeURIComponent(s.name)}&qty=${s.qty}&block=${encodeURIComponent(focusedBlock!)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full inline-flex items-center justify-center gap-2 py-2 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-all hover:brightness-110 active:scale-[0.99]"
                        style={{ background: "linear-gradient(135deg, #b08124 0%, #6b4a12 60%, #3f2a08 100%)", color: "#fff5e7", border: "1px solid rgba(252,234,187,0.5)", boxShadow: "0 6px 14px rgba(176,129,36,0.4), inset 0 1px 0 rgba(252,234,187,0.4)", fontFamily: '"Cinzel", Georgia, serif', textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                        View Certificate
                      </a>
                    </div>
                  ))}
                </div>
              );
            })()}
            {/* Donor form card — hidden when a name is in focus */}
            {!highlightName && (
            <div className="flex flex-col gap-4 p-5 rounded-2xl" style={{ background: "linear-gradient(180deg, rgba(40,8,12,0.95), rgba(20,4,6,0.98))", border: "1px solid rgba(215,173,87,0.3)", boxShadow: "0 18px 48px rgba(0,0,0,0.45), inset 0 1px 0 rgba(252,234,187,0.08)" }}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-black tracking-[0.18em] uppercase" style={{ fontFamily: '"Cinzel", Georgia, serif', background: "linear-gradient(135deg, #fceabb, #d7ad57)", WebkitBackgroundClip: "text", color: "transparent" }}>New Donor</p>
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] px-2 py-1 rounded-md" style={{ background: "rgba(201,107,27,0.18)", color: "#fceabb", border: "1px solid rgba(252,234,187,0.25)" }}>Block {focusedBlock}</span>
              </div>
              <div className="flex gap-3">
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Name</label>
                  <input value={formName} onChange={e => setFormName(e.target.value)} maxLength={40} placeholder="Donor name" className="w-full px-3 py-3 rounded-lg outline-none focus:ring-2" style={{ background: "rgba(255,250,244,0.98)", border: "1px solid rgba(222,182,131,0.4)", color: "#2a1509", fontSize: '16px' }} />
                </div>
                <div className="w-20 flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Qty</label>
                  <input type="text" value={formQtyInput} inputMode="numeric" maxLength={4} onChange={e => setFormQtyInput(e.target.value.replace(/\D/g, ""))} className="w-full px-3 py-3 rounded-lg outline-none text-center font-bold" style={{ background: "rgba(255,250,244,0.98)", border: "1px solid rgba(222,182,131,0.4)", color: "#2a1509", fontSize: '16px' }} />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Mobile Number</label>
                <div className="flex gap-2">
                  <select value={formPhoneCode} onChange={e => setFormPhoneCode(e.target.value)} className="w-24 px-2 py-3 rounded-lg outline-none font-semibold" style={{ background: "rgba(255,250,244,0.98)", border: "1px solid rgba(222,182,131,0.4)", color: "#2a1509", fontSize: '16px' }}>
                    {COUNTRY_CODES.map(c => <option key={`mph-${c.name}`} value={c.code}>{c.name} ({c.code})</option>)}
                  </select>
                  <input type="tel" value={formPhone} onChange={e => handlePhoneChange(e.target.value)} maxLength={20} placeholder="Phone number" inputMode="numeric" className="flex-1 px-3 py-3 rounded-lg outline-none" style={{ background: "rgba(255,250,244,0.98)", border: "1px solid rgba(222,182,131,0.4)", color: "#2a1509", fontSize: '16px' }} />
                </div>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer select-none px-3 py-2 rounded-lg" style={{ background: "rgba(255,246,233,0.05)", border: "1px solid rgba(228,180,121,0.18)" }}>
                <input type="checkbox" checked={formSamePhone} onChange={e => handleSamePhoneChange(e.target.checked)} className="w-4 h-4 accent-[#c96b1b]" />
                <span className="text-xs font-semibold" style={{ color: "#ffe2b6" }}>WhatsApp same as phone</span>
              </label>
              {!formSamePhone && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>WhatsApp Number</label>
                  <div className="flex gap-2">
                    <select value={formWaCode} onChange={e => setFormWaCode(e.target.value)} className="w-24 px-2 py-3 rounded-lg outline-none font-semibold" style={{ background: "rgba(255,250,244,0.98)", border: "1px solid rgba(222,182,131,0.4)", color: "#2a1509", fontSize: '16px' }}>
                      {COUNTRY_CODES.map(c => <option key={`mwa-${c.name}`} value={c.code}>{c.name} ({c.code})</option>)}
                    </select>
                    <input type="tel" value={formWa} onChange={e => setFormWa(e.target.value)} maxLength={20} placeholder="WhatsApp" className="flex-1 px-3 py-3 rounded-lg outline-none" style={{ background: "rgba(255,250,244,0.98)", border: "1px solid rgba(222,182,131,0.4)", color: "#2a1509", fontSize: '16px' }} />
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Date of Birth <span style={{ color: "rgba(215,173,87,0.55)" }}>(optional)</span></label>
                <input type="date" value={formDob} onChange={e => setFormDob(e.target.value)} className="px-3 py-3 rounded-lg outline-none" style={{ background: "rgba(255,250,244,0.98)", border: "1px solid rgba(222,182,131,0.4)", color: "#2a1509", fontSize: '16px' }} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: "rgba(215,173,87,0.85)" }}>Email <span style={{ color: "#f6a05a" }}>*</span></label>
                <input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} maxLength={80} placeholder="Email address" className="px-3 py-3 rounded-lg outline-none" style={{ background: "rgba(255,250,244,0.98)", border: "1px solid rgba(222,182,131,0.4)", color: "#2a1509", fontSize: '16px' }} />
              </div>
              <div className="flex justify-between items-center px-4 py-3 rounded-lg" style={{ background: "linear-gradient(135deg, rgba(201,107,27,0.18), rgba(138,90,25,0.1))", border: "1px solid rgba(252,234,187,0.3)", boxShadow: "inset 0 1px 0 rgba(252,234,187,0.12)" }}>
                <span className="text-[11px] font-bold tracking-[0.2em] uppercase" style={{ color: "rgba(252,234,187,0.9)" }}>Total</span>
                <span className="text-base font-extrabold" style={{ color: "#fceabb", fontFamily: '"Cinzel", Georgia, serif' }}>₹{formatINR(totalAmount)}</span>
              </div>
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-[10px] leading-snug" style={{ background: "rgba(224,184,96,0.1)", border: "1px solid rgba(224,184,96,0.28)", color: "rgba(255,230,170,0.9)" }}>
                <span className="shrink-0 mt-px">⚠️</span>
                <span>Some banks have issues with net banking. Use UPI or card.</span>
              </div>
              <button className="w-full py-2.5 rounded-lg text-sm font-bold tracking-wider uppercase transition-all hover:brightness-110 active:scale-[0.99]" style={{ background: "linear-gradient(135deg, #d77a26 0%, #8a3a0a 60%, #5a2308 100%)", color: "#fff5e7", border: "1px solid rgba(252,234,187,0.5)", boxShadow: "0 8px 20px rgba(201,107,27,0.45), inset 0 1px 0 rgba(252,234,187,0.4)", fontFamily: '"Cinzel", Georgia, serif', textShadow: "0 1px 2px rgba(0,0,0,0.5)", opacity: paymentLoading || submitting ? 0.7 : 1 }} disabled={paymentLoading || submitting} onClick={() => void handlePayOnline()}>
                {paymentLoading ? <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-r-transparent" />Redirecting</span> : "Pay Online"}
              </button>
              {paymentError && <div className="flex items-center gap-2 text-xs p-2 rounded-lg" style={{ background: "rgba(220,110,90,0.12)", border: "1px solid rgba(220,110,90,0.25)", color: "#ffd7d0" }}><p className="flex-1">{paymentError}</p><button type="button" className="px-2 py-1 rounded text-xs font-bold shrink-0" style={{ background: "rgba(255,246,233,0.1)", border: "1px solid rgba(228,180,121,0.26)", color: "#ffe9cc" }} onClick={() => void handlePayOnline()} disabled={paymentLoading}>Retry</button></div>}
              {formStatus && <p className="text-xs" style={{ color: "#f6d8af" }}>{formStatus}</p>}
            </div>
            )}
          </div>
        ) : null}
        <div className={`flex-1 w-full relative flex-col items-center justify-start overflow-y-auto md:overflow-hidden ${(focusedBlock || mobileTab !== 'new-donor') ? 'hidden md:flex' : 'flex mt-[70px]'} md:mt-0 pb-8 md:pb-0`}>
              {/* ── Wall Frame View (always shown on desktop; mobile when no focused block & new-donor tab) ── */}
              <div className="flex-1 w-full flex flex-col items-center">
                {/* Instructions Header */}
                {!isBooting && (
                  <motion.div className="relative left-0 right-0 px-4 md:px-12 flex flex-col md:flex-row justify-between items-center z-10 gap-2 md:gap-3 py-6 md:py-4 md:mt-4 w-full" initial={{ opacity: 0, y: -15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.3 }}>
                    <div className={`${highlightName ? 'hidden md:hidden' : 'flex md:flex'} items-center gap-3 w-full justify-center md:justify-start`}>
                      <svg className="hidden md:block w-5 h-5 shrink-0" style={{ color: "#c96b1b" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      <p className="text-[11px] md:text-base font-bold tracking-widest text-center md:text-left leading-relaxed" style={{ color: "#3a1c0d", fontFamily: '"Cinzel", Georgia, serif', textShadow: "0 1px 12px rgba(255,255,255,0.9), 0 0 4px rgba(255,255,255,1)" }}>
                        {focusedBlock
                          ? <>Block <span className="text-sm md:text-xl font-black align-baseline" style={{ color: "#8a3a0a", letterSpacing: "0.04em" }}>{focusedBlock}</span> is selected for you to inscribe your name on</>
                          : "Choose a block to inscribe your name on the Wall of Legacy"}
                      </p>
                    </div>
                    {focusedBlock ? (
                      !highlightName && (
                        <button onClick={closeBlock} className="hidden md:inline-flex items-center gap-2 px-6 py-2 rounded-md text-xs font-bold tracking-widest uppercase transition-all shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 whitespace-nowrap" style={{ background: "linear-gradient(180deg, rgba(50,10,15,0.95), rgba(25,5,8,0.98))", color: "#e6c18a", fontFamily: '"Cinzel", Georgia, serif', border: "1px solid rgba(215,173,87,0.4)" }}>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                          Search your name
                        </button>
                      )
                    ) : (
                      <button onClick={() => { const available: string[] = []; blocks.forEach((b, id) => { if (b.remaining > 0) available.push(id); }); if (available.length === 0) return; const randomId = available[Math.floor(Math.random() * available.length)]; void openBlock(randomId); }} className="hidden md:block px-6 py-2 rounded-md text-xs font-bold tracking-widest uppercase transition-all shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 whitespace-nowrap" style={{ background: "linear-gradient(180deg, rgba(50,10,15,0.95), rgba(25,5,8,0.98))", color: "#e6c18a", fontFamily: '"Cinzel", Georgia, serif', border: "1px solid rgba(215,173,87,0.4)" }}>Select Random Block</button>
                    )}
                  </motion.div>
                )}
                {/* Main wall frame — mounts as soon as data is ready so canvas can paint behind the LoadingScreen */}
                {dataReady && (
                  <motion.div className="relative w-[min(80vh,90vw)] md:w-[min(75vh,calc(100vw-30rem))] mt-2 md:mt-4" style={{ aspectRatio: '1/1' }} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45, ease: "easeOut" }}>
                    {(() => {
                      const fc = focusedBlock ? focusedBlock.charAt(0) : null;
                      const fr = focusedBlock ? parseInt(focusedBlock.slice(1), 10) : null;
                      const activePill: React.CSSProperties = {
                        color: "#fff5e7",
                        background: "linear-gradient(135deg, #c96b1b, #5a2308)",
                        padding: "1px 6px",
                        borderRadius: "5px",
                        border: "1px solid rgba(252,234,187,0.85)",
                        boxShadow: "0 0 10px rgba(201,107,27,0.85), 0 2px 4px rgba(0,0,0,0.4)",
                        fontWeight: 900,
                        fontFamily: '"Cinzel", Georgia, serif',
                        textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                        display: "inline-block",
                        minWidth: "1.5em",
                        textAlign: "center",
                        lineHeight: 1.15,
                      };
                      const inactiveLabel: React.CSSProperties = { color: "rgba(58,28,13,0.85)", textShadow: "0 1px 4px rgba(255,255,255,0.7)" };
                      return (
                        <>
                          {/* Column labels — fixed strip above the wall, anchored to wall's outer top edge */}
                          <div className="absolute left-0 right-0 grid z-10" style={{ bottom: "100%", height: "1.6rem", marginBottom: "0.2rem", gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)` }}>
                            {COL_LABELS.map((label, i) => {
                              const active = label === fc;
                              return (
                                <motion.span
                                  key={`col-${label}`}
                                  className="flex items-end justify-center text-[10px] md:text-sm font-bold tracking-wider"
                                  initial={{ opacity: 0, y: 8 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: 0.4 + i * 0.02 }}
                                >
                                  <span style={active ? activePill : inactiveLabel}>{label}</span>
                                </motion.span>
                              );
                            })}
                          </div>
                          {/* Row labels — fixed strip left of the wall, content right-aligned so the active pill grows leftward */}
                          <div className="absolute top-0 bottom-0 grid z-10" style={{ right: "100%", width: "2.2rem", marginRight: "0.2rem", gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)` }}>
                            {Array.from({ length: GRID_SIZE }, (_, i) => {
                              const active = (i + 1) === fr;
                              return (
                                <motion.span
                                  key={`row-${i + 1}`}
                                  className="flex items-center justify-end text-[10px] md:text-sm font-bold tracking-wider"
                                  initial={{ opacity: 0, x: 8 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: 0.4 + i * 0.02 }}
                                >
                                  <span style={active ? activePill : inactiveLabel}>{i + 1}</span>
                                </motion.span>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                    <div className="w-full h-full relative z-20 rounded-xl overflow-hidden animate-gold-bg p-2.5 md:p-6" style={{ boxShadow: "0 40px 80px -10px rgba(0,0,0,0.7), 0 0 50px rgba(215,173,87,0.4), inset 0 0 12px rgba(255,255,255,0.6), inset 0 0 25px rgba(0,0,0,0.9)", isolation: "isolate", transform: "translateZ(0)" }}>
                      <div className="absolute inset-0 overflow-hidden pointer-events-none z-10 rounded-xl"><div className="absolute top-0 bottom-0 w-[50%] animate-gold-sheen" style={{ background: "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.1) 45%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0.1) 55%, transparent 70%)" }} /></div>
                      <div className="absolute inset-0 pointer-events-none rounded-xl z-0" style={{ backgroundImage: FRAME_PATTERN, mixBlendMode: "overlay" }} />
                      <div className="w-full h-full relative p-1 md:p-2 rounded z-20" style={{ background: "linear-gradient(to bottom right, rgba(0,0,0,0.6), rgba(0,0,0,0.3))", boxShadow: "inset 0 0 10px rgba(0,0,0,0.8), 0 0 5px rgba(255,255,255,0.2)" }}>
                        <CornerOrnament className="absolute -top-0.5 -left-0.5 md:-top-1 md:-left-1 w-6 h-6 md:w-12 md:h-12 drop-shadow-md" />
                        <CornerOrnament className="absolute -top-0.5 -right-0.5 md:-top-1 md:-right-1 rotate-90 w-6 h-6 md:w-12 md:h-12 drop-shadow-md" />
                        <CornerOrnament className="absolute -bottom-0.5 -right-0.5 md:-bottom-1 md:-right-1 rotate-180 w-6 h-6 md:w-12 md:h-12 drop-shadow-md" />
                        <CornerOrnament className="absolute -bottom-0.5 -left-0.5 md:-bottom-1 md:-left-1 -rotate-90 w-6 h-6 md:w-12 md:h-12 drop-shadow-md" />
                        <div className="w-full h-full rounded-sm overflow-hidden relative z-10" style={{ border: "var(--wall-frame-border) solid rgba(24,12,6,0.95)", boxShadow: "inset 0 0 var(--wall-frame-shadow) rgba(0,0,0,0.9), 0 0 15px rgba(0,0,0,0.8)" }}>
                          <WallFrame blocks={blocks} singleBlockId={highlightName ? focusedBlock : null} selectedBlockId={highlightName ? null : focusedBlock} highlightName={highlightName} className={`w-full h-full pointer-events-none md:pointer-events-auto ${blockSwitching ? 'md:!pointer-events-none' : ''}`} onBlockClick={handleWallBlockClick} onBlockHover={handleWallBlockHover} onFirstPaint={handleWallFirstPaint} />
                          <AnimatePresence>
                            {blockSwitching && (
                              <motion.div
                                key="block-switching-overlay"
                                className="absolute inset-0 z-30 flex items-center justify-center pointer-events-auto"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                style={{ background: "rgba(10,5,2,0.45)", backdropFilter: "blur(2px)" }}
                              >
                                <div className="flex flex-col items-center gap-3 px-5 py-4 rounded-lg" style={{ background: "rgba(20,8,12,0.85)", border: "1px solid rgba(215,173,87,0.45)", boxShadow: "0 10px 40px rgba(0,0,0,0.6)" }}>
                                  <div className="h-7 w-7 rounded-full border-[3px] animate-spin" style={{ borderColor: "rgba(252,234,187,0.25)", borderTopColor: "#fceabb" }} />
                                  <span className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: "#fceabb", fontFamily: '"Cinzel", Georgia, serif' }}>Loading Block</span>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                          <AnimatePresence>{mobileCol && (<motion.div className="absolute top-0 bottom-0 pointer-events-none z-20 md:hidden" style={{ width: `${100 / GRID_SIZE}%`, left: 0, background: "rgba(252,234,187,0.15)", borderLeft: "2px solid rgba(252,234,187,0.6)", borderRight: "2px solid rgba(252,234,187,0.6)" }} initial={{ opacity: 0, x: `${COL_LABELS.indexOf(mobileCol) * 100}%` }} animate={{ opacity: 1, x: `${COL_LABELS.indexOf(mobileCol) * 100}%` }} exit={{ opacity: 0 }} transition={{ type: "tween", ease: "easeOut", duration: 0.25 }} />)}</AnimatePresence>
                          <AnimatePresence>{mobileRow && (<motion.div className="absolute left-0 right-0 pointer-events-none z-20 md:hidden" style={{ height: `${100 / GRID_SIZE}%`, top: 0, background: "rgba(252,234,187,0.15)", borderTop: "2px solid rgba(252,234,187,0.6)", borderBottom: "2px solid rgba(252,234,187,0.6)" }} initial={{ opacity: 0, y: `${(mobileRow - 1) * 100}%` }} animate={{ opacity: 1, y: `${(mobileRow - 1) * 100}%` }} exit={{ opacity: 0 }} transition={{ type: "tween", ease: "easeOut", duration: 0.25 }} />)}</AnimatePresence>
                          <AnimatePresence>{(mobileCol && mobileRow) && (<motion.div className="absolute pointer-events-none z-30 border-2 md:hidden" style={{ width: `${100 / GRID_SIZE}%`, height: `${100 / GRID_SIZE}%`, left: 0, top: 0, background: "rgba(252,234,187,0.35)", borderColor: "rgba(252,234,187,1)", boxShadow: "0 0 20px rgba(252,234,187,0.8), inset 0 0 10px rgba(252,234,187,0.4)" }} initial={{ opacity: 0, scale: 0.8, x: `${COL_LABELS.indexOf(mobileCol) * 100}%`, y: `${(mobileRow - 1) * 100}%` }} animate={{ opacity: 1, scale: 1, x: `${COL_LABELS.indexOf(mobileCol) * 100}%`, y: `${(mobileRow - 1) * 100}%` }} exit={{ opacity: 0, scale: 0.8 }} transition={{ type: "tween", ease: "easeOut", duration: 0.25 }} />)}</AnimatePresence>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
                {/* Helper Text and Mobile Selector below frame */}
                {!isBooting && (
                  <motion.div className="mt-3 z-10 w-full px-6 flex flex-col items-center" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.6 }}>
                    {!highlightName && (
                      <p className="hidden md:block text-sm tracking-widest uppercase font-bold" style={{ color: "#3a1c0d", fontFamily: '"Cinzel", Georgia, serif', textShadow: "0 1px 4px rgba(255,255,255,0.4)" }}>
                        {focusedBlock
                          ? <>Block <span style={{ color: "#8a3a0a" }}>{focusedBlock}</span> is selected. Click on any other block to change selection</>
                          : "Select a block from the frame above"}
                      </p>
                    )}
                    <div className="md:hidden flex flex-col items-center w-full max-w-sm mx-auto min-h-[120px]">
                      <p className="text-xs mb-3 tracking-[0.15em] uppercase font-black" style={{ color: "#3a1c0d", fontFamily: '"Cinzel", Georgia, serif' }}>{mobileCol && mobileRow ? `Your name will appear in block ${mobileCol}${mobileRow}` : 'Select block below'}</p>
                      <div className="flex w-full gap-3">
                        <select className="flex-1 bg-[#2a060a]/90 border border-[#c58c38]/50 rounded px-3 py-2.5 text-xs font-bold text-[#ffe2b6] focus:outline-none focus:border-[#fceabb] shadow-inner appearance-none" value={mobileCol || ""} onChange={(e) => { setMobileCol(e.target.value || null); setMobileRow(null); }} style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fceabb' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center', backgroundSize: '1em', fontSize: '16px' }}><option value="">Select Column</option>{COL_LABELS.map(l => <option key={l} value={l}>Column {l}</option>)}</select>
                        <select className="flex-1 bg-[#2a060a]/90 border border-[#c58c38]/50 rounded px-3 py-2.5 text-xs font-bold text-[#ffe2b6] focus:outline-none focus:border-[#fceabb] shadow-inner appearance-none disabled:opacity-50" value={mobileRow || ""} onChange={(e) => setMobileRow(e.target.value ? Number(e.target.value) : null)} disabled={!mobileCol} style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fceabb' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center', backgroundSize: '1em', fontSize: '16px' }}><option value="">Select Row</option>{Array.from({ length: GRID_SIZE }, (_, i) => <option key={i+1} value={i+1}>Row {i+1}</option>)}</select>
                      </div>
                      <AnimatePresence>{(mobileCol || mobileRow) && (() => {
                        const candidateId = mobileCol && mobileRow ? `${mobileCol}${mobileRow}` : null;
                        const candidateBlock = candidateId ? blocks.get(candidateId) : null;
                        const isFull = !!candidateBlock && candidateBlock.remaining <= 0;
                        const ready = !!mobileCol && !!mobileRow && !isFull;
                        return (
                          <motion.div initial={{ opacity: 0, height: 0, marginTop: 0 }} animate={{ opacity: 1, height: 'auto', marginTop: 12 }} exit={{ opacity: 0, height: 0, marginTop: 0 }} className="flex flex-col w-full gap-2 overflow-hidden">
                            {isFull && (
                              <p className="text-[10px] font-bold tracking-widest uppercase text-center" style={{ color: "#c96b1b" }}>Block {candidateId} is full. Pick another block.</p>
                            )}
                            <button className="w-full py-2.5 rounded-md text-[10px] font-bold tracking-widest uppercase shadow-lg transition-all disabled:opacity-75 disabled:cursor-not-allowed" disabled={!ready} style={{ background: ready ? "linear-gradient(135deg, #c96b1b, #8a5a19)" : "rgba(60,15,20,0.8)", color: ready ? "#fff5e7" : "#d7ad57", border: ready ? "1px solid rgba(255,218,159,0.3)" : "1px solid rgba(215,173,87,0.3)" }} onClick={() => { if (ready && candidateId) { void openBlock(candidateId); setMobileCol(null); setMobileRow(null); } }}>Proceed to Donation</button>
                          </motion.div>
                        );
                      })()}</AnimatePresence>
                    </div>
                  </motion.div>
                )}
              </div>
        </div>

        {/* Marquee pinned to the bottom of the right section (Tab/Desktop only) */}
        {!isBooting && (
           <motion.div
             className="hidden md:flex w-full h-14 items-center overflow-hidden z-10 shrink-0"
             style={{
               background: "rgba(255,255,255,0.08)",
               backdropFilter: "blur(12px)",
               borderTop: "1px solid rgba(215,173,87,0.2)",
               boxShadow: "0 -4px 20px rgba(0,0,0,0.15)",
             }}
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.4 }}
           >
             <DonorMarquee blocks={blocks} />
           </motion.div>
        )}
      </div>

      {/* Receipt overlay */}
      <AnimatePresence>
        {receiptOverlay && (
          <motion.div
            key="receipt-overlay"
            className="fixed inset-0 z-[260] flex items-center justify-center p-4 sm:p-6"
            style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => setReceiptOverlay(null)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              className="relative w-full max-w-2xl rounded-2xl p-5 sm:p-8 max-h-[92vh] overflow-y-auto"
              style={{
                background: "rgba(26,14,8,0.96)",
                border: "1px solid rgba(228,180,121,0.3)",
                boxShadow: "0 28px 70px rgba(0,0,0,0.55)",
              }}
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-xs uppercase tracking-[0.18em]" style={{ color: "rgba(255,221,168,0.82)" }}>
                Receipt issued by Kirtan Seva Trust for
              </p>
              <h2 className="text-4xl sm:text-5xl mt-2 pb-4" style={{ color: "#ffd79c", fontFamily: '"Dancing Script", cursive', textShadow: "0 8px 24px rgba(0,0,0,0.35)", borderBottom: "1px solid rgba(228,180,121,0.22)" }}>
                {receiptOverlay.name}
              </h2>
              <h1 className="text-2xl sm:text-3xl font-bold mt-2" style={{ color: "#fff4e3", fontFamily: '"Playfair Display", serif' }}>
                Donation Receipt
              </h1>

              {(() => {
                const fmtMethodFull = (m: string | null | undefined) => {
                  if (!m) return "—";
                  const lower = m.toLowerCase();
                  if (lower === "online") return "Online Payment";
                  if (lower === "cash") return "Cash";
                  if (lower === "upi") return "UPI";
                  if (lower === "pledge") return "Pledge";
                  return m.charAt(0).toUpperCase() + m.slice(1);
                };
                return (
                  <div className="grid sm:grid-cols-2 gap-3 mt-5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "rgba(255,221,168,0.82)" }}>Donor</p>
                      <p style={{ color: "#fff4e3" }}>{receiptOverlay.name}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "rgba(255,221,168,0.82)" }}>Date</p>
                      <p style={{ color: "#fff4e3" }}>{new Date(receiptOverlay.created_at).toLocaleString("en-IN")}</p>
                    </div>
                    {receiptOverlay.serial_number && (
                      <div>
                        <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "rgba(255,221,168,0.82)" }}>Serial Number</p>
                        <p style={{ color: "#fff4e3" }}>{receiptOverlay.serial_number}</p>
                      </div>
                    )}
                    {receiptOverlay.payment_reference && (
                      <div>
                        <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "rgba(255,221,168,0.82)" }}>Transaction ID</p>
                        <p style={{ color: "#fff4e3" }}>{receiptOverlay.payment_reference}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "rgba(255,221,168,0.82)" }}>Total Names</p>
                      <p style={{ color: "#fff4e3" }}>{receiptOverlay.qty}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "rgba(255,221,168,0.82)" }}>Total Amount</p>
                      <p style={{ color: "#fff4e3" }}>₹{formatINR(receiptOverlay.amount)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "rgba(255,221,168,0.82)" }}>Payment Method</p>
                      <p style={{ color: "#fff4e3" }}>{fmtMethodFull(receiptOverlay.payment_method)}</p>
                    </div>
                    {focusedBlock && (
                      <div>
                        <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "rgba(255,221,168,0.82)" }}>Block</p>
                        <p style={{ color: "#fff4e3" }}>{focusedBlock}</p>
                      </div>
                    )}
                    {receiptOverlay.phone && (
                      <div>
                        <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "rgba(255,221,168,0.82)" }}>Phone</p>
                        <p style={{ color: "#fff4e3" }}>{receiptOverlay.phone}</p>
                      </div>
                    )}
                    {receiptOverlay.email && (
                      <div>
                        <p className="text-xs uppercase tracking-[0.1em]" style={{ color: "rgba(255,221,168,0.82)" }}>Email</p>
                        <p style={{ color: "#fff4e3" }}>{receiptOverlay.email}</p>
                      </div>
                    )}
                  </div>
                );
              })()}

              {focusedBlock && (
                <div className="mt-6">
                  <p className="text-xs uppercase tracking-[0.14em] mb-2" style={{ color: "rgba(255,221,168,0.82)" }}>Block Allocation Summary</p>
                  <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(228,180,121,0.2)" }}>
                    <table className="w-full text-sm">
                      <thead style={{ background: "rgba(255,246,233,0.08)" }}>
                        <tr>
                          <th className="text-left px-3 py-2" style={{ color: "#ffe9cc" }}>Block</th>
                          <th className="text-right px-3 py-2" style={{ color: "#ffe9cc" }}>Qty</th>
                          <th className="text-right px-3 py-2" style={{ color: "#ffe9cc" }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ borderTop: "1px solid rgba(228,180,121,0.1)" }}>
                          <td className="px-3 py-2" style={{ color: "#fff4e3" }}>{focusedBlock}</td>
                          <td className="text-right px-3 py-2" style={{ color: "#fff4e3" }}>{receiptOverlay.qty}</td>
                          <td className="text-right px-3 py-2" style={{ color: "#ffd79c" }}>₹{formatINR(receiptOverlay.amount)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="mt-4 rounded-lg p-3 text-center" style={{ background: "rgba(255,246,233,0.05)", border: "1px dashed rgba(228,180,121,0.3)" }}>
                <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "rgba(255,221,168,0.82)" }}>Total Assigned</p>
                <p className="text-xl sm:text-2xl font-bold" style={{ color: "#ffd79c" }}>{receiptOverlay.qty} Names</p>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setReceiptOverlay(null)}
                  className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
                  style={{ background: "rgba(255,246,233,0.1)", border: "1px solid rgba(228,180,121,0.26)", color: "#ffe9cc" }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: "linear-gradient(135deg, #c96b1b, #e0b860)", color: "#fff" }}
                >
                  Save as PDF
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

// Donor Marquee Component (Dark Theme version)
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
      className="inline-flex items-center px-8 text-[1.1rem]"
      style={{
        fontFamily: '"Cinzel", Georgia, serif',
        color: "#3a1c0d",
        whiteSpace: "nowrap",
      }}
    >
      <span className="mr-3 text-sm" style={{ color: "#c96b1b" }}>
        ✦
      </span>
      {name} (₹{formatINR(qty * COST_PER_NAME)})
    </span>
  ));

  if (allDonors.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center h-full">
            <span className="text-xs uppercase tracking-widest font-bold" style={{ color: "rgba(58, 28, 13, 0.6)" }}>Awaiting Today's First Inscription</span>
        </div>
      );
  }

  return (
    <>
      <div 
        className="shrink-0 h-full flex items-center px-6 font-bold uppercase tracking-widest text-[10px] z-20 relative"
        style={{
          background: "linear-gradient(to right, rgba(201,107,27,0.15), rgba(201,107,27,0.05))",
          color: "#c96b1b",
          borderRight: "1px solid rgba(215,173,87,0.2)",
          boxShadow: "4px 0 20px rgba(0,0,0,0.05)",
        }}
      >
        Today's Legacy
      </div>
      <div className="flex-1 overflow-hidden h-full flex items-center relative">
        <div
          ref={containerRef}
          className={`flex whitespace-nowrap ${shouldAnimate ? "" : "w-full justify-start pl-4"}`}
          style={{ animation: shouldAnimate ? `marquee ${duration}s linear infinite` : "none" }}
        >
          <div className="flex whitespace-nowrap">{items}</div>
          {shouldAnimate && items.length > 0 && <div className="flex whitespace-nowrap">{items}</div>}
        </div>
      </div>
    </>
  );
}
