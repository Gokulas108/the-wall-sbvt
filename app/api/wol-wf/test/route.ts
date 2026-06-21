import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { prisma } from "@/lib/db/prisma";
import {
  resolveDoubletick,
  sendTemplateMessage,
  sendTemplateWithPlaceholders,
} from "@/lib/whatsapp/doubletick";
import {
  donorPlaceholderName,
  getWolNumberSummary,
  wolNoAddressV1Placeholders,
} from "@/lib/wol/context";
import { normalizeWhatsappNumber } from "@/lib/whatsapp-care/phone";

// Test-only trigger for the Wall-of-Legacy flow, driven by the /admin/wol-test dashboard.
// Mirrors app/api/wol-wf/route.ts but: it takes a synthetic `amount` that is persisted on
// the intake (testAmount) so the PAN branch can be exercised against a REAL donor's
// block_submissions; and it skips the 250/day cap, the send-log, and the single-operator
// restriction since test sends shouldn't count against the live campaign.
const TEMPLATE_ADDRESS_EXISTS = "wol_address_exists";
const TEMPLATE_NO_ADDRESS_V1 = "wol_no_address_v1";
const INTAKE_TTL_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { number?: unknown; amount?: unknown };
  try {
    body = (await req.json()) as { number?: unknown; amount?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawNumber = typeof body.number === "string" ? body.number.trim() : "";
  const phone = normalizeWhatsappNumber(rawNumber);
  if (!phone) {
    return NextResponse.json({ error: "A valid number is required" }, { status: 400 });
  }
  const amount =
    typeof body.amount === "number"
      ? body.amount
      : typeof body.amount === "string"
        ? Number(body.amount)
        : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive number" },
      { status: 400 },
    );
  }
  const testAmount = Math.round(amount);

  const cfg = resolveDoubletick();
  if (!cfg) {
    return NextResponse.json({ error: "Missing DOUBLETICK_API_KEY" }, { status: 500 });
  }

  // Upsert FIRST (keyed on the same normalized phone the inbound webhook will see) so the
  // summary below already reflects testAmount; reset prior detail fields for a clean run.
  const expiresAt = new Date(Date.now() + INTAKE_TTL_MS);
  await prisma.whatsAppIntake.upsert({
    where: { phone },
    update: {
      flow: "wol",
      status: "ready",
      testAmount,
      legalName: null,
      address: null,
      pincode: null,
      panNo: null,
      expiresAt,
    },
    create: {
      phone,
      flow: "wol",
      status: "ready",
      testAmount,
      expiresAt,
    },
  });

  const summary = await getWolNumberSummary(rawNumber);
  if (!summary.found) {
    return NextResponse.json(
      { ok: false, error: "No Wall of Legacy donor for this number" },
      { status: 404 },
    );
  }

  // Same template-choice logic as production wol-wf — but panSatisfied now reflects
  // testAmount, so amount > ₹10,000 sends "Enter Details" (collects name/address/PAN).
  // No details (or PAN still owed) → wol_no_address_v1 with [name, amount, date].
  const detailsOnFile = summary.hasDetails && summary.panSatisfied;
  const templateName = detailsOnFile ? TEMPLATE_ADDRESS_EXISTS : TEMPLATE_NO_ADDRESS_V1;
  const name = donorPlaceholderName(summary.donorNames);

  console.info("[wol-wf/test] sending template", {
    templateName,
    from: cfg.from,
    to: summary.normalizedNumber,
    language: cfg.language,
    name,
  });

  const res = detailsOnFile
    ? await sendTemplateMessage(
        cfg.apiKey,
        cfg.from,
        summary.normalizedNumber,
        templateName,
        cfg.language,
        name,
      )
    : await sendTemplateWithPlaceholders(
        cfg.apiKey,
        cfg.from,
        summary.normalizedNumber,
        templateName,
        cfg.language,
        wolNoAddressV1Placeholders(summary),
      );
  if (!res.ok) {
    const details = await res.text();
    return NextResponse.json(
      {
        ok: false,
        error: "Doubletick request failed",
        status: res.status,
        details,
        // What we attempted — so a Doubletick-side rejection is easy to diagnose.
        templateName,
        from: cfg.from,
        sentTo: summary.normalizedNumber,
        language: cfg.language,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    templateName,
    name,
    sentTo: summary.normalizedNumber,
    testAmount,
    panRequired: summary.panRequired,
  });
}
