import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { NAMES_PER_BLOCK, COST_PER_NAME } from "@/lib/mosaic/engine";
import { eventBus } from "@/lib/events/emitter";
import { Prisma } from "@prisma/client";

const SECRET = process.env.PAYMENT_HMAC_SECRET ?? "kirtan-wall-fallback-secret";

const ALLOWED_ORIGINS = [
  "birnagar.org",
  "test.birnagar.org",
  "www.birnagar.org"
];

function originAllowed(req: NextRequest): boolean {
  // Check both Origin and X-Forwarded-Host headers (S2S may not send Origin)
  const origin = req.headers.get("origin") ?? "";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return ALLOWED_ORIGINS.some(
    (allowed) => origin.includes(allowed) || host.includes(allowed)
  );
}

/**
 * POST /api/webhooks/payment
 *
 * Server-to-server webhook called by birnagar.org / test.birnagar.org after a
 * successful payment. Validates the api_key, marks the pending_transaction as
 * completed, and atomically creates the block_submission + block_name records.
 *
 * Expected body (JSON):
 *   {
 *     api_key   : "api_<hmac-hex>"  — echoed from the redirect URL
 *     txn_id    : "GW-TXN-XXXXXX"  — gateway transaction ID
 *     status    : "success"
 *   }
 */
export async function POST(req: NextRequest) {
  // ── Origin guard ────────────────────────────────────────────────────────────
  // Allow localhost in dev, and birnagar.org hosts in prod.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
  if (!isLocal && !originAllowed(req)) {
    return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });
  }

  let body: { api_key?: string; txn_id?: string; status?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { api_key: rawApiKeyParam, txn_id, status } = body;

  // ── Validate incoming fields ────────────────────────────────────────────────
  if (!rawApiKeyParam || !txn_id || !status) {
    return NextResponse.json(
      { success: false, error: "Missing required fields: api_key, txn_id, status." },
      { status: 400 }
    );
  }

  if (status !== "success") {
    // Non-success: mark the pending tx as failed.
    // The api_key param is in the same "api_<HMAC(storedKey, SECRET)>" format as success.
    // Strip "api_" to get the received hash, then find the pending row whose
    // HMAC(apiKey, SECRET) matches — same lookup logic as the success path.
    if (!rawApiKeyParam.startsWith("api_")) {
      return NextResponse.json({ success: true, message: "Marked as failed (no key to match)." });
    }
    const receivedHashFailed = rawApiKeyParam.slice(4);

    const allPending = await prisma.pendingTransaction.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const matched = allPending.find((row: { id: number; apiKey: string }) =>
      createHmac("sha256", SECRET).update(row.apiKey).digest("hex") === receivedHashFailed
    );
    if (matched) {
      await prisma.pendingTransaction.update({
        where: { id: matched.id },
        data: { status: "failed", txnId: txn_id, completedAt: new Date() },
      });
    }
    return NextResponse.json({ success: true, message: matched ? "Marked as failed." : "No matching pending transaction found." });
  }

  // ── api_key validation ──────────────────────────────────────────────────────
  // The incoming api_key is in the format "api_<hmac(rawKey, SECRET)>"
  // We need to look up the pending_transaction whose api_key, when HMAC'd,
  // matches the received hash — this proves the row was created by our server.
  if (!rawApiKeyParam.startsWith("api_")) {
    return NextResponse.json(
      { success: false, error: "Invalid api_key format." },
      { status: 400 }
    );
  }
  const receivedHash = rawApiKeyParam.slice(4); // strip "api_"

  // Load all pending transactions and find the one whose key matches
  // (we search pending only — completed rows are skipped for idempotency)
  const pendingRows = await prisma.pendingTransaction.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
    take: 200, // safety limit
  });

  const pendingTx = pendingRows.find((row) => {
    const hash = createHmac("sha256", SECRET).update(row.apiKey).digest("hex");
    return hash === receivedHash;
  });

  if (!pendingTx) {
    // Check if already completed (idempotency — gateway may retry)
    const completedRows = await prisma.pendingTransaction.findMany({
      where: { status: "completed", txnId: txn_id },
      take: 1,
    });
    if (completedRows.length > 0) {
      return NextResponse.json({ success: true, message: "Already processed." });
    }
    return NextResponse.json(
      { success: false, error: "Pending transaction not found or already processed." },
      { status: 404 }
    );
  }

  // ── Atomically create block_submission + block_name ─────────────────────────
  const {
    blockId,
    name,
    qty,
    dateOfBirth,
    email,
    phone,
    whatsapp,
    address,
    city,
    state,
    pincode,
    panNo,
    amount,
    id: pendingId,
  } = pendingTx;
  const costPerName = COST_PER_NAME;

  try {
    await prisma.$transaction(
      async (tx) => {
        // Check capacity
        const used = await tx.blockName.aggregate({
          where: { blockId },
          _sum: { qty: true },
        });
        const currentUsed = used._sum.qty ?? 0;
        if (currentUsed + qty > NAMES_PER_BLOCK) {
          throw new Error(`Not enough space in block ${blockId}.`);
        }

        // Create submission
        const submission = await tx.blockSubmission.create({
          data: {
            blockId,
            actionType: "online_donate",
            name,
            qty,
            dateOfBirth,
            email,
            phone,
            whatsapp,
            address,
            city,
            state,
            pincode,
            panNo,
            paymentMethod: "online",
            paymentReference: txn_id,
            serialNumber: `ONL-${blockId}-${txn_id.slice(-6).toUpperCase()}`,
          },
          select: { id: true, createdAt: true },
        });

        // Create block name entry
        await tx.blockName.create({ data: { blockId, name, qty } });

        // Mark pending transaction as completed
        await tx.pendingTransaction.update({
          where: { id: pendingId },
          data: {
            status: "completed",
            txnId: txn_id,
            completedAt: new Date(),
          },
        });

        return submission;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    // Emit SSE event for live wall update
    eventBus.emit("donor:added", {
      type: "online_donation",
      blockId,
      name,
      qty,
      amount,
    });

    return NextResponse.json({ success: true, message: "Donation recorded." });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to record donation.";
    console.error("[webhooks/payment]", error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
