import { prisma } from "@/lib/db/prisma";
import { COST_PER_NAME } from "@/lib/mosaic/engine";
import {
  normalizeWhatsappNumber,
  formatWhatsappDisplay,
  looksLikePhoneNumber,
} from "@/lib/whatsapp-care/phone";

// A number is flagged "needs review" only when it has MORE than this many distinct donor
// names — a handful of family names on one phone is normal; dozens means a volunteer's
// number was reused for bulk entry and the rollup needs a human look.
export const MANY_DONORS_THRESHOLD = 30;

// A number is "awaiting reply" once this long has passed since we last sent it a WoL message
// with no engagement back. Tracks the WolMessageLog send time, not the intake.
export const AWAITING_REPLY_MS = 24 * 60 * 60 * 1000;

// One transaction (donation line) under a WhatsApp number.
//
// `reference` is the REAL transaction identifier resolved in this priority:
//   1. the matched gateway/UPI reference from reconciliation (Contribution → ContributionMatch)
//   2. else BlockSubmission.paymentReference (online txn_id / UPI RRN typed at collection)
//   3. else null — there genuinely is no payment reference (cash / pledge); the UI then shows
//      the type/status instead of the meaningless serialNumber (DON-xx-xx / PLG-xx-xx).
export interface AddressCollectionTxn {
  submissionId: number;
  reference: string | null;
  referenceKind: "gateway" | "upi" | "submission" | null; // where `reference` came from
  serialNumber: string | null;
  donorName: string;
  qty: number;
  amountPaise: number;
  actionType: string; // donate | online_donate | pledge
  paymentMethod: string | null; // cash | upi | online | null
  typeLabel: string; // human label (Online / UPI / Cash / Pledge …)
  status: string | null; // reconciliation status (Contribution.status) or null if not reconciled
  createdAt: string; // ISO
  conflict: boolean; // this reference is also attached to another WhatsApp number
  otherNumbers: string[]; // the other normalized numbers sharing this reference
}

export interface AddressCollectionRow {
  normalizedNumber: string; // canonical grouping key, e.g. "919876543210"
  displayNumber: string;
  donorNames: string[]; // distinct
  multipleDonors: boolean; // >1 distinct donor name (informational)
  manyDonors: boolean; // > MANY_DONORS_THRESHOLD distinct donors — a review trigger
  invalidPhone: boolean; // number doesn't look like a real phone (9999999999 …)
  txns: AddressCollectionTxn[];
  txnCount: number;
  totalQty: number;
  totalAmountPaise: number;
  conflictCount: number; // txns whose reference appears on another number
  unverifiedCount: number; // txns with reconciliation status UNVERIFIED
  hasUnverified: boolean; // unverifiedCount > 0 — a review trigger
  messaged: boolean; // a WhatsAppIntake row exists for this number (in-conversation proxy)
  replied: boolean; // intake progressed past the initial prompt / captured name|address
  lastSentAt: string | null; // most recent WoL outbound template send (ISO), or null
  awaitingReply: boolean; // WoL message sent ≥24h ago with no engagement since
  stalledIncomplete: boolean; // started the flow (awaiting_*) but idle ≥24h, not completed
  intakeStatus: string | null;
  intakeLegalName: string | null;
  intakeAddress: string | null;
  intakePincode: string | null;
  // Annotation (whatsapp_number_annotations), joined by normalizedNumber:
  isInvalid: boolean;
  notes: string | null;
  whatsappStatus: string | null; // 'exists' | 'likely_invalid' | null
  lastDeliveryStatus: string | null;
  lastDeliveryAt: string | null; // ISO
  needsReview: boolean; // manyDonors || invalidPhone || hasUnverified
  reviewReasons: string[]; // human-readable reasons behind needsReview (for tooltips)
}

// Unfiltered per-facet counts across all rows — drives the count shown inside each
// filter chip (like the ledger's status distribution). Always reflects the full set,
// independent of the currently applied filters.
export interface AddressCollectionFacets {
  okay: number; // neither needs review nor flagged invalid
  needsReview: number;
  invalid: number;
  manyDonors: number; // > MANY_DONORS_THRESHOLD donors
  invalidPhone: number; // number doesn't look like a real phone
  unverified: number; // has ≥1 UNVERIFIED transaction
  multipleDonors: number;
  conflicts: number;
  awaitingReply: number; // WoL message sent ≥24h ago, no reply
  stalledIncomplete: number; // started the flow but idle ≥24h, not completed
  messaged: number;
  notMessaged: number;
  replied: number;
  notReplied: number;
}

