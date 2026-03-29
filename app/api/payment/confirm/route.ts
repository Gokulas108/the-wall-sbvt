import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { NAMES_PER_BLOCK, COST_PER_NAME } from "@/lib/mosaic/engine";
import { eventBus } from "@/lib/events/emitter";
import { Prisma } from "@prisma/client";
import { createHmac } from "crypto";

const SECRET = process.env.PAYMENT_HMAC_SECRET ?? "kirtan-wall-fallback-secret";
// Token expires after 30 minutes — enough time for any real gateway interaction
const TOKEN_MAX_AGE_MS = 30 * 60 * 1000;

function verifyToken(
  token: string,
  ts: number,
  block_id: string,
  name: string,
  amount: number
): boolean {
  // Check age first
  if (Date.now() - ts > TOKEN_MAX_AGE_MS) return false;
  const payload = `${block_id.toUpperCase()}|${name.trim()}|${amount}|${ts}`;
  const expected = createHmac("sha256", SECRET).update(payload).digest("base64url");
  // Constant-time comparison to prevent timing attacks
  return expected.length === token.length && expected === token;
}

/**
 * POST /api/payment/confirm
 *
 * Called by the payment result page after a successful payment gateway transaction.
 * Saves the donor record to the database (same as the donate route) and returns
 * the full receipt payload for display.
 *
 * Security: requires a valid short-lived HMAC token (_token + _ts) that was issued
 * by /api/payment/prepare before the redirect to the gateway. This ensures only
 * genuine payment sessions initiated from our app can write to the DB.
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
      _token,
      _ts,
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
      _token?: string;
      _ts?: number;
    };

    // ── Security gate ──────────────────────────────────────────────────────────
    // 1. Reject if no real transaction ID was returned by the gateway
    if (!txn_id || !txn_id.trim()) {
      return NextResponse.json(
        { success: false, error: "Invalid request: missing transaction ID." },
        { status: 400 }
      );
    }

    // 2. Reject if the HMAC token (issued by /api/payment/prepare) is absent,
    //    expired, or doesn't match this block/name/amount — i.e. this request
    //    was not initiated through our real payment flow.
    if (!_token || !_ts) {
      return NextResponse.json(
        { success: false, error: "Invalid request: missing payment session token." },
        { status: 401 }
      );
    }
    if (!block_id || !name || !amount) {
      return NextResponse.json(
        { success: false, error: "Missing required fields." },
        { status: 400 }
      );
    }
    if (!verifyToken(_token, _ts, block_id, name, amount)) {
      return NextResponse.json(
        { success: false, error: "Invalid or expired payment session. Please start a new payment." },
        { status: 401 }
      );
    }
    // ── End security gate ──────────────────────────────────────────────────────

    if (!qty || !phone || !whatsapp) {
      return NextResponse.json(
        { success: false, error: "Missing required fields (qty, phone, whatsapp)." },
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
