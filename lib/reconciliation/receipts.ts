import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { donationTypeOf, MATCHED_STATUSES, type DonationType } from "@/lib/reconciliation/format";
import { normalizeWhatsappNumber, formatWhatsappDisplay } from "@/lib/whatsapp-care/phone";
import { COST_PER_NAME } from "@/lib/mosaic/engine";

// "Receipts" = one receipt per matched TRANSACTION (a payment, i.e. a channel+reference
// group), not per name-line. One payment can buy several names with several donors /
// WhatsApp numbers; a receipt still needs exactly one legal name + one address, so we
// pick the first number in the transaction (ordered by contribution id) that has sent
// both. A transaction is "receipt-ready" iff at least one of its numbers has them.
//
// The donor↔intake link can't be a pure Prisma query: Contribution has no whatsapp field
// (it lives on BlockSubmission.whatsapp), and block_submissions.whatsapp ("+91 98…") and
// whatsapp_intakes.phone ("9198…") are stored in different shapes — so we normalise + join
// in JS, exactly like address-collection.ts.

const MATCHED = [...MATCHED_STATUSES]; // ["MATCHED","OVERPAID","UNDERPAID"]
const CACHE_TTL_MS = 30_000;

// The treasury receipt number IS the treasury_receipts row id, zero-padded. Lives here (not
// treasury.ts) so querySubmittedReceipts can format without a circular import.
export function formatTreasuryReceiptNo(id: number): string {
  return String(id).padStart(5, "0");
}

// ── Full per-transaction record (source of truth for list + submission) ────────
export interface ReceiptTransaction {
  transactionKey: string; // `${channel}|${reference}` or `c:${id}` — one per transaction
  id: number; // representative contribution id (opens the transaction detail)
  status: string;
  donationType: DonationType;
  paymentChannel: string;
  paymentReference: string | null;
  donorName: string | null;
  donorPhone: string | null;
  donorEmail: string | null;
  donorCount: number; // distinct donor names sharing this transaction
  blockId: string | null;
  serialNumber: string | null;
  qty: number; // summed across the transaction's name-lines
  expectedPaise: number;
  matchedPaise: number; // the whole payment (received)
  variancePaise: number;
  contributedAt: string | null;
  legalName: string | null; // chosen for the receipt (from WhatsApp)
  address: string | null;
  pincode: string | null;
  whatsapp: string; // display form of the chosen number
}

// Lean row the list table renders (a projection of ReceiptTransaction).
export interface ReceiptRow {
  id: number;
  status: string;
  donationType: DonationType;
  donorName: string | null;
  donorPhone: string | null;
  donorCount: number;
  paymentChannel: string;
  paymentReference: string | null;
  expectedPaise: number;
  matchedPaise: number;
  variancePaise: number;
  contributedAt: string | null;
  legalName: string | null;
  address: string | null;
  whatsapp: string;
}

function toRow(t: ReceiptTransaction): ReceiptRow {
  return {
    id: t.id,
    status: t.status,
    donationType: t.donationType,
    donorName: t.donorName,
    donorPhone: t.donorPhone,
    donorCount: t.donorCount,
    paymentChannel: t.paymentChannel,
    paymentReference: t.paymentReference,
    expectedPaise: t.expectedPaise,
    matchedPaise: t.matchedPaise,
    variancePaise: t.variancePaise,
    contributedAt: t.contributedAt,
    legalName: t.legalName,
    address: t.address,
    whatsapp: t.whatsapp,
  };
}

export interface ReceiptFilters {
  q?: string | null;
  channel?: string | null;
  donationType?: string[] | null; // ["general"] / ["wall_of_legacy"]
  status?: string[] | null; // subset of MATCHED
  from?: string | null; // yyyy-mm-dd
  to?: string | null; // yyyy-mm-dd
}

export interface ReceiptsPage {
  data: ReceiptRow[];
  total: number; // filtered pending rows — drives pagination
  page: number;
  pageSize: number;
  eligibleCount: number; // X: receipt-ready transactions (unfiltered)
  totalCount: number; // Y: all matched transactions
  pendingCount: number; // ready & not yet submitted (unfiltered)
  submittedCount: number; // submitted to treasury (all)
}

// ── Heavy aggregation (cached) ────────────────────────────────────────────────
interface ComputedReceipts {
  transactions: ReceiptTransaction[]; // receipt-ready, newest first
  totalGroups: number; // count of all matched transactions (Y)
}

let cache: { at: number; value: ComputedReceipts } | null = null;

export function bustReceiptsCache(): void {
  cache = null;
}

interface IntakeLite {
  legalName: string | null;
  address: string | null;
  pincode: string | null;
}

