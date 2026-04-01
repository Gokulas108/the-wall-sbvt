import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { COST_PER_NAME } from "@/lib/mosaic/engine";

/**
 * GET /api/payment/result-lookup?txnID=...
 *
 * Checks block_submissions for a row with payment_reference = txnID.
 * Called by the result page (polling) after the user is redirected back.
 * The S2S webhook has already written the record — this just confirms it.
 */
export async function GET(req: NextRequest) {
  const txnID = req.nextUrl.searchParams.get("txnID")?.trim();
  if (!txnID) {
    return NextResponse.json({ found: false, error: "txnID is required." }, { status: 400 });
  }

  const submission = await prisma.blockSubmission.findFirst({
    where: { paymentReference: txnID },
    select: {
      id: true,
      blockId: true,
      serialNumber: true,
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
    receipt_type: "online_donate",
    serial_number: submission.serialNumber ?? `ONL-${submission.blockId}-${submission.id}`,
    cross_check_ref: `${submission.blockId}-${submission.id}`,
    submission_id: submission.id,
    allocations: [{ block_id: submission.blockId, qty: submission.qty, amount }],
    name: submission.name,
    qty: submission.qty,
    amount,
    currency: "INR",
    date_of_birth: submission.dateOfBirth,
    email: submission.email,
    phone: submission.phone,
    whatsapp: submission.whatsapp,
    payment_method: submission.paymentMethod ?? "online",
    payment_reference: submission.paymentReference ?? txnID,
    created_at: submission.createdAt.toISOString(),
  };

  return NextResponse.json({ found: true, receipt });
}
