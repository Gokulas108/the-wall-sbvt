import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { prisma } from "@/lib/db/prisma";
import { runReconciliation } from "@/lib/reconciliation/run";

// POST /api/admin/reconciliation/match
//   { action: "link", contributionId, gatewayTxnId|upiTxnId, amountPaise?, note? }
//   { action: "unlink", gatewayTxnId|upiTxnId }
//
// Writes a manual ContributionMatch (always honored, never overwritten by the
// auto reconciler) and re-reconciles so the ledger reflects it immediately.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "link");
  const gatewayTxnId = body.gatewayTxnId != null ? Number(body.gatewayTxnId) : null;
  const upiTxnId = body.upiTxnId != null ? Number(body.upiTxnId) : null;

  if (!gatewayTxnId && !upiTxnId) {
    return NextResponse.json({ error: "gatewayTxnId or upiTxnId is required." }, { status: 400 });
  }
  const whereUnique: Prisma.ContributionMatchWhereUniqueInput = gatewayTxnId
    ? { gatewayTxnId }
    : { upiTxnId: upiTxnId! };

  if (action === "unlink") {
    await prisma.contributionMatch.deleteMany({
      where: gatewayTxnId ? { gatewayTxnId } : { upiTxnId: upiTxnId! },
    });
  } else {
    const contributionId = body.contributionId != null ? Number(body.contributionId) : null;
    if (!contributionId) {
      return NextResponse.json({ error: "contributionId is required to link." }, { status: 400 });
    }
    const contrib = await prisma.contribution.findUnique({
      where: { id: contributionId },
      select: { id: true },
    });
    if (!contrib) {
      return NextResponse.json({ error: "Contribution not found." }, { status: 404 });
    }

    let amountPaise = body.amountPaise != null ? Number(body.amountPaise) : null;
    if (amountPaise == null) {
      if (gatewayTxnId) {
        const g = await prisma.gatewayTransaction.findUnique({
          where: { id: gatewayTxnId },
          select: { amountPaise: true },
        });
        amountPaise = g?.amountPaise ?? 0;
      } else {
        const u = await prisma.upiTransaction.findUnique({
          where: { id: upiTxnId! },
          select: { amountPaise: true },
        });
        amountPaise = u?.amountPaise ?? 0;
      }
    }
    const note = body.note ? String(body.note) : null;

    await prisma.contributionMatch.upsert({
      where: whereUnique,
      create: {
        contributionId,
        gatewayTxnId,
        upiTxnId,
        matchType: "manual",
        amountPaise,
        note,
        createdById: admin.id,
      },
      update: {
        contributionId,
        matchType: "manual",
        amountPaise,
        note,
        createdById: admin.id,
      },
    });
  }

  const summary = await runReconciliation({ triggeredById: admin.id });
  return NextResponse.json({ ok: true, summary });
}