async function computeReceipts(): Promise<ComputedReceipts> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;

  const [contribs, submissions, intakes] = await Promise.all([
    prisma.contribution.findMany({
      where: { status: { in: MATCHED } },
      select: {
        id: true,
        blockSubmissionId: true,
        sourceType: true,
        status: true,
        donorName: true,
        donorPhone: true,
        donorEmail: true,
        blockId: true,
        serialNumber: true,
        qty: true,
        paymentChannel: true,
        paymentReference: true,
        expectedPaise: true,
        matchedPaise: true,
        variancePaise: true,
        contributedAt: true,
      },
      orderBy: { id: "asc" },
    }),
    prisma.blockSubmission.findMany({ select: { id: true, whatsapp: true } }),
    prisma.whatsAppIntake.findMany({
      where: { legalName: { not: null }, address: { not: null } },
      select: { phone: true, legalName: true, address: true, pincode: true, updatedAt: true },
    }),
  ]);

  const whatsappBySub = new Map<number, string>();
  for (const s of submissions) whatsappBySub.set(s.id, s.whatsapp);

  // Canonical-key → completed intake (most recent wins). Only intakes with both a legal
  // name and an address are loaded above; the trim guard drops blank-but-non-null rows.
  const intakeByKey = new Map<string, IntakeLite & { updatedAt: Date }>();
  for (const it of intakes) {
    if (!it.legalName?.trim() || !it.address?.trim()) continue;
    const key = normalizeWhatsappNumber(it.phone);
    if (!key) continue;
    const existing = intakeByKey.get(key);
    if (!existing || it.updatedAt > existing.updatedAt) {
      intakeByKey.set(key, {
        legalName: it.legalName,
        address: it.address,
        pincode: it.pincode,
        updatedAt: it.updatedAt,
      });
    }
  }

  // Group matched contributions into transactions. Matched lines carry a reference; the
  // rare null-reference line becomes its own single-line group.
  type Contrib = (typeof contribs)[number];
  const groups = new Map<string, Contrib[]>();
  for (const c of contribs) {
    const key = c.paymentReference ? `${c.paymentChannel}|${c.paymentReference}` : `c:${c.id}`;
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }

  const transactions: ReceiptTransaction[] = [];
  for (const [transactionKey, g] of groups.entries()) {
    // g is already in contribution-id order (contribs ordered by id).
    const donorNames = new Set<string>();
    let expected = 0;
    let matched = 0;
    let variance = 0;
    let qty = 0;
    let chosenKey: string | null = null;
    let chosenIntake: IntakeLite | null = null;

    for (const c of g) {
      if (c.donorName?.trim()) donorNames.add(c.donorName.trim());
      expected += c.expectedPaise;
      matched += c.matchedPaise;
      variance += c.variancePaise;
      qty += c.qty;
      if (chosenIntake) continue; // already have the first replying number
      if (c.blockSubmissionId == null) continue;
      const wa = whatsappBySub.get(c.blockSubmissionId);
      const key = wa ? normalizeWhatsappNumber(wa) : "";
      const intake = key ? intakeByKey.get(key) : undefined;
      if (intake) {
        chosenKey = key;
        chosenIntake = intake;
      }
    }

    if (!chosenIntake || !chosenKey) continue; // transaction isn't receipt-ready

    const rep = g[0];
    transactions.push({
      transactionKey,
      id: rep.id,
      status: rep.status,
      donationType: donationTypeOf(rep.sourceType),
      paymentChannel: rep.paymentChannel,
      paymentReference: rep.paymentReference,
      donorName: rep.donorName,
      donorPhone: rep.donorPhone,
      donorEmail: rep.donorEmail,
      donorCount: donorNames.size,
      blockId: rep.blockId,
      serialNumber: rep.serialNumber,
      qty,
      expectedPaise: expected,
      matchedPaise: matched,
      variancePaise: variance,
      contributedAt: rep.contributedAt?.toISOString() ?? null,
      legalName: chosenIntake.legalName,
      address: chosenIntake.address,
      pincode: chosenIntake.pincode,
      whatsapp: formatWhatsappDisplay(chosenKey),
    });
  }

  transactions.sort((a, b) => (b.contributedAt ?? "").localeCompare(a.contributedAt ?? ""));
  const value: ComputedReceipts = { transactions, totalGroups: groups.size };
  cache = { at: now, value };
  return value;
}

