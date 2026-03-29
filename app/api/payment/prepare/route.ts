import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

const SECRET = process.env.PAYMENT_HMAC_SECRET ?? "kirtan-wall-fallback-secret";

/**
 * POST /api/payment/prepare
 *
 * Called client-side immediately before redirecting to the payment gateway.
 * Returns a short-lived HMAC token that ties this specific payment attempt
 * to our server. The token must be presented to /api/payment/confirm
 * to prevent anyone from crafting a fake success URL.
 *
 * Token format (base64url):  HMAC-SHA256( block_id|name|amount|ts , SECRET )
 * The raw payload (block_id, name, amount, ts) is also returned so the
 * client can store it alongside the token for later verification.
 */
export async function POST(req: NextRequest) {
  try {
    const { block_id, name, amount } = (await req.json()) as {
      block_id?: string;
      name?: string;
      amount?: number;
    };

    if (!block_id || !name || !amount) {
      return NextResponse.json(
        { success: false, error: "block_id, name, and amount are required." },
        { status: 400 }
      );
    }

    const ts = Date.now(); // ms timestamp
    const payload = `${block_id.toUpperCase()}|${name.trim()}|${amount}|${ts}`;
    const token = createHmac("sha256", SECRET)
      .update(payload)
      .digest("base64url");

    return NextResponse.json({ success: true, token, ts });
  } catch {
    return NextResponse.json(
      { success: false, error: "Failed to generate payment token." },
      { status: 500 }
    );
  }
}
