import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { normalizeWhatsappNumber } from "@/lib/whatsapp-care/phone";
import { bustAddressCollectionCache } from "@/lib/whatsapp-care/address-collection";

// POST /api/webhooks/doubletick-status — RECEIVE-ONLY delivery/status callback from
// Doubletick. It never sends a WhatsApp message; it records per-number delivery
// outcomes so the WhatsApp Care tab can infer whether a number is real.
//
// Auth: a shared secret (DOUBLETICK_WEBHOOK_TOKEN) in ?token= or the Authorization
// header — the payment webhook's host allow-list can't be used here because Doubletick
// is an external SaaS whose callback host we don't control. Localhost is exempt for dev.
//
// DEFENSIVE: we have not confirmed Doubletick's status-callback payload shape, so we log
// the raw body first and probe several common BSP field names. Tighten once verified.
// Writes ONLY the inferred fields — never the manual isInvalid / notes.

const DELIVERED_STATUSES = new Set(["delivered", "read", "sent"]);
const FAILED_STATUSES = new Set(["failed", "undelivered", "rejected", "deleted"]);

export async function POST(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
  const expected = process.env.DOUBLETICK_WEBHOOK_TOKEN ?? "";
  const got = req.nextUrl.searchParams.get("token") ?? req.headers.get("authorization") ?? "";
  if (!isLocal && (!expected || got !== expected)) {
    return NextResponse.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const payload = await req.json().catch(() => null);
  if (!payload) return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });

  // Log the raw shape first so we can confirm field names against a real callback.
  console.info("[doubletick-status] raw", JSON.stringify(payload));

  const events: Record<string, unknown>[] = Array.isArray(payload?.messages)
    ? payload.messages
    : Array.isArray(payload?.statuses)
      ? payload.statuses
      : [payload];

  let updated = 0;
  for (const e of events) {
    const rawNumber =
      e?.destination ?? e?.recipient ?? e?.to ?? e?.customerNumber ?? e?.phone ?? payload?.from;
    const rawStatus = String(e?.status ?? e?.eventType ?? e?.event ?? "").toLowerCase();
    const key = normalizeWhatsappNumber(String(rawNumber ?? ""));
    if (!key || !rawStatus) continue;

    const inferred = DELIVERED_STATUSES.has(rawStatus)
      ? "exists"
      : FAILED_STATUSES.has(rawStatus)
        ? "likely_invalid"
        : null;

    await prisma.whatsAppNumberAnnotation.upsert({
      where: { normalizedPhone: key },
      create: {
        normalizedPhone: key,
        lastDeliveryStatus: rawStatus,
        lastDeliveryAt: new Date(),
        ...(inferred ? { whatsappStatus: inferred } : {}),
      },
      update: {
        lastDeliveryStatus: rawStatus,
        lastDeliveryAt: new Date(),
        ...(inferred ? { whatsappStatus: inferred } : {}),
      },
    });
    updated++;
  }

  if (updated > 0) bustAddressCollectionCache();
  return NextResponse.json({ ok: true, updated });
}
