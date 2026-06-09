import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { prisma } from "@/lib/db/prisma";

// GET /api/admin/reconciliation/orphans
// Money with no donor: successful CSV transactions the reconciler could not attach
// to any contribution. Gateway orphans are cross-checked against PendingTransaction
// to flag "abandoned" (started a payment, never completed) vs truly unknown.
export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orphanMatches = await prisma.contributionMatch.findMany({
    where: { contributionId: null },
    include: { gatewayTxn: true, upiTxn: true },
    orderBy: { id: "desc" },
  });

  // Label abandoned gateway payments via PendingTransaction.
  const gatewayTxnIds = orphanMatches
    .map((m) => m.gatewayTxn?.transactionId)
    .filter((x): x is string => !!x);
  const pendings = gatewayTxnIds.length
    ? await prisma.pendingTransaction.findMany({
        where: { txnId: { in: gatewayTxnIds } },
        select: { txnId: true, status: true },
      })
    : [];
  const pendingByTxn = new Map(pendings.map((p) => [p.txnId, p.status]));

  const orphans = orphanMatches.map((m) => {
    if (m.gatewayTxn) {
      const g = m.gatewayTxn;
      return {
        matchId: m.id,
        kind: "gateway" as const,
        gatewayTxnId: g.id,
        upiTxnId: null,
        reference: g.transactionId,
        amountPaise: m.amountPaise,
        payerName: g.customerName,
        phone: g.customerMobile,
        date: g.transactionDate?.toISOString() ?? null,
        isRefund: g.isRefund,
        note: m.note,
        abandoned: pendingByTxn.get(g.transactionId) ?? null,
      };
    }
    const u = m.upiTxn!;
    return {
      matchId: m.id,
      kind: "upi" as const,
      gatewayTxnId: null,
      upiTxnId: u.id,
      reference: u.bankRRN,
      amountPaise: m.amountPaise,
      payerName: u.payerName,
      phone: u.contactNumber,
      date: u.transactionDate?.toISOString() ?? null,
      isRefund: u.isRefund,
      note: m.note,
      abandoned: null,
    };
  });

  return NextResponse.json({ orphans });
}
