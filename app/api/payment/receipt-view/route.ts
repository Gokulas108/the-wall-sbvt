import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { COST_PER_NAME } from "@/lib/mosaic/engine";

/**
 * GET /api/payment/receipt-view?txnID=...
 *
 * Read-only receipt lookup for the receipt-view page. Queries ONLY the
 * block_submissions table — never touches pending_transactions. If the row
 * exists, the receipt is rendered; if not, we report not-found and stop.
 */
export async function GET(req: NextRequest) {
  const txnID = req.nextUrl.searchParams.get("txnID")?.trim();
  const idParam = req.nextUrl.searchParams.get("id")?.trim();
  const submissionId = idParam ? parseInt(idParam, 10) : NaN;

  if (!txnID && !Number.isFinite(submissionId)) {
    return NextResponse.json({ found: false, error: "txnID or id is required." }, { status: 400 });
  }

  const submission = await prisma.blockSubmission.findFirst({
    where: Number.isFinite(submissionId)
      ? { id: submissionId }
      : { paymentReference: txnID! },
    select: {
      id: true,
      blockId: true,
      serialNumber: true,
      actionType: true,
      name: true,
      qty: true,
      email: true,
      phone: true,
      whatsapp: true,
      dateOfBirth: true,
      paymentMethod: true,
      paymentReference: true,
      createdAt: true,
    },
  });

  if (!submission) {
    return NextResponse.json({ found: false });
  }

  const amount = submission.qty * COST_PER_NAME;

  const receipt = {
    serial_number: submission.serialNumber ?? `ONL-${submission.blockId}-${submission.id}`,
    submission_id: submission.id,
    action_type: submission.actionType,
    block_id: submission.blockId,
    allocations: [{ block_id: submission.blockId, qty: submission.qty, amount }],
    name: submission.name,
    donor_name: submission.name,
    qty: submission.qty,
    total_amount: amount,
    amount,
    currency: "INR",
    date_of_birth: submission.dateOfBirth,
    email: submission.email,
    phone: submission.phone,
    whatsapp: submission.whatsapp,
    payment_method: submission.paymentMethod ?? "online",
    payment_reference: submission.paymentReference ?? txnID ?? null,
    created_at: submission.createdAt.toISOString(),
  };

  return NextResponse.json({ found: true, receipt });
}
