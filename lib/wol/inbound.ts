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
import {
  answerFromKnowledgeBase,
  extractIntake,
  extractPan,
  extractReceiptChoice,
  type IntakeIntent,
} from "@/lib/whatsapp/groq";

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

// Anti-hallucination guard. A small model sometimes invents a name — returning "John" or
// "assistant" for a message like "who is this?". A name the donor actually typed will appear
// in their message, so require every letter-token (2+ chars, any script) of the extracted
// name to be present in the original text before we trust it. Blocks the invented value
// while still accepting a real name the donor wrote in any case/script.
function nameGroundedInText(name: string, text: string): boolean {
  const haystack = text.toLowerCase();
  const tokens = name.toLowerCase().match(/\p{L}{2,}/gu);
  if (!tokens || tokens.length === 0) return false;
  return tokens.every((token) => haystack.includes(token));
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
  for (const r of receipts) {
    const res = await sendDocumentMessage(apiKey, from, to, r.url, r.filename);
    if (!res.ok) failures.push(`receipt:${r.label}`);
  }
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

type CollectField = "name" | "address" | "pan" | "choice";

// The LLM only classified the message; the BACKEND decides we stay in this state and
// what to reply. Questions get a birnagar.md-grounded answer first; greetings get a warm
// prefix; anything else a gentle apology — then we always re-ask the current field. Tone
// stays calm and service-minded.
async function handleIntent(
  intent: IntakeIntent,
  field: CollectField,
  userText: string,
  to: string,
  cfg: DoubletickConfig,
): Promise<void> {
  const reAsk: Record<CollectField, string> = {
    name: "Could you please share your full legal name?\nExample: _Abhay Charan_",
    address:
      "Kindly share your full address so we may complete your receipt.\nExample: _ISKCON Mayapur, Nadia, West Bengal 741313_",
    pan: "As your total contribution exceeds ₹10,000, please reply with the donor's 10-character PAN.\nExample: ABCDE1234F",
    choice:
      "Please reply *1* for one combined receipt, or *2* for separate receipts.",
  };
  let body: string;
  if (intent === "GREETING") {
    body = `Hare Krishna 🙏\n${reAsk[field]}`;
  } else if (intent === "QUESTION") {
    const answer = await answerFromKnowledgeBase(userText);
    body = `${answer}\n\n${reAsk[field]}`;
  } else {
    body = `Apologies, I couldn't understand that clearly. ${reAsk[field]}`;
  }
  await sendTypingIndicator(cfg.apiKey, cfg.from, to);
  await sendTextMessage(cfg.apiKey, cfg.from, to, body);
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
      const ex = await extractIntake(text);
      // A GREETING or QUESTION is never a name — route it to handleIntent so "who is this?"
      // gets answered, not saved. And only trust an extracted name that's actually grounded
      // in what the donor typed, so a hallucinated "John"/"assistant" can never be stored.
      const isQuestionOrGreeting =
        ex.intent === "GREETING" || ex.intent === "QUESTION";
      if (!isQuestionOrGreeting && ex.name && nameGroundedInText(ex.name, text)) {
        await prisma.whatsAppIntake.update({
          where: { phone: intake.phone },
          data: {
            legalName: ex.name,
            status: "awaiting_address",
            expiresAt: expiry(),
          },
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
      await handleIntent(ex.intent, "name", text, to, cfg);
      return NextResponse.json({
        ok: true,
        flow: "wol",
        step: "awaiting_legal_name",
        intent: ex.intent,
      });
    }

    if (intake.status === "awaiting_address") {
      const ex = await extractIntake(text);
      // Same guard as the name state: a GREETING/QUESTION is never an address — answer or
      // redirect instead of storing a stray value.
      const isQuestionOrGreeting =
        ex.intent === "GREETING" || ex.intent === "QUESTION";
      if (!isQuestionOrGreeting && ex.address) {
        const address = normalizeAddress(ex.address);
        // The LLM's address may drop the 6-digit PIN; fall back to the raw reply for it.
        const pincode = extractPincode(address) ?? extractPincode(text);
        await prisma.whatsAppIntake.update({
          where: { phone: intake.phone },
          data: { address, pincode, expiresAt: expiry() },
        });
        return afterDetailsCollected(to, cfg);
      }
      await handleIntent(ex.intent, "address", text, to, cfg);
      return NextResponse.json({
        ok: true,
        flow: "wol",
        step: "awaiting_address",
        intent: ex.intent,
      });
    }

    if (intake.status === "awaiting_pan") {
      // Deterministic fast path: a cleanly-typed PAN never reaches the LLM. Only on a miss
      // do we ask Groq to pull a PAN out of a sentence — and isValidPan still gates storage,
      // so the LLM can never persist an invalid/hallucinated PAN.
      const directPan = text.toUpperCase().replace(/\s+/g, "");
      let pan = isValidPan(directPan) ? directPan : null;
      if (!pan) {
        const ex = await extractPan(text);
        const candidate = ex.pan ? ex.pan.toUpperCase().replace(/\s+/g, "") : null;
        if (candidate && isValidPan(candidate)) {
          pan = candidate;
        } else {
          await handleIntent(ex.intent, "pan", text, to, cfg);
          return NextResponse.json({ ok: true, flow: "wol", step: "awaiting_pan_retry" });
        }
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
      // Literal "1"/"2" wins outright; otherwise let the LLM map fuzzy language
      // ("together" → 1, "each" → 2). Only a resolved 1/2 advances, so an ambiguous reply
      // never silently picks the wrong receipt format.
      const trimmed = text.trim();
      let choice: "1" | "2" | null =
        trimmed === "1" ? "1" : trimmed === "2" ? "2" : null;
      if (!choice) {
        const ex = await extractReceiptChoice(text);
        if (ex.choice === "1" || ex.choice === "2") {
          choice = ex.choice;
        } else {
          await handleIntent(ex.intent, "choice", text, to, cfg);
          return NextResponse.json({
            ok: true,
            flow: "wol",
            step: "awaiting_receipt_choice_retry",
          });
        }
      }
      return runReceiptStep(to, cfg, choice);
    }
  }

  return NextResponse.json({ ok: true, flow: "wol", skipped: true });
}