export interface AddressCollectionResult {
  rows: AddressCollectionRow[];
  generatedAt: string; // ISO
  totals: { numbers: number; txns: number; needsReview: number; invalid: number };
  facets: AddressCollectionFacets;
}

interface GroupAcc {
  key: string;
  names: Set<string>;
  txns: AddressCollectionTxn[];
  seenRefs: Set<string>;
}

const PAISE_PER_NAME = COST_PER_NAME * 100; // COST_PER_NAME is rupees

export function txnTypeLabel(actionType: string, paymentMethod: string | null): string {
  if (actionType === "online_donate") return "Online";
  if (actionType === "pledge") return "Pledge";
  if (actionType === "donate") {
    if (paymentMethod === "upi") return "UPI";
    if (paymentMethod === "cash") return "Cash";
    if (paymentMethod === "online") return "Online";
    return "Donation";
  }
  return actionType || "—";
}

// ── Caching + pagination ─────────────────────────────────────────────────────
// The aggregation scans several whole tables and groups in JS, so paging/searching
// the list would otherwise re-scan everything on every keystroke. We cache the full
// computed result briefly and slice it per request. Mutations (flag/notes, delivery
// webhook) call bustAddressCollectionCache() so changes show immediately.
const CACHE_TTL_MS = 30_000;
const LIST_TXN_PREVIEW = 4; // list rows only render the first few txns

let cache: { at: number; result: AddressCollectionResult } | null = null;

export function bustAddressCollectionCache(): void {
  cache = null;
}

// Full, cached aggregation. Used directly by the detail page; the list goes through
// getAddressCollectionPage below.
export async function getAddressCollection(): Promise<AddressCollectionResult> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.result;
  const result = await computeAddressCollection();
  cache = { at: now, result };
  return result;
}

export interface AddressCollectionPage {
  rows: AddressCollectionRow[];
  total: number; // rows matching the filter (drives pagination)
  page: number;
  pageSize: number;
  totals: AddressCollectionResult["totals"]; // overall, unfiltered
  facets: AddressCollectionFacets; // overall, unfiltered — chip counts
  generatedAt: string;
}

// Row-level facets the list can filter on. Selected `flags` match with OR semantics
// (a row is kept if it matches any selected flag), mirroring the ledger's status
// tags. `messaged` and `replied` are tri-state ("yes" / "no" / unset).
export type AddressCollectionFlag =
  | "okay"
  | "needsReview"
  | "invalid"
  | "manyDonors"
  | "invalidPhone"
  | "unverified"
  | "multipleDonors"
  | "conflicts"
  | "awaitingReply"
  | "stalledIncomplete";

export interface AddressCollectionFilters {
  flags?: AddressCollectionFlag[];
  messaged?: "yes" | "no";
  replied?: "yes" | "no";
}

// A search query plus the row-level filters — the shared input shape for the list,
// export, and the URL-param parser below.
export interface AddressCollectionListQuery extends AddressCollectionFilters {
  q?: string;
}

// Every accepted flag. Single source of truth for both the list and export routes so
// the two never drift (the table and "select all filtered" must match exactly).
export const ALL_ADDRESS_COLLECTION_FLAGS: AddressCollectionFlag[] = [
  "okay",
  "needsReview",
  "invalid",
  "manyDonors",
  "invalidPhone",
  "unverified",
  "multipleDonors",
  "conflicts",
  "awaitingReply",
  "stalledIncomplete",
];

// Parse the list/export query string the same way everywhere: comma-separated `flags`
// (unknown values dropped), tri-state `messaged` / `replied`, and free-text `q`.
export function parseAddressCollectionFilters(sp: URLSearchParams): AddressCollectionListQuery {
  const flags = (sp.get("flags") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is AddressCollectionFlag =>
      ALL_ADDRESS_COLLECTION_FLAGS.includes(s as AddressCollectionFlag),
    );
  const messaged = sp.get("messaged");
  const replied = sp.get("replied");
  return {
    q: sp.get("q") ?? "",
    flags,
    messaged: messaged === "yes" || messaged === "no" ? messaged : undefined,
    replied: replied === "yes" || replied === "no" ? replied : undefined,
  };
}