function matchesFilters(t: ReceiptTransaction, f: ReceiptFilters): boolean {
  if (f.channel && t.paymentChannel !== f.channel) return false;
  const dts = f.donationType ?? [];
  if (dts.length && !dts.includes(t.donationType)) return false;
  const sts = f.status ?? [];
  if (sts.length && !sts.includes(t.status)) return false;
  const date = t.contributedAt?.slice(0, 10) ?? "";
  if (f.from && date < f.from) return false;
  if (f.to && date > f.to) return false;
  const q = f.q?.trim().toLowerCase();
  if (q) {
    const digits = q.replace(/\D/g, "");
    const hit =
      t.donorName?.toLowerCase().includes(q) ||
      t.legalName?.toLowerCase().includes(q) ||
      t.address?.toLowerCase().includes(q) ||
      t.paymentReference?.toLowerCase().includes(q) ||
      (digits.length > 0 && (t.donorPhone ?? "").replace(/\D/g, "").includes(digits));
    if (!hit) return false;
  }
  return true;
}

// ── "Yet to submit" list ──────────────────────────────────────────────────────
export async function queryPendingReceipts(
  opts: { page?: number; pageSize?: number } & ReceiptFilters,
): Promise<ReceiptsPage> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, opts.pageSize ?? 25));
  const [{ transactions, totalGroups }, submitted] = await Promise.all([
    computeReceipts(),
    prisma.treasuryReceipt.findMany({ select: { transactionKey: true } }),
  ]);
  const submittedKeys = new Set(submitted.map((s) => s.transactionKey));

  const pending = transactions.filter((t) => !submittedKeys.has(t.transactionKey));
  const filtered = pending.filter((t) => matchesFilters(t, opts));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return {
    data: filtered.slice(start, start + pageSize).map(toRow),
    total,
    page,
    pageSize,
    eligibleCount: transactions.length,
    totalCount: totalGroups,
    pendingCount: pending.length,
    submittedCount: submittedKeys.size,
  };
}

// Just the headline counts the Receipts view shows, for the overview KPI. Reuses the
// same cached aggregation as the list, so it's cheap when the Receipts tab is warm.
export interface ReceiptCounts {
  eligible: number; // receipt-ready transactions — a WhatsApp number sent legal name + address
  pending: number; // ready & not yet generated/submitted to treasury
  submitted: number; // already submitted to treasury
  total: number; // all matched transactions
}

export async function getReceiptCounts(): Promise<ReceiptCounts> {
  const [{ transactions, totalGroups }, submitted] = await Promise.all([
    computeReceipts(),
    prisma.treasuryReceipt.findMany({ select: { transactionKey: true } }),
  ]);
  const submittedKeys = new Set(submitted.map((s) => s.transactionKey));
  const pending = transactions.filter((t) => !submittedKeys.has(t.transactionKey)).length;
  return {
    eligible: transactions.length,
    pending,
    submitted: submittedKeys.size,
    total: totalGroups,
  };
}

// All representative contribution ids for the "yet to submit" list matching the given
// filters, across every page — backs the "Select all N pending" action.
export async function getPendingReceiptIds(filters: ReceiptFilters): Promise<number[]> {
  const [{ transactions }, submitted] = await Promise.all([
    computeReceipts(),
    prisma.treasuryReceipt.findMany({ select: { transactionKey: true } }),
  ]);
  const submittedKeys = new Set(submitted.map((s) => s.transactionKey));
  return transactions
    .filter((t) => !submittedKeys.has(t.transactionKey) && matchesFilters(t, filters))
    .map((t) => t.id);
}

// Full records for the given representative contribution ids — used by the submit flow.
// Re-derived from the same cached aggregation the list uses (single source of truth).
export async function getReceiptTransactionsByIds(ids: number[]): Promise<ReceiptTransaction[]> {
  if (ids.length === 0) return [];
  const wanted = new Set(ids);
  const { transactions } = await computeReceipts();
  return transactions.filter((t) => wanted.has(t.id));
}

// ── "Submitted to treasury" list ──────────────────────────────────────────────
export interface SubmittedReceiptRow {
  id: number;
  receiptNo: string;
  contributionId: number | null;
  txnId: string | null;
  status: string;
  donationType: DonationType;
  paymentChannel: string;
  amountPaise: number;
  qty: number;
  donorName: string | null;
  legalName: string | null;
  address: string | null;
  pincode: string | null;
  contributedAt: string | null;
  submittedByUsername: string | null;
  submittedAt: string;
}

