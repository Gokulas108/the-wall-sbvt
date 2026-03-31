import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

const SECRET = process.env.PAYMENT_HMAC_SECRET ?? "kirtan-wall-fallback-secret";

/**
 * POST /api/payment/prepare
 *
 * Called client-side immediately before redirecting to the payment gateway.
 * Returns two server-signed values:
 *
 *  1. `token`    – HMAC of block_id|name|amount|ts (for /api/payment/confirm)
 *  2. `key_hash` – HMAC of the client-supplied `raw_key` (hex, returned to client
 *                  so it can be sent in the redirect URL as api_<key_hash>).
 *                  The SECRET never leaves the server.
 */
export async function POST(req: NextRequest) {
  try {
    const { block_id, name, amount, raw_key } = (await req.json()) as {
      block_id?: string;
      name?: string;
      amount?: number;
      raw_key?: string;
    };

    if (!block_id || !name || !amount) {
      return NextResponse.json(
        { success: false, error: "block_id, name, and amount are required." },
        { status: 400 }
      );
    }

    // 1. Session token (ties block/name/amount/timestamp to server)
    const ts = Date.now();
    const payload = `${block_id.toUpperCase()}|${name.trim()}|${amount}|${ts}`;
    const token = createHmac("sha256", SECRET).update(payload).digest("base64url");

    // 2. key_hash — hashes the client's raw_key using the server secret
    //    Client stores raw_key in sessionStorage; sends key_hash in the URL.
    //    Verification later hashes raw_key again server-side and compares.
    let key_hash: string | null = null;
    if (raw_key && raw_key.trim()) {
      key_hash = createHmac("sha256", SECRET).update(raw_key.trim()).digest("hex");
    }

    return NextResponse.json({ success: true, token, ts, key_hash });
  } catch {
    return NextResponse.json(
      { success: false, error: "Failed to generate payment token." },
      { status: 500 }
    );
  }
}
