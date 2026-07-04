import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { donationTypeOf, type DonationType } from "@/lib/reconciliation/format";
import { resolveReceiptInfoForContribution, type ReceiptInfo } from "@/lib/reconciliation/receipts";

// One linked statement transaction behind a contribution — the "source" the ledger
// detail page drills into. Exactly one of gateway/upi is the origin; we normalise
// the shared fields so the page can render both the same way, and keep the raw CSV
// row for the full picture.
export interface StatementSource {
  matchId: number;
  source: "gateway" | "upi"; // Gateway statement vs UPI statement
  sourceLabel: string; // "Gateway statement" | "UPI statement"
  matchType: string; // auto_reference | manual | auto_fuzzy_suggested
  matchedPaise: number; // ContributionMatch.amountPaise attributed to this contribution
  confidence: number | null;
  note: string | null;
  matchedAt: string; // ContributionMatch.createdAt
  txn: {
    id: number;
    reference: string | null; // gateway.transactionId | upi.bankRRN — the per-txn key
    merchantTranId: string | null;
    rrn: string | null; // gateway.rrn | upi.bankRRN
    amountPaise: number; // gross
    chargesPaise: number | null; // gateway only
    netAmountPaise: number | null; // gateway only
    status: string;
    reconciliationStatus: string | null; // gateway only
    refundStatus: string | null; // upi only
    isSuccess: boolean;
    isRefund: boolean;
    customerName: string | null; // gateway.customerName | upi.payerName
    customerMobile: string | null; // gateway.customerMobile | upi.contactNumber
    customerVPA: string | null; // upi only
    transactionDate: string | null;
    rawRow: Record<string, unknown>;
  };
  batch: {
    id: number;
    kind: string; // 'gateway' | 'upi'
    filename: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    uploadedAt: string;
  };
}

export interface ContributionDetail {
  id: number;
  sourceType: string;
  donationType: DonationType;
  status: string;
  flags: string[];
  donorName: string | null;
  donorPhone: string | null;
  donorEmail: string | null;
  // Address / PAN / birnagar donation_type the donor submitted, denormalized onto
  // the contribution at reconcile time (from block_submissions or birnagar_donations).
  // Distinct from receiptInfo below, which is the legal name + address collected
  // separately over WhatsApp for the tax receipt.
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
  reconciledAt: string | null;
  // How many name-lines share this payment reference (the reference group size).
  // > 1 means one payment bought several names: the statement amount below is the
  // whole payment, split pro-rata across the group, and the match row is attached
  // to the group's primary line — so a sibling line shows the source via the group.
  sharedAcross: number;
  // True when this contribution doesn't personally own the match row — the source
  // was resolved through its reference group (a non-primary sibling line).
  sourceViaGroup: boolean;
  sources: StatementSource[];
  // The legal name + address the donor sent over WhatsApp (for the tax receipt),
  // resolved via the linked BlockSubmission's number. null when there's no linked
  // submission or that number never started an intake. Drives the Receipts surface.
  receiptInfo: ReceiptInfo | null;
}

// A ContributionMatch with its linked statement txn + that txn's import batch.
const matchInclude = {
  gatewayTxn: { include: { uploadBatch: true } },
  upiTxn: { include: { uploadBatch: true } },
} satisfies Prisma.ContributionMatchInclude;

type MatchWithTxn = Prisma.ContributionMatchGetPayload<{ include: typeof matchInclude }>;