export interface SubmittedReceiptsPage {
  data: SubmittedReceiptRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function querySubmittedReceipts(
  opts: { page?: number; pageSize?: number } & ReceiptFilters,
): Promise<SubmittedReceiptsPage> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, opts.pageSize ?? 25));

  const where: Prisma.TreasuryReceiptWhereInput = {};
  if (opts.channel) where.paymentChannel = opts.channel;
  const dts = opts.donationType ?? [];
  if (dts.length) where.donationType = { in: dts };
  const sts = opts.status ?? [];
  if (sts.length) where.status = { in: sts };
  if (opts.from || opts.to) {
    const range: Prisma.DateTimeFilter = {};
    if (opts.from) range.gte = new Date(opts.from);
    if (opts.to) range.lte = new Date(`${opts.to}T23:59:59.999Z`);
    where.contributedAt = range;
  }
  const q = opts.q?.trim();
  if (q) {
    where.OR = [
      { legalName: { contains: q, mode: "insensitive" } },
      { donorName: { contains: q, mode: "insensitive" } },
      { address: { contains: q, mode: "insensitive" } },
      { txnId: { contains: q, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.treasuryReceipt.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.treasuryReceipt.count({ where }),
  ]);

  return {
    data: rows.map((r) => ({
      id: r.id,
      receiptNo: formatTreasuryReceiptNo(r.id),
      contributionId: r.contributionId,
      txnId: r.txnId,
      status: r.status,
      donationType: r.donationType === "general" ? "general" : "wall_of_legacy",
      paymentChannel: r.paymentChannel,
      amountPaise: r.amountPaise,
      qty: r.qty,
      donorName: r.donorName,
      legalName: r.legalName,
      address: r.address,
      pincode: r.pincode,
      contributedAt: r.contributedAt?.toISOString() ?? null,
      submittedByUsername: r.submittedByUsername,
      submittedAt: r.submittedAt.toISOString(),
    })),
    total,
    page,
    pageSize,
  };
}

// Expose the per-name amount (rupees) so callers don't re-derive it.
export const RECEIPT_RUPEES_PER_NAME = COST_PER_NAME;

// ── Receipt info for the detail page ──────────────────────────────────────────
export interface ReceiptInfo {
  whatsapp: string; // display form, e.g. "+91 9876543210"
  normalizedNumber: string;
  legalName: string | null;
  address: string | null;
  pincode: string | null;
  intakeStatus: string | null;
}

// Resolve the WhatsApp intake behind ONE block submission's number: whatsapp → canonical
// key → intake. Returns null when the number never started an intake. Matches on the
// trailing 10 digits, then confirms with the same canonical key the list join uses.
async function resolveReceiptInfo(blockSubmissionId: number): Promise<ReceiptInfo | null> {
  const sub = await prisma.blockSubmission.findUnique({
    where: { id: blockSubmissionId },
    select: { whatsapp: true },
  });
  if (!sub) return null;

  const key = normalizeWhatsappNumber(sub.whatsapp);
  if (!key) return null;

  const last10 = key.slice(-10);
  const candidates = await prisma.whatsAppIntake.findMany({
    where: { phone: { contains: last10 } },
    select: { phone: true, status: true, legalName: true, address: true, pincode: true },
    orderBy: { updatedAt: "desc" },
  });
  const intake = candidates.find((c) => normalizeWhatsappNumber(c.phone) === key);
  if (!intake) return null;

  return {
    whatsapp: formatWhatsappDisplay(key),
    normalizedNumber: key,
    legalName: intake.legalName,
    address: intake.address,
    pincode: intake.pincode,
    intakeStatus: intake.status,
  };
}

// Choose the single receipt identity for a transaction (the contribution's channel+reference
// group), matching how the list picks it: the first number (by contribution id) that has
// sent legal name + address. Falls back to the first number that started an intake at all,
// so the ledger detail of a not-yet-ready transaction still shows what we have. null when
// no number in the transaction has any intake.
export async function resolveReceiptInfoForContribution(c: {
  paymentChannel: string;
  paymentReference: string | null;
  blockSubmissionId: number | null;
}): Promise<ReceiptInfo | null> {
  let subIds: number[];
  if (c.paymentReference) {
    const group = await prisma.contribution.findMany({
      where: { paymentChannel: c.paymentChannel, paymentReference: c.paymentReference },
      select: { blockSubmissionId: true },
      orderBy: { id: "asc" },
    });
    subIds = group.map((g) => g.blockSubmissionId).filter((x): x is number => x != null);
  } else {
    subIds = c.blockSubmissionId != null ? [c.blockSubmissionId] : [];
  }

  let fallback: ReceiptInfo | null = null;
  for (const subId of subIds) {
    const info = await resolveReceiptInfo(subId);
    if (!info) continue;
    if (info.legalName?.trim() && info.address?.trim()) return info; // first complete number
    if (!fallback) fallback = info;
  }
  return fallback;
}