function matchesFlag(r: AddressCollectionRow, flag: AddressCollectionFlag): boolean {
  switch (flag) {
    case "okay":
      return !r.needsReview && !r.isInvalid;
    case "needsReview":
      return r.needsReview;
    case "invalid":
      return r.isInvalid;
    case "manyDonors":
      return r.manyDonors;
    case "invalidPhone":
      return r.invalidPhone;
    case "unverified":
      return r.hasUnverified;
    case "multipleDonors":
      return r.multipleDonors;
    case "conflicts":
      return r.conflictCount > 0;
    case "awaitingReply":
      return r.awaitingReply;
    case "stalledIncomplete":
      return r.stalledIncomplete;
  }
}

// Apply search + row-level filters. Shared by the paginated list and the full export
// so both honour the same query exactly.
function filterRows(
  rows: AddressCollectionRow[],
  opts: AddressCollectionListQuery,
): AddressCollectionRow[] {
  let out = rows;
  const query = (opts.q ?? "").trim().toLowerCase();
  if (query) {
    const digits = query.replace(/\D/g, "");
    out = out.filter(
      (r) =>
        (digits.length > 0 && r.normalizedNumber.includes(digits)) ||
        r.displayNumber.toLowerCase().includes(query) ||
        r.donorNames.some((n) => n.toLowerCase().includes(query)),
    );
  }

  const flags = opts.flags ?? [];
  if (flags.length) out = out.filter((r) => flags.some((f) => matchesFlag(r, f)));
  if (opts.messaged === "yes") out = out.filter((r) => r.messaged);
  else if (opts.messaged === "no") out = out.filter((r) => !r.messaged);
  if (opts.replied === "yes") out = out.filter((r) => r.replied);
  else if (opts.replied === "no") out = out.filter((r) => !r.replied);
  return out;
}

// Paginated + searchable slice for the list table. Heavy per-row txn arrays are
// trimmed to a small preview since the list only shows the first few — the detail
// page reads the full set separately.
export async function getAddressCollectionPage(
  opts: {
    page?: number;
    pageSize?: number;
  } & AddressCollectionListQuery,
): Promise<AddressCollectionPage> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 25)));
  const full = await getAddressCollection();

  const rows = filterRows(full.rows, opts);
  const total = rows.length;
  const start = (page - 1) * pageSize;
  const slice = rows
    .slice(start, start + pageSize)
    .map((r) => ({ ...r, txns: r.txns.slice(0, LIST_TXN_PREVIEW) }));

  return {
    rows: slice,
    total,
    page,
    pageSize,
    totals: full.totals,
    facets: full.facets,
    generatedAt: full.generatedAt,
  };
}

// One row of the "select all filtered → export" CSV: a number with its donor names
// rolled into a single comma-separated string and the per-number totals.
export interface AddressCollectionExportRow {
  normalizedNumber: string;
  displayNumber: string;
  names: string; // distinct donor names, comma-separated
  nameCount: number;
  txnCount: number;
  totalAmountPaise: number;
}

// Every filtered row (no pagination), flattened for export. Backs "Select all filtered"
// so the client can add the whole matching set to its selection in one request.
export async function getAddressCollectionExport(
  opts: AddressCollectionListQuery,
): Promise<{ rows: AddressCollectionExportRow[]; generatedAt: string }> {
  const full = await getAddressCollection();
  const rows = filterRows(full.rows, opts).map((r) => ({
    normalizedNumber: r.normalizedNumber,
    displayNumber: r.displayNumber,
    names: r.donorNames.join(", "),
    nameCount: r.donorNames.length,
    txnCount: r.txnCount,
    totalAmountPaise: r.totalAmountPaise,
  }));
  return { rows, generatedAt: full.generatedAt };
}