function asRawRow(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function toSource(m: MatchWithTxn): StatementSource | null {
  if (m.gatewayTxn) {
    const g = m.gatewayTxn;
    return {
      matchId: m.id,
      source: "gateway",
      sourceLabel: "Gateway statement",
      matchType: m.matchType,
      matchedPaise: m.amountPaise,
      confidence: m.confidence,
      note: m.note,
      matchedAt: m.createdAt.toISOString(),
      txn: {
        id: g.id,
        reference: g.transactionId,
        merchantTranId: g.merchantTranId,
        rrn: g.rrn,
        amountPaise: g.amountPaise,
        chargesPaise: g.chargesPaise,
        netAmountPaise: g.netAmountPaise,
        status: g.status,
        reconciliationStatus: g.reconciliationStatus,
        refundStatus: null,
        isSuccess: g.isSuccess,
        isRefund: g.isRefund,
        customerName: g.customerName,
        customerMobile: g.customerMobile,
        customerVPA: null,
        transactionDate: g.transactionDate?.toISOString() ?? null,
        rawRow: asRawRow(g.rawRow),
      },
      batch: {
        id: g.uploadBatch.id,
        kind: g.uploadBatch.kind,
        filename: g.uploadBatch.filename,
        periodStart: g.uploadBatch.periodStart?.toISOString() ?? null,
        periodEnd: g.uploadBatch.periodEnd?.toISOString() ?? null,
        uploadedAt: g.uploadBatch.createdAt.toISOString(),
      },
    };
  }
  if (m.upiTxn) {
    const u = m.upiTxn;
    return {
      matchId: m.id,
      source: "upi",
      sourceLabel: "UPI statement",
      matchType: m.matchType,
      matchedPaise: m.amountPaise,
      confidence: m.confidence,
      note: m.note,
      matchedAt: m.createdAt.toISOString(),
      txn: {
        id: u.id,
        reference: u.bankRRN,
        merchantTranId: u.merchantTranId,
        rrn: u.bankRRN,
        amountPaise: u.amountPaise,
        chargesPaise: null,
        netAmountPaise: null,
        status: u.status,
        reconciliationStatus: null,
        refundStatus: u.refundStatus,
        isSuccess: u.isSuccess,
        isRefund: u.isRefund,
        customerName: u.payerName,
        customerMobile: u.contactNumber,
        customerVPA: u.customerVPA,
        transactionDate: u.transactionDate?.toISOString() ?? null,
        rawRow: asRawRow(u.rawRow),
      },
      batch: {
        id: u.uploadBatch.id,
        kind: u.uploadBatch.kind,
        filename: u.uploadBatch.filename,
        periodStart: u.uploadBatch.periodStart?.toISOString() ?? null,
        periodEnd: u.uploadBatch.periodEnd?.toISOString() ?? null,
        uploadedAt: u.uploadBatch.createdAt.toISOString(),
      },
    };
  }
  return null;
}

/**
 * Loads a single contribution and the statement transaction(s) it reconciled
 * against. The match row may live on this contribution directly (a primary line
 * or a manual link) OR — when one payment bought several names — on the primary
 * line of its (channel, reference) group; we resolve both. Returns null only when
 * the id is unknown; callers gate reachability on the contribution's status.
 */
export async function getContributionDetail(id: number): Promise<ContributionDetail | null> {
  if (!Number.isFinite(id)) return null;

  const c = await prisma.contribution.findUnique({ where: { id } });
  if (!c) return null;

  // 1. Matches owned directly by this contribution (primary auto line + manual links).
  const direct = await prisma.contributionMatch.findMany({
    where: { contributionId: id },
    include: matchInclude,
    orderBy: { id: "asc" },
  });

  // 2. Fall back to the reference group: a non-primary sibling line owns no match
  //    of its own — the statement is attached to the group's primary line, found
  //    via the shared (channel, reference).
  let matchRows = direct;
  let sourceViaGroup = false;
  if (direct.length === 0 && c.paymentReference) {
    matchRows = await prisma.contributionMatch.findMany({
      where: {
        contribution: {
          paymentChannel: c.paymentChannel,
          paymentReference: c.paymentReference,
        },
      },
      include: matchInclude,
      orderBy: { id: "asc" },
    });
    sourceViaGroup = matchRows.length > 0;
  }

  const sources = matchRows.map(toSource).filter((s): s is StatementSource => s !== null);

  // Size of the reference group (how many name-lines share this payment).
  const sharedAcross = c.paymentReference
    ? await prisma.contribution.count({
        where: { paymentChannel: c.paymentChannel, paymentReference: c.paymentReference },
      })
    : 1;

  // The receipt's single legal name + address is chosen across the whole transaction
  // (reference group), matching the Receipts list — not just this line's own number.
  const receiptInfo = await resolveReceiptInfoForContribution(c);

  return {
    id: c.id,
    sourceType: c.sourceType,
    donationType: donationTypeOf(c.sourceType),
    status: c.status,
    flags: Array.isArray(c.statusFlags) ? (c.statusFlags as string[]) : [],
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
    reconciledAt: c.reconciledAt?.toISOString() ?? null,
    sharedAcross,
    sourceViaGroup,
    sources,
    receiptInfo,
  };
}
