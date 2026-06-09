import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { prisma } from "@/lib/db/prisma";

// GET /api/admin/reconciliation/suggest?gatewayTxnId= | ?upiTxnId=
// Ranks contributions that still need money (UNVERIFIED / AMBIGUOUS) as candidates
// to attach this orphan CSV transaction to. Score = amount-closeness + phone
// last-10 match + date proximity.
function last10(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "").slice(-10);
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const gatewayTxnId = sp.get("gatewayTxnId") ? parseInt(sp.get("gatewayTxnId")!, 10) : null;
  const upiTxnId = sp.get("upiTxnId") ? parseInt(sp.get("upiTxnId")!, 10) : null;
  if (!gatewayTxnId && !upiTxnId) {
    return NextResponse.json({ error: "gatewayTxnId or upiTxnId required." }, { status: 400 });
  }

  let txnAmount = 0;
  let txnPhone: string | null = null;
  let txnDate: Date | null = null;
  let channel: "online" | "upi";

  if (gatewayTxnId) {
    const g = await prisma.gatewayTransaction.findUnique({ where: { id: gatewayTxnId } });
    if (!g) return NextResponse.json({ error: "Gateway transaction not found." }, { status: 404 });
    txnAmount = g.amountPaise;
    txnPhone = g.customerMobile;
    txnDate = g.transactionDate;
    channel = "online";
  } else {
    const u = await prisma.upiTransaction.findUnique({ where: { id: upiTxnId! } });
    if (!u) return NextResponse.json({ error: "UPI transaction not found." }, { status: 404 });
    txnAmount = u.amountPaise;
    txnPhone = u.contactNumber;
    txnDate = u.transactionDate;
    channel = "upi";
  }

  // Candidates needing money. Prefer the same channel, but the admin can override a
  // mistyped reference across channels, so we don't hard-exclude others — we just
  // score same-channel higher.
  const candidates = await prisma.contribution.findMany({
    where: { status: { in: ["UNVERIFIED", "AMBIGUOUS"] } },
    take: 800,
  });

  const txnLast10 = last10(txnPhone);

  const scored = candidates
    .map((c) => {
      let score = 0;
      const reasons: string[] = [];

      const diff = Math.abs(c.expectedPaise - txnAmount);
      if (diff === 0) {
        score += 50;
        reasons.push("exact amount");
      } else if (diff <= 1000) {
        score += 35;
        reasons.push("amount within ₹10");
      } else if (diff <= 5000) {
        score += 18;
        reasons.push("amount within ₹50");
      } else if (diff <= 50000) {
        score += 6;
      }

      if (txnLast10 && last10(c.donorPhone) === txnLast10) {
        score += 40;
        reasons.push("phone match");
      }

      if (txnDate && c.contributedAt) {
        const days = Math.abs(txnDate.getTime() - c.contributedAt.getTime()) / 86400000;
        if (days <= 1) {
          score += 15;
          reasons.push("same day");
        } else if (days <= 3) {
          score += 8;
        }
      }

      if (c.paymentChannel === channel) {
        score += 10;
      } else {
        reasons.push(`other channel (${c.paymentChannel})`);
      }

      return {
        id: c.id,
        donorName: c.donorName,
        donorPhone: c.donorPhone,
        blockId: c.blockId,
        serialNumber: c.serialNumber,
        qty: c.qty,
        status: c.status,
        paymentChannel: c.paymentChannel,
        paymentReference: c.paymentReference,
        expectedPaise: c.expectedPaise,
        contributedAt: c.contributedAt?.toISOString() ?? null,
        score,
        reasons,
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return NextResponse.json({
    txn: { amountPaise: txnAmount, phone: txnPhone, date: txnDate?.toISOString() ?? null, channel },
    candidates: scored,
  });
}
