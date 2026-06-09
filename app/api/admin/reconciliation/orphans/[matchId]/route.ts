import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { prisma } from "@/lib/db/prisma";

// GET /api/admin/reconciliation/orphans/<matchId>
// Full transaction detail for one orphan match (a successful CSV payment with no donor).
// Used by the inline orphan-detail view in the reconciliation shell. Admin-only;
// returns null for unknown / non-orphan ids.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { matchId } = await params;
  const id = Number(matchId);
  if (!Number.isInteger(id)) return NextResponse.json(null);

  const match = await prisma.contributionMatch.findUnique({
    where: { id },
    include: {
      gatewayTxn: { include: { uploadBatch: true } },
      upiTxn: { include: { uploadBatch: true } },
    },
  });
  // Only orphan matches (no contribution) are shown here.
  if (!match || match.contributionId !== null) return NextResponse.json(null);

  if (match.gatewayTxn) {
    const g = match.gatewayTxn;
    // Cross-check PendingTransaction to flag an abandoned (started, never completed) payment.
    const pending = await prisma.pendingTransaction.findFirst({
      where: { txnId: g.transactionId },
      select: { status: true },
    });
    return NextResponse.json({
      matchId: match.id,
      kind: "gateway" as const,
      reference: g.transactionId,
      amountPaise: match.amountPaise,
      payerName: g.customerName,
      phone: g.customerMobile,
      date: g.transactionDate?.toISOString() ?? null,
      isRefund: g.isRefund,
      isSuccess: g.isSuccess,
      note: match.note,
      abandoned: pending?.status ?? null,
      txn: {
        reference: g.transactionId,
        merchantTranId: g.merchantTranId,
        rrn: g.rrn,
        amountPaise: g.amountPaise,
        chargesPaise: g.chargesPaise,
        netAmountPaise: g.netAmountPaise,
        status: g.status,
        reconciliationStatus: g.reconciliationStatus,
        refundStatus: null,
        customerVPA: null,
        originalTransactionId: g.originalTransactionId,
        isSuccess: g.isSuccess,
        isRefund: g.isRefund,
        customerName: g.customerName,
        customerMobile: g.customerMobile,
        transactionDate: g.transactionDate?.toISOString() ?? null,
        rawRow: g.rawRow,
      },
      batch: batchInfo(g.uploadBatch),
    });
  }

  const u = match.upiTxn!;
  return NextResponse.json({
    matchId: match.id,
    kind: "upi" as const,
    reference: u.bankRRN,
    amountPaise: match.amountPaise,
    payerName: u.payerName,
    phone: u.contactNumber,
    date: u.transactionDate?.toISOString() ?? null,
    isRefund: u.isRefund,
    isSuccess: u.isSuccess,
    note: match.note,
    abandoned: null,
    txn: {
      reference: u.bankRRN,
      merchantTranId: u.merchantTranId,
      rrn: u.bankRRN,
      amountPaise: u.amountPaise,
      chargesPaise: null,
      netAmountPaise: null,
      status: u.status,
      reconciliationStatus: null,
      refundStatus: u.refundStatus,
      customerVPA: u.customerVPA,
      originalTransactionId: null,
      isSuccess: u.isSuccess,
      isRefund: u.isRefund,
      customerName: u.payerName,
      customerMobile: u.contactNumber,
      transactionDate: u.transactionDate?.toISOString() ?? null,
      rawRow: u.rawRow,
    },
    batch: batchInfo(u.uploadBatch),
  });
}

function batchInfo(b: {
  id: number;
  kind: string;
  filename: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  createdAt: Date;
}) {
  return {
    id: b.id,
    kind: b.kind,
    filename: b.filename,
    periodStart: b.periodStart?.toISOString() ?? null,
    periodEnd: b.periodEnd?.toISOString() ?? null,
    uploadedAt: b.createdAt.toISOString(),
  };
}
