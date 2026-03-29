import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { NAMES_PER_BLOCK, COST_PER_NAME } from "@/lib/mosaic/engine";
import { eventBus } from "@/lib/events/emitter";
import { Prisma } from "@prisma/client";

/**
 * POST /api/payment/confirm
 *
 * Called by the payment result page after a successful payment gateway transaction.
 * Saves the donor record to the database (same as the donate route) and returns
 * the full receipt payload for display.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      block_id,
      name,
      qty,
      date_of_birth,
      email,
      phone,
      whatsapp,
      txn_id,
      amount,
    } = body as {
      block_id?: string;
      name?: string;
      qty?: number;
      date_of_birth?: string;
      email?: string;
      phone?: string;
      whatsapp?: string;
      txn_id?: string;
      amount?: number;
    };

    if (!block_id || !name || !qty || !phone || !whatsapp) {
      return NextResponse.json(
        { success: false, error: "Missing required fields (block_id, name, qty, phone, whatsapp)." },
        { status: 400 }
      );
    }

    const blockId = block_id.toUpperCase();
    const donorName = name.trim();
    const donorQty = Math.max(1, qty);
    const donorDob = (date_of_birth || "").trim();
    const donorEmail = (email || "").trim();
    const donorPhone = (phone || "").trim();
    const donorWhatsapp = (whatsapp || "").trim();
    const paymentReference = (txn_id || "").trim();

    let submission: {
      id: number;
      createdAt: Date;
      serialNumber: string | null;
    };

    try {
      submission = await prisma.$transaction(
        async (tx) => {
          const used = await tx.blockName.aggregate({
            where: { blockId },
            _sum: { qty: true },
          });
          const currentUsed = used._sum.qty ?? 0;

          if (currentUsed + donorQty > NAMES_PER_BLOCK) {
            throw new Error(
              `Not enough space. ${NAMES_PER_BLOCK - currentUsed} slots remaining.`
            );
          }

          const createdSubmission = await tx.blockSubmission.create({
            data: {
              blockId,
              actionType: "donate",
              name: donorName,
              qty: donorQty,
              dateOfBirth: donorDob,
              email: donorEmail,
              phone: donorPhone,
              whatsapp: donorWhatsapp,
              paymentMethod: "online",
              paymentReference,
            },
            select: {
              id: true,
              createdAt: true,
            },
          });

          await tx.blockName.create({
            data: { blockId, name: donorName, qty: donorQty },
          });

          const serialNumber = `DON-${blockId}-${String(createdSubmission.id).padStart(6, "0")}`;

          return tx.blockSubmission.update({
            where: { id: createdSubmission.id },
            data: { serialNumber },
            select: {
              id: true,
              createdAt: true,
              serialNumber: true,
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not process donation right now.";
      if (message.startsWith("Not enough space.")) {
        return NextResponse.json({ success: false, error: message }, { status: 400 });
      }
      return NextResponse.json(
        { success: false, error: "Another donation updated this block. Please retry." },
        { status: 409 }
      );
    }

    const donorAmount = donorQty * COST_PER_NAME;
    const serialNumber =
      submission.serialNumber ||
      `DON-${blockId}-${String(submission.id).padStart(6, "0")}`;

    // Emit SSE event for living wall
    eventBus.emit("donor:added", {
      type: "donation",
      blockId,
      name: donorName,
      qty: donorQty,
      amount: donorAmount,
    });

    return NextResponse.json({
      success: true,
      receipt: {
        trust_name: "KIRTAN SEVA TRUST",
        serial_number: serialNumber,
        action_type: "donate",
        donor_name: donorName,
        qty: donorQty,
        total_amount: amount || donorAmount,
        phone: donorPhone,
        whatsapp: donorWhatsapp,
        email: donorEmail || undefined,
        created_at: submission.createdAt.toISOString(),
        block_id: blockId,
        txn_id: paymentReference,
        allocations: [
          {
            block_id: blockId,
            qty: donorQty,
            amount: donorAmount,
            serial_number: serialNumber,
          },
        ],
      },
    });
  } catch (error) {
    console.error("Payment confirm error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save donation record. Please contact support." },
      { status: 500 }
    );
  }
}
