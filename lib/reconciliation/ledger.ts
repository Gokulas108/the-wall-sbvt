import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { donationTypeOf, type DonationType } from "@/lib/reconciliation/format";

export interface LedgerFilters {
  status?: string[] | null; // multi-select
  channel?: string | null;
  donationType?: string[] | null; // ["general"], ["wall_of_legacy"] or both
  hasAddress?: string | null; // "yes" | "no" | null (all)
  volunteerId?: number | null;
  blockId?: string | null;
  q?: string | null;
  from?: string | null;
  to?: string | null;
  page?: number;
  pageSize?: number;
}

export interface LedgerRow {
  id: number;
  sourceType: string;
  donationType: DonationType;
  status: string;
  donorName: string | null;
  donorPhone: string | null;
  donorEmail: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  panNo: string | null;
  donationCategory: string | null;
  blockId: string | null;
  serialNumber: string | null;
  qty: number;
  actionType: string | null;
  collectedByUserId: number | null;
  paymentChannel: string;
  paymentReference: string | null;
  expectedPaise: number;
  matchedPaise: number;
  variancePaise: number;
  receiptEligible: boolean;
  contributedAt: string | null;
  flags: string[];
}

export function buildLedgerWhere(f: LedgerFilters): Prisma.ContributionWhereInput {
  const where: Prisma.ContributionWhereInput = {};
  if (f.status && f.status.length) where.status = { in: f.status };
  if (f.channel) where.paymentChannel = f.channel;
  // Donation-type multi-select. Per-volunteer cash buckets are an accounting construct,
  // not a donor: they now show in the unfiltered ledger (as SETTLEMENT rows) but stay out
  // of the donor donation-type filters (General / Wall of Legacy).
  const dts = f.donationType ?? [];
  const wantGeneral = dts.includes("general");
  const wantWall = dts.includes("wall_of_legacy");
  if (dts.length === 0) {
    // no donation-type filter → show everything, including settlement (cash bucket) rows
  } else if (wantGeneral && wantWall) where.sourceType = { not: "cash_bucket" };
  else if (wantGeneral) where.sourceType = "birnagar_general";
  else if (wantWall) where.sourceType = "wall_submission";
  else where.sourceType = { not: "cash_bucket" };
  // With/without address. The pull + reconcile normalize empty addresses to null,
  // so a plain null / not-null check keeps this expressible as a pure Prisma where
  // (pagination + count stay intact).
  if (f.hasAddress === "yes") where.address = { not: null };
  else if (f.hasAddress === "no") where.address = null;
  if (f.volunteerId != null) where.collectedByUserId = f.volunteerId;
  if (f.blockId) where.blockId = f.blockId.toUpperCase();
  if (f.from || f.to) {
    const range: Prisma.DateTimeFilter = {};
    if (f.from) range.gte = new Date(f.from);
    if (f.to) range.lte = new Date(f.to);
    where.contributedAt = range;
  }
  if (f.q && f.q.trim()) {
    const q = f.q.trim();
    where.OR = [
      { donorName: { contains: q, mode: "insensitive" } },
      { donorPhone: { contains: q } },
      { paymentReference: { contains: q, mode: "insensitive" } },
      { serialNumber: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

function toRow(c: {
  id: number;
  sourceType: string;
  status: string;
  donorName: string | null;
  donorPhone: string | null;
  donorEmail: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  panNo: string | null;
  donationCategory: string | null;
  blockId: string | null;
  serialNumber: string | null;
  qty: number;
  actionType: string | null;
  collectedByUserId: number | null;
  paymentChannel: string;
  paymentReference: string | null;
  expectedPaise: number;
  matchedPaise: number;
  variancePaise: number;
  receiptEligible: boolean;
  contributedAt: Date | null;
  statusFlags: Prisma.JsonValue;
}): LedgerRow {
  return {
    id: c.id,
    sourceType: c.sourceType,
    donationType: donationTypeOf(c.sourceType),
    status: c.status,
    donorName: c.donorName,
    donorPhone: c.donorPhone,
    donorEmail: c.donorEmail,
    address: c.address,
    city: c.city,
    state: c.state,
    pincode: c.pincode,
    panNo: c.panNo,
    donationCategory: c.donationCategory,
    blockId: c.blockId,
    serialNumber: c.serialNumber,
    qty: c.qty,
    actionType: c.actionType,
    collectedByUserId: c.collectedByUserId,
    paymentChannel: c.paymentChannel,
    paymentReference: c.paymentReference,
    expectedPaise: c.expectedPaise,
    matchedPaise: c.matchedPaise,
    variancePaise: c.variancePaise,
    receiptEligible: c.receiptEligible,
    contributedAt: c.contributedAt?.toISOString() ?? null,
    flags: Array.isArray(c.statusFlags) ? (c.statusFlags as string[]) : [],
  };
}

export interface LedgerPage {
  data: LedgerRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function queryLedger(f: LedgerFilters): Promise<LedgerPage> {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, f.pageSize ?? 50));
  const where = buildLedgerWhere(f);
  const [rows, total] = await Promise.all([
    prisma.contribution.findMany({
      where,
      orderBy: [{ contributedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.contribution.count({ where }),
  ]);
  return { data: rows.map(toRow), total, page, pageSize };
}

export function filtersFromSearchParams(sp: URLSearchParams): LedgerFilters {
  const intOrNull = (v: string | null) => {
    if (!v) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  const csv = (v: string | null) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);
  return {
    status: csv(sp.get("status")),
    channel: sp.get("channel"),
    donationType: csv(sp.get("donationType")),
    hasAddress: sp.get("hasAddress"),
    volunteerId: intOrNull(sp.get("volunteerId")),
    blockId: sp.get("blockId"),
    q: sp.get("q"),
    from: sp.get("from"),
    to: sp.get("to"),
    page: intOrNull(sp.get("page")) ?? 1,
    pageSize: intOrNull(sp.get("pageSize")) ?? 50,
  };
}