// Build the per-number Address Collection rows by aggregating block_submissions in JS,
// enriched with the reconciliation Contribution/match data so each line shows the real
// transaction reference + status rather than the internal serial number.
async function computeAddressCollection(): Promise<AddressCollectionResult> {
  const now = Date.now();
  const [submissions, intakes, annotations, contributions, wolSends] = await Promise.all([
    prisma.blockSubmission.findMany({
      select: {
        id: true,
        name: true,
        whatsapp: true,
        qty: true,
        actionType: true,
        paymentMethod: true,
        paymentReference: true,
        serialNumber: true,
        createdAt: true,
      },
    }),
    prisma.whatsAppIntake.findMany({
      select: {
        phone: true,
        status: true,
        flow: true,
        legalName: true,
        address: true,
        pincode: true,
        updatedAt: true,
      },
    }),
    prisma.whatsAppNumberAnnotation.findMany(),
    prisma.contribution.findMany({
      where: { blockSubmissionId: { not: null } },
      select: {
        blockSubmissionId: true,
        status: true,
        matches: {
          select: {
            gatewayTxn: { select: { transactionId: true, rrn: true } },
            upiTxn: { select: { bankRRN: true, merchantTranId: true } },
          },
        },
      },
    }),
    prisma.wolMessageLog.findMany({
      where: { status: "sent" },
      select: { normalizedPhone: true, createdAt: true },
    }),
  ]);

  // Canonical number → most recent WoL outbound send time (drives "awaiting reply").
  const lastSentByKey = new Map<string, Date>();
  for (const s of wolSends) {
    const prev = lastSentByKey.get(s.normalizedPhone);
    if (!prev || s.createdAt > prev) lastSentByKey.set(s.normalizedPhone, s.createdAt);
  }

  // Map block submission → its reconciliation status + best matched reference.
  const contribBySub = new Map<
    number,
    { status: string | null; matchedRef: string | null; matchedKind: "gateway" | "upi" | null }
  >();
  for (const c of contributions) {
    if (c.blockSubmissionId == null) continue;
    let matchedRef: string | null = null;
    let matchedKind: "gateway" | "upi" | null = null;
    for (const m of c.matches) {
      if (m.gatewayTxn) {
        matchedRef = m.gatewayTxn.transactionId ?? m.gatewayTxn.rrn ?? null;
        matchedKind = "gateway";
        break;
      }
      if (m.upiTxn) {
        matchedRef = m.upiTxn.bankRRN ?? m.upiTxn.merchantTranId ?? null;
        matchedKind = "upi";
        break;
      }
    }
    contribBySub.set(c.blockSubmissionId, { status: c.status, matchedRef, matchedKind });
  }

  // Index intake by canonical key (this is where the two phone formats finally meet).
  const intakeByKey = new Map<string, (typeof intakes)[number]>();
  for (const it of intakes) {
    const key = normalizeWhatsappNumber(it.phone);
    if (!key) continue;
    const existing = intakeByKey.get(key);
    if (!existing || it.updatedAt > existing.updatedAt) intakeByKey.set(key, it);
  }

  const annByKey = new Map<string, (typeof annotations)[number]>();
  for (const a of annotations) annByKey.set(a.normalizedPhone, a);

  // Pass A: group submissions; build the global reference → set-of-numbers index.
  const groups = new Map<string, GroupAcc>();
  const refToNumbers = new Map<string, Set<string>>();

  for (const s of submissions) {
    const key = normalizeWhatsappNumber(s.whatsapp);
    if (!key) continue;

    let g = groups.get(key);
    if (!g) {
      g = { key, names: new Set(), txns: [], seenRefs: new Set() };
      groups.set(key, g);
    }

    const name = s.name?.trim();
    if (name) g.names.add(name);

    // Resolve the real reference: matched gateway/UPI ref, else the typed paymentReference.
    const contrib = contribBySub.get(s.id);
    let reference: string | null = null;
    let referenceKind: AddressCollectionTxn["referenceKind"] = null;
    if (contrib?.matchedRef) {
      reference = contrib.matchedRef;
      referenceKind = contrib.matchedKind;
    } else if (s.paymentReference) {
      reference = s.paymentReference;
      referenceKind = "submission";
    }

    if (reference) {
      let set = refToNumbers.get(reference);
      if (!set) {
        set = new Set();
        refToNumbers.set(reference, set);
      }
      set.add(key);
      // De-dupe an identical reference within a single number (retry / dup data entry).
      if (g.seenRefs.has(reference)) continue;
      g.seenRefs.add(reference);
    }

    g.txns.push({
      submissionId: s.id,
      reference,
      referenceKind,
      serialNumber: s.serialNumber,
      donorName: s.name,
      qty: s.qty,
      amountPaise: s.qty * PAISE_PER_NAME,
      actionType: s.actionType,
      paymentMethod: s.paymentMethod,
      typeLabel: txnTypeLabel(s.actionType, s.paymentMethod),
      status: contrib?.status ?? null,
      createdAt: s.createdAt.toISOString(),
      conflict: false, // resolved in Pass B once refToNumbers is complete
      otherNumbers: [],
    });
  }

  // Pass B: finalize rows now that cross-number conflicts are knowable.
  const rows: AddressCollectionRow[] = [];
  for (const g of groups.values()) {
    const txns = g.txns.map((t) => {
      if (!t.reference) return t;
      const others = [...(refToNumbers.get(t.reference) ?? [])].filter((k) => k !== g.key);
      return { ...t, conflict: others.length > 0, otherNumbers: others };
    });
    const donorNames = [...g.names];
    const intake = intakeByKey.get(g.key);
    const ann = annByKey.get(g.key);
    const multipleDonors = donorNames.length > 1;
    const manyDonors = donorNames.length > MANY_DONORS_THRESHOLD;
    const conflictCount = txns.filter((t) => t.conflict).length;
    const unverifiedCount = txns.filter((t) => t.status === "UNVERIFIED").length;
    const hasUnverified = unverifiedCount > 0;
    const invalidPhone = !looksLikePhoneNumber(g.key);

    // Needs review fires only on the three signals that actually need a human:
    // a number reused for dozens of donors, a junk phone number, or unverified money.
    const reviewReasons: string[] = [];
    if (manyDonors) reviewReasons.push(`${donorNames.length} donors on one number`);
    if (invalidPhone) reviewReasons.push("number doesn't look valid");
    if (hasUnverified)
      reviewReasons.push(`${unverifiedCount} unverified transaction${unverifiedCount === 1 ? "" : "s"}`);
    const needsReview = reviewReasons.length > 0;

    // A WoL intake starts at "ready" on our OUTBOUND send (no reply yet); other flows reach
    // "ready" only via the donor's inbound "new", which IS a reply. So "ready" counts as a
    // reply for every flow except WoL.
    const replied =
      intake != null &&
      (intake.legalName != null ||
        intake.address != null ||
        (intake.status !== "awaiting_legal_name" &&
          !(intake.flow === "wol" && intake.status === "ready")));

    // Awaiting reply: we sent a WoL message ≥24h ago and the donor has done nothing since
    // (no intake yet, or the intake is still the freshly-sent "ready" state).
    const lastSent = lastSentByKey.get(g.key) ?? null;
    const awaitingReply =
      lastSent != null &&
      now - lastSent.getTime() >= AWAITING_REPLY_MS &&
      (intake == null || intake.status === "ready");

    // Stalled: the donor started the flow (an "awaiting_*" state) but hasn't acted in ≥24h
    // and never reached "completed". updatedAt advances on every step (ours or theirs), so it
    // is the right idle clock — 24h since the last prompt with no answer.
    const stalledIncomplete =
      intake != null &&
      intake.status.startsWith("awaiting") &&
      now - intake.updatedAt.getTime() >= AWAITING_REPLY_MS;

    rows.push({
      normalizedNumber: g.key,
      displayNumber: formatWhatsappDisplay(g.key),
      donorNames,
      multipleDonors,
      manyDonors,
      invalidPhone,
      txns,
      txnCount: txns.length,
      totalQty: txns.reduce((a, t) => a + t.qty, 0),
      totalAmountPaise: txns.reduce((a, t) => a + t.amountPaise, 0),
      conflictCount,
      unverifiedCount,
      hasUnverified,
      messaged: intake != null,
      replied,
      lastSentAt: lastSent ? lastSent.toISOString() : null,
      awaitingReply,
      stalledIncomplete,
      intakeStatus: intake?.status ?? null,
      intakeLegalName: intake?.legalName ?? null,
      intakeAddress: intake?.address ?? null,
      intakePincode: intake?.pincode ?? null,
      isInvalid: ann?.isInvalid ?? false,
      notes: ann?.notes ?? null,
      whatsappStatus: ann?.whatsappStatus ?? null,
      lastDeliveryStatus: ann?.lastDeliveryStatus ?? null,
      lastDeliveryAt: ann?.lastDeliveryAt ? ann.lastDeliveryAt.toISOString() : null,
      needsReview,
      reviewReasons,
    });
  }

  rows.sort((a, b) => {
    if (a.needsReview !== b.needsReview) return a.needsReview ? -1 : 1;
    if (b.txnCount !== a.txnCount) return b.txnCount - a.txnCount;
    return a.displayNumber.localeCompare(b.displayNumber);
  });

  return {
    rows,
    generatedAt: new Date().toISOString(),
    totals: {
      numbers: rows.length,
      txns: rows.reduce((a, r) => a + r.txnCount, 0),
      needsReview: rows.filter((r) => r.needsReview).length,
      invalid: rows.filter((r) => r.isInvalid).length,
    },
    facets: {
      okay: rows.filter((r) => !r.needsReview && !r.isInvalid).length,
      needsReview: rows.filter((r) => r.needsReview).length,
      invalid: rows.filter((r) => r.isInvalid).length,
      manyDonors: rows.filter((r) => r.manyDonors).length,
      invalidPhone: rows.filter((r) => r.invalidPhone).length,
      unverified: rows.filter((r) => r.hasUnverified).length,
      multipleDonors: rows.filter((r) => r.multipleDonors).length,
      conflicts: rows.filter((r) => r.conflictCount > 0).length,
      awaitingReply: rows.filter((r) => r.awaitingReply).length,
      stalledIncomplete: rows.filter((r) => r.stalledIncomplete).length,
      messaged: rows.filter((r) => r.messaged).length,
      notMessaged: rows.filter((r) => !r.messaged).length,
      replied: rows.filter((r) => r.replied).length,
      notReplied: rows.filter((r) => !r.replied).length,
    },
  };
}

