import { formatINR } from "@/lib/mosaic/engine";

/** Paise → "₹1,23,456" (whole rupees, Indian grouping). Client-safe.
 *  Rounds to the nearest rupee — for at-a-glance totals, NOT for figures that
 *  must reconcile to the paise. Use formatPaiseExact for those. */
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  return sign + "₹" + formatINR(Math.round(Math.abs(paise) / 100));
}

/** Paise → "₹1,032.79" — EXACT rupees and paise, Indian grouping, never rounded.
 *  Pure integer math on the stored paise (no float division), so what's shown is
 *  exactly the stored value. Use wherever a figure has to match a statement to the
 *  paise (per-line shares, variances, statement amounts). Client-safe. */
export function formatPaiseExact(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  return sign + "₹" + formatINR(rupees) + "." + String(p).padStart(2, "0");
}

export type DonationType = "general" | "wall_of_legacy";

// The two donation kinds. Wall of Legacy = block_submissions (names on the wall,
// carry block + qty) plus volunteer cash. General = birnagar donation-page gifts
// (variable amount, no block/qty). Early wall donations mislabeled source='web' in
// birnagar are caught by the reference match in the reconciler and never land here
// as birnagar_general, so this mapping is exact.
export function donationTypeOf(sourceType: string): DonationType {
  return sourceType === "birnagar_general" ? "general" : "wall_of_legacy";
}

export const DONATION_TYPE_LABEL: Record<DonationType, string> = {
  general: "General",
  wall_of_legacy: "Wall of Legacy",
};

export const STATUS_LABEL: Record<string, string> = {
  MATCHED: "Matched",
  OVERPAID: "Overpaid",
  UNDERPAID: "Underpaid",
  UNVERIFIED: "Unverified",
  CASH: "Cash",
  SETTLEMENT: "Settlement",
  PLEDGE: "Pledge",
  FAILED_REFUNDED: "Failed / Refunded",
  ORPHAN: "Orphan",
  AMBIGUOUS: "Ambiguous",
};

// Tailwind classes for each status badge — green = money confirmed, amber = needs
// attention, red = money problem, slate/neutral = informational.
export const STATUS_BADGE: Record<string, string> = {
  MATCHED: "bg-green-100 text-green-800 border-green-200",
  OVERPAID: "bg-emerald-100 text-emerald-800 border-emerald-200",
  UNDERPAID: "bg-amber-100 text-amber-800 border-amber-200",
  UNVERIFIED: "bg-yellow-100 text-yellow-800 border-yellow-200",
  CASH: "bg-sky-100 text-sky-800 border-sky-200",
  SETTLEMENT: "bg-cyan-100 text-cyan-800 border-cyan-200",
  PLEDGE: "bg-violet-100 text-violet-800 border-violet-200",
  FAILED_REFUNDED: "bg-red-100 text-red-800 border-red-200",
  ORPHAN: "bg-orange-100 text-orange-800 border-orange-200",
  AMBIGUOUS: "bg-rose-100 text-rose-800 border-rose-200",
};

export function statusBadgeClass(status: string): string {
  return STATUS_BADGE[status] ?? "bg-gray-100 text-gray-700 border-gray-200";
}

// The statuses whose money was reconciled against a gateway/UPI statement line —
// the engine's "received" set (engine.ts §5, summary.ts). A contribution in this
// set has a statement source to drill into, EVEN IF it doesn't personally own a
// ContributionMatch row: when one payment buys several names they share a
// reference group and the match is attached only to the group's primary line.
export const MATCHED_STATUSES: ReadonlySet<string> = new Set(["MATCHED", "OVERPAID", "UNDERPAID"]);

export function isMatchedStatus(status: string): boolean {
  return MATCHED_STATUSES.has(status);
}

// Statuses whose ledger row opens a detail page. Beyond the matched set, UNVERIFIED
// rows are drillable too: they own no statement source yet (the gateway/UPI export
// covering their date hasn't been uploaded), but the contribution + donor / address /
// PAN details are still worth inspecting.
export const DETAIL_STATUSES: ReadonlySet<string> = new Set([...MATCHED_STATUSES, "UNVERIFIED"]);

export function isDetailViewable(status: string): boolean {
  return DETAIL_STATUSES.has(status);
}
