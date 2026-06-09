import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { prisma } from "@/lib/db/prisma";
import {
  resolveDoubletick,
  sendTemplateMessage,
} from "@/lib/whatsapp/doubletick";
import {
  donorPlaceholderName,
  getWolNumberSummary,
} from "@/lib/wol/context";
import { getWolSendStatus, recordWolSend } from "@/lib/wol/cap";

// Outbound trigger for the Wall-of-Legacy campaign — admin-triggered from the WhatsApp Care
// view, restricted to a single operator. Sends the initial template (the only message that
// counts against the 250/day cap) and pre-tags the intake as flow="wol" so the inbound
// webhook routes the donor's button/text replies to the WoL handler. Mirrors kkd-wf.
const WOL_SENDER_USERNAME = "gokul";
const TEMPLATE_ADDRESS_EXISTS = "wol_address_exists";
const TEMPLATE_NO_ADDRESS = "wol_no_address";
const INTAKE_TTL_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (admin.username !== WOL_SENDER_USERNAME) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const number =
    req.nextUrl.searchParams.get("number")?.trim() ||
    req.nextUrl.searchParams.get("whatsapp")?.trim() ||
    "";
  if (!number) {
    return NextResponse.json({ error: "number is required" }, { status: 400 });
  }

  const cfg = resolveDoubletick();
  if (!cfg) {
    return NextResponse.json({ error: "Missing DOUBLETICK_API_KEY" }, { status: 500 });
  }

  const status = await getWolSendStatus();
  if (status.remaining <= 0) {
    return NextResponse.json(
      { ok: false, error: "Daily WhatsApp limit reached", status },
      { status: 429 },
    );
  }

  const summary = await getWolNumberSummary(number);
  if (!summary.found) {
    return NextResponse.json(
      { ok: false, error: "No Wall of Legacy donor for this number" },
      { status: 404 },
    );
  }

  // Address (and PAN, when required) already on file → "Get Receipt" template; else collect.
  const templateName =
    summary.hasDetails && summary.panSatisfied
      ? TEMPLATE_ADDRESS_EXISTS
      : TEMPLATE_NO_ADDRESS;
  const phone = summary.normalizedNumber;
  const name = donorPlaceholderName(summary.donorNames);

  await prisma.whatsAppIntake.upsert({
    where: { phone },
    update: { flow: "wol", status: "ready", expiresAt: new Date(Date.now() + INTAKE_TTL_MS) },
    create: { phone, flow: "wol", status: "ready", expiresAt: new Date(Date.now() + INTAKE_TTL_MS) },
  });

  const res = await sendTemplateMessage(
    cfg.apiKey,
    cfg.from,
    phone,
    templateName,
    cfg.language,
    name,
  );

  if (!res.ok) {
    const details = await res.text();
    await recordWolSend({
      normalizedPhone: phone,
      templateName,
      donorName: name,
      status: "failed",
      userId: admin.id,
      username: admin.username,
    });
    return NextResponse.json(
      { ok: false, error: "Doubletick request failed", status: res.status, details },
      { status: 502 },
    );
  }

  await recordWolSend({
    normalizedPhone: phone,
    templateName,
    donorName: name,
    status: "sent",
    userId: admin.id,
    username: admin.username,
  });

  return NextResponse.json({
    ok: true,
    templateName,
    name,
    donorCount: summary.donorCount,
    status: await getWolSendStatus(),
  });
}
