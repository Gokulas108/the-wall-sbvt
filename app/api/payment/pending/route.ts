import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";

const SECRET = process.env.PAYMENT_HMAC_SECRET ?? "kirtan-wall-fallback-secret";

/**
 * POST /api/payment/pending
 *
 * Called by the client (web-app) immediately before redirecting to the gateway.
 * Saves the full donor intent to the pending_transactions table and returns:
 *   - api_key      : raw random key stored in the row (also sent to server HMAC)
 *   - api_key_hash : HMAC(api_key, SECRET) — sent in the redirect URL with 'api_' prefix
 *   - token / ts   : existing session HMAC guards for /api/payment/confirm (kept for compat)
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      block_id?: string;
      name?: string;
      qty?: number;
      date_of_birth?: string;
      email?: string;
      phone?: string;
      whatsapp?: string;
      address?: string;
      city?: string;
      state?: string;
      pincode?: string;
      pan_no?: string;
      amount?: number;
    };

    const {
      block_id,
      name,
      qty,
      date_of_birth,
      email,
      phone,
      whatsapp,
      address,
      city,
      state,
      pincode,
      pan_no,
      amount,
    } = body;

    if (!block_id || !name || !qty || !phone || !whatsapp || !amount) {
      return NextResponse.json(
        { success: false, error: "Missing required fields." },
        { status: 400 }
      );
    }

    // Generate a unique random api_key for this session
    const apiKey = randomBytes(24).toString("hex"); // 48 hex chars, unguessable
    const apiKeyHash = createHmac("sha256", SECRET).update(apiKey).digest("hex");

    // Also generate the session token (for backwards compat with confirm route)
    const ts = Date.now();
    const tokenPayload = `${block_id.toUpperCase()}|${name.trim()}|${amount}|${ts}`;
    const token = createHmac("sha256", SECRET).update(tokenPayload).digest("base64url");

    // Persist in DB — webhook will update this row to 'completed' on success
    await prisma.pendingTransaction.create({
      data: {
        apiKey,
        blockId: block_id.toUpperCase(),
        name: name.trim(),
        qty,
        dateOfBirth: (date_of_birth ?? "").trim(),
        email: (email ?? "").trim(),
        phone: phone.trim(),
        whatsapp: whatsapp.trim(),
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        pincode: pincode?.trim() || null,
        panNo: pan_no?.trim().toUpperCase() || null,
        amount,
        status: "pending",
      },
    });

    return NextResponse.json({ success: true, api_key: apiKey, api_key_hash: apiKeyHash, token, ts });
  } catch (e) {
    console.error("[payment/pending]", e);
    return NextResponse.json(
      { success: false, error: "Failed to create pending transaction." },
      { status: 500 }
    );
  }
}