// ── Per-number detail ────────────────────────────────────────────────────────

export interface NumberDetailBreakdown {
  key: string;
  label: string;
  count: number;
  amountPaise: number;
}

export interface NumberDetail {
  found: boolean;
  normalizedNumber: string;
  displayNumber: string;
  row: AddressCollectionRow | null;
  summary: {
    totalTxns: number;
    totalQty: number;
    totalAmountPaise: number;
    conflicts: number;
    byType: NumberDetailBreakdown[];
    byStatus: NumberDetailBreakdown[];
  } | null;
}

// Full detail for one WhatsApp number. Reuses the same aggregation as the list so the
// reference/status resolution is identical, then rolls the number's transactions up by
// type and status for the detail page.
export async function getNumberDetail(rawNumber: string): Promise<NumberDetail> {
  const key = normalizeWhatsappNumber(rawNumber);
  const displayNumber = formatWhatsappDisplay(key);
  if (!key) return { found: false, normalizedNumber: key, displayNumber, row: null, summary: null };

  const all = await getAddressCollection();
  const row = all.rows.find((r) => r.normalizedNumber === key) ?? null;
  if (!row) return { found: false, normalizedNumber: key, displayNumber, row: null, summary: null };

  const byType = new Map<string, NumberDetailBreakdown>();
  const byStatus = new Map<string, NumberDetailBreakdown>();
  for (const t of row.txns) {
    const tk = t.typeLabel;
    const tEntry = byType.get(tk) ?? { key: tk, label: tk, count: 0, amountPaise: 0 };
    tEntry.count += 1;
    tEntry.amountPaise += t.amountPaise;
    byType.set(tk, tEntry);

    const sk = t.status ?? "UNRECONCILED";
    const sEntry = byStatus.get(sk) ?? { key: sk, label: sk, count: 0, amountPaise: 0 };
    sEntry.count += 1;
    sEntry.amountPaise += t.amountPaise;
    byStatus.set(sk, sEntry);
  }

  return {
    found: true,
    normalizedNumber: key,
    displayNumber,
    row,
    summary: {
      totalTxns: row.txnCount,
      totalQty: row.totalQty,
      totalAmountPaise: row.totalAmountPaise,
      conflicts: row.conflictCount,
      byType: [...byType.values()].sort((a, b) => b.count - a.count),
      byStatus: [...byStatus.values()].sort((a, b) => b.count - a.count),
    },
  };
}
