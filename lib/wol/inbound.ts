// ─────────────────────────────────────────────────────────────────────────────
// Wall-of-Legacy inbound state machine. Called from the single Doubletick inbound
// webhook (app/api/generate-test-response/route.ts) whenever the intake's flow is "wol",
// mirroring how the KKD flow already branches there.
//
// Buttons:
//   "Get Receipt"   (wol_address_exists)  → go straight to the receipt step
//   "Enter Details" (wol_no_address)      → collect legal name → address → [PAN] → receipts
//
// Text states: awaiting_legal_name → awaiting_address → [awaiting_pan] →
//   (wol_thankyou_receipt template) → receipt step. Multi-donor numbers branch to
//   awaiting_receipt_choice (reply "1" combined / "2" per-donor) before delivery.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { WhatsAppIntake } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { formatINR } from "@/lib/mosaic/engine";
import {
  sendDocumentMessage,
  sendTemplateMessage,
  sendTextMessage,
  sendTypingIndicator,
  type DoubletickConfig,
} from "@/lib/whatsapp/doubletick";
import {
  donorPlaceholderName,
  getWolNumberContext,
  getWolNumberSummary,
} from "@/lib/wol/context";
import {
  buildCertificates,
  buildReceipts,
  combinedReceiptRupees,
  resolveReceiptMode,
} from "@/lib/wol/receipts";

const THANKYOU_TEMPLATE = "wol_thankyou_receipt";
const INTAKE_TTL_MS = 24 * 60 * 60 * 1000;

const GET_RECEIPT_BUTTON = "get receipt";
const ENTER_DETAILS_BUTTON = "enter details";

export interface WolInboundMessage {
  type?: string;
  text?: string;
  payload?: string;
}

function normalizeText(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function extractPincode(value: string) {
  const match = value.match(/\b\d{6}\b/);
  return match ? match[0] : null;
}

// Collapse a multi-line address into one comma-separated line (same rule as the receipt flow).
function normalizeAddress(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/,+$/, "").trim())
    .filter((line) => line.length > 0)
    .join(", ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function isValidPan(value: string) {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value);
}

function expiry() {
  return new Date(Date.now() + INTAKE_TTL_MS);
}

// Deliver the receipt(s) + certificate(s) for a number, then mark the intake completed.
// `choice` selects combined ("1") vs per-donor ("2") for multi-donor numbers; for a single
// donor it's ignored. With no choice and >1 donor, asks the choice question instead.
async function runReceiptStep(
  to: string,
  cfg: DoubletickConfig,
  choice?: "1" | "2",
): Promise<NextResponse> {
  const { apiKey, from } = cfg;
  const ctx = await getWolNumberContext(to);

  if (!ctx.found || ctx.lines.length === 0) {
    await sendTextMessage(
      apiKey,
      from,
      to,
      "We couldn't find a Wall of Legacy contribution linked to this number.",
    );
    await prisma.whatsAppIntake.update({
      where: { phone: to },
      data: { status: "completed", expiresAt: expiry() },
    });
    return NextResponse.json({ ok: true, flow: "wol", step: "no_donation" });
  }

  if (ctx.lines.length > 1 && !choice) {
    const n = ctx.lines.length;
    const total = formatINR(combinedReceiptRupees(ctx));
    const prompt =
      `We found ${n} contributions linked to this number.\n\n` +
      `How would you like your receipt?\n\n` +
      `Reply *1* — one combined receipt for all ${n} (₹${total} total)\n` +
      `Reply *2* — separate receipts, one for each contribution\n\n` +
      `Either way, your inscription certificates are sent individually.`;
    await prisma.whatsAppIntake.update({
      where: { phone: to },
      data: { status: "awaiting_receipt_choice", expiresAt: expiry() },
    });
    await sendTypingIndicator(apiKey, from, to);
    await sendTextMessage(apiKey, from, to, prompt);
    return NextResponse.json({ ok: true, flow: "wol", step: "awaiting_receipt_choice" });
  }

  const mode = resolveReceiptMode(ctx, choice);
  const receipts = buildReceipts(ctx, mode);
  const certs = buildCertificates(ctx);
  const failures: string[] = [];

  await sendTypingIndicator(apiKey, from, to);
  await sendTextMessage(
    apiKey,
    from,
    to,
    receipts.length > 1 ? "Here are your receipts." : "Here is your receipt.",
  );
  for (const r of receipts) {
    const res = await sendDocumentMessage(apiKey, from, to, r.url, r.filename);
    if (!res.ok) failures.push(`receipt:${r.label}`);
  }

  await sendTextMessage(
    apiKey,
    from,
    to,
    certs.length > 1
      ? "And here are your inscription certificates. Thank you for your support."
      : "And here is your inscription certificate. Thank you for your support.",
  );
  for (const c of certs) {
    const res = await sendDocumentMessage(apiKey, from, to, c.url, c.filename);
    if (!res.ok) failures.push(`certificate:${c.donorName}`);
  }

  await prisma.whatsAppIntake.update({
    where: { phone: to },
    data: { status: "completed", expiresAt: expiry() },
  });
  return NextResponse.json({
    ok: failures.length === 0,
    flow: "wol",
    step: "receipt_sent",
    mode,
    receipts: receipts.length,
    certificates: certs.length,
    failures,
  });
}

// Once legal name + address are in: collect PAN if the total requires it, otherwise send the
// thank-you template and move to the receipt step.
async function afterDetailsCollected(
  to: string,
  cfg: DoubletickConfig,
): Promise<NextResponse> {
  const { apiKey, from, language } = cfg;
  const summary = await getWolNumberSummary(to);

  if (summary.panRequired && !summary.panNo) {
    await prisma.whatsAppIntake.update({
      where: { phone: to },
      data: { status: "awaiting_pan", expiresAt: expiry() },
    });
    await sendTypingIndicator(apiKey, from, to);
    await sendTextMessage(
      apiKey,
      from,
      to,
      "As your total contribution exceeds ₹10,000, please reply with the PAN of the donor named on the receipt.\nExample: ABCDE1234F",
    );
    return NextResponse.json({ ok: true, flow: "wol", step: "awaiting_pan" });
  }

  await sendTypingIndicator(apiKey, from, to);
  await sendTemplateMessage(
    apiKey,
    from,
    to,
    THANKYOU_TEMPLATE,
    language,
    donorPlaceholderName(summary.donorNames),
  );
  return runReceiptStep(to, cfg);
}

export async function handleWolInbound(
  to: string,
  message: WolInboundMessage | undefined,
  intake: WhatsAppIntake,
  cfg: DoubletickConfig,
): Promise<NextResponse> {
  const { apiKey, from } = cfg;
  const text = (message?.text ?? "").trim();
  const buttonValue = normalizeText(message?.payload ?? message?.text);

  // ── Button presses ───────────────────────────────────────────────────────
  if (message?.type === "BUTTON") {
    if (buttonValue === GET_RECEIPT_BUTTON) {
      return runReceiptStep(to, cfg);
    }
    if (buttonValue === ENTER_DETAILS_BUTTON) {
      await prisma.whatsAppIntake.update({
        where: { phone: intake.phone },
        data: {
          status: "awaiting_legal_name",
          legalName: null,
          address: null,
          pincode: null,
          panNo: null,
          expiresAt: expiry(),
        },
      });
      await sendTypingIndicator(apiKey, from, to);
      await sendTextMessage(
        apiKey,
        from,
        to,
        "*Please reply with your legal name.*\nExample: _Abhay Charan_",
      );
      return NextResponse.json({ ok: true, flow: "wol", step: "awaiting_legal_name" });
    }
    return NextResponse.json({ ok: true, flow: "wol", skipped: true });
  }

  // ── Text replies (state machine) ─────────────────────────────────────────
  if (message?.type === "TEXT") {
    if (intake.status === "awaiting_legal_name") {
      await prisma.whatsAppIntake.update({
        where: { phone: intake.phone },
        data: { legalName: text, status: "awaiting_address", expiresAt: expiry() },
      });
      await sendTypingIndicator(apiKey, from, to);
      await sendTextMessage(
        apiKey,
        from,
        to,
        "*Please reply with your address and pincode.*\nExample: _ISKCON Mayapur, Mayapur, Nadia, West Bengal 741313_",
      );
      return NextResponse.json({ ok: true, flow: "wol", step: "awaiting_address" });
    }

    if (intake.status === "awaiting_address") {
      const address = normalizeAddress(text);
      const pincode = extractPincode(address);
      await prisma.whatsAppIntake.update({
        where: { phone: intake.phone },
        data: { address, pincode, expiresAt: expiry() },
      });
      return afterDetailsCollected(to, cfg);
    }

    if (intake.status === "awaiting_pan") {
      const pan = text.toUpperCase().replace(/\s+/g, "");
      if (!isValidPan(pan)) {
        await sendTextMessage(
          apiKey,
          from,
          to,
          "That doesn't look like a valid PAN. Please reply with the 10-character PAN.\nExample: ABCDE1234F",
        );
        return NextResponse.json({ ok: true, flow: "wol", step: "awaiting_pan_retry" });
      }
      await prisma.whatsAppIntake.update({
        where: { phone: intake.phone },
        data: { panNo: pan, expiresAt: expiry() },
      });
      const summary = await getWolNumberSummary(to);
      await sendTypingIndicator(apiKey, from, to);
      await sendTemplateMessage(
        apiKey,
        from,
        to,
        THANKYOU_TEMPLATE,
        cfg.language,
        donorPlaceholderName(summary.donorNames),
      );
      return runReceiptStep(to, cfg);
    }

    if (intake.status === "awaiting_receipt_choice") {
      const choice = text.trim();
      if (choice !== "1" && choice !== "2") {
        await sendTextMessage(
          apiKey,
          from,
          to,
          "Please reply *1* for a single combined receipt, or *2* for separate receipts.",
        );
        return NextResponse.json({
          ok: true,
          flow: "wol",
          step: "awaiting_receipt_choice_retry",
        });
      }
      return runReceiptStep(to, cfg, choice);
    }
  }

  return NextResponse.json({ ok: true, flow: "wol", skipped: true });
}
