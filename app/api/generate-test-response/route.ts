import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

type DoubleTickInbound = {
  from?: string;
  message?: {
    type?: string;
    text?: string;
    payload?: string;
  };
};

type DoubleTickTemplateResponse = {
  success?: boolean;
  message?: string;
  data?: unknown;
};

type DonorLookup = {
  name: string;
  qty: number;
  blockId: string;
  serial: string;
};

type SubmissionResponse = {
  submission?: {
    id: number;
    blockId: string;
    serialNumber: string | null;
    actionType: string;
    name: string;
    qty: number;
    dateOfBirth: string;
    email: string;
    phone: string;
    whatsapp: string;
    collectedByUserId: number | null;
    pledgeDueDays: number | null;
    paymentMethod: string | null;
    paymentReference: string | null;
    createdAt: string;
  };
};

const DOUBLETICK_API_URL =
  "https://public.doubletick.io/v2/whatsapp/message/template";
const DOUBLETICK_TEXT_URL =
  "https://public.doubletick.io/whatsapp/message/text";
const DOUBLETICK_TYPING_URL =
  "https://public.doubletick.io/whatsapp/message/typing-indicator";
const DOUBLETICK_TEMPLATE_NAME = "donation_successful";
const DOUBLETICK_RECEIPT_TEMPLATE = "receipt_generation";
const DEFAULT_WABA_NUMBER = "919002977288";
const DETAILS_BUTTON_TEXT = "Enter Details";
const INTAKE_TTL_HOURS = 24;
const TYPING_DELAY_MS = 800;
const CERTIFICATE_BASE_URL =
  "https://sbvt-pdf-gen-13a632ead426.herokuapp.com/download-ticket";

function normalizeText(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function extractPincode(value: string) {
  const match = value.match(/\b\d{6}\b/);
  return match ? match[0] : null;
}

async function sendTextMessage(
  apiKey: string,
  from: string,
  to: string,
  text: string,
) {
  return fetch(DOUBLETICK_TEXT_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      from,
      to,
      content: { text },
    }),
  });
}

async function sendTypingIndicator(apiKey: string, from: string, to: string) {
  return fetch(DOUBLETICK_TYPING_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      wabaNumber: from,
      customerNumber: to,
    }),
  });
}

async function lookupDonorByWhatsapp(req: NextRequest, whatsapp: string) {
  const url = new URL("/api/block-submissions", req.nextUrl.origin);
  url.searchParams.set("whatsapp_number", whatsapp);
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) return null;
  const data = (await response.json()) as SubmissionResponse;
  const submission = data.submission;
  if (!submission) return null;
  if (!submission.serialNumber) return null;
  return {
    name: submission.name,
    qty: submission.qty,
    blockId: submission.blockId,
    serial: submission.serialNumber,
  } satisfies DonorLookup;
}

async function pause(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCertificateUrl(donor: DonorLookup) {
  const url = new URL(CERTIFICATE_BASE_URL);
  url.searchParams.set("name", donor.name);
  url.searchParams.set("qty", String(donor.qty));
  url.searchParams.set("block", donor.blockId);
  url.searchParams.set("serial", donor.serial);
  return url.toString();
}

export async function POST(req: NextRequest) {
  let payload: DoubleTickInbound;
  try {
    payload = (await req.json()) as DoubleTickInbound;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const messageText = normalizeText(payload.message?.text);
  const to = payload.from;
  if (!to) {
    return NextResponse.json(
      { ok: false, error: "Missing sender number in webhook payload." },
      { status: 400 },
    );
  }

  const apiKey = process.env.DOUBLETICK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing DOUBLETICK_API_KEY." },
      { status: 500 },
    );
  }

  const from = process.env.DOUBLETICK_WABA_NUMBER ?? DEFAULT_WABA_NUMBER;
  const language = process.env.DOUBLETICK_TEMPLATE_LANGUAGE ?? "en";
  const buttonTrigger =
    process.env.DOUBLETICK_DETAILS_BUTTON ?? DETAILS_BUTTON_TEXT;
  const normalizedButton = normalizeText(buttonTrigger);

  const intake = await prisma.whatsAppIntake.findUnique({
    where: { phone: to },
  });
  const intakeActive =
    intake &&
    intake.expiresAt.getTime() > Date.now() &&
    intake.status !== "completed";

  if (payload.message?.type === "BUTTON") {
    const buttonValue = normalizeText(
      payload.message?.payload ?? payload.message?.text,
    );
    if (buttonValue === normalizedButton) {
      const expiresAt = new Date(
        Date.now() + INTAKE_TTL_HOURS * 60 * 60 * 1000,
      );
      await prisma.whatsAppIntake.upsert({
        where: { phone: to },
        update: {
          status: "awaiting_legal_name",
          legalName: null,
          address: null,
          pincode: null,
          expiresAt,
        },
        create: {
          phone: to,
          status: "awaiting_legal_name",
          expiresAt,
        },
      });

      await sendTypingIndicator(apiKey, from, to);
      const askName = await sendTextMessage(
        apiKey,
        from,
        to,
        "Please reply with your legal name.\n*Example: _Abhay Charan_*",
      );
      if (!askName.ok) {
        const text = await askName.text();
        return NextResponse.json(
          {
            ok: false,
            error: "Failed to send legal name prompt.",
            status: askName.status,
            details: text,
          },
          { status: 502 },
        );
      }

      return NextResponse.json({ ok: true, step: "awaiting_legal_name" });
    }
  }

  if (payload.message?.type === "TEXT" && intakeActive) {
    const incomingText = payload.message?.text?.trim() ?? "";
    if (intake?.status === "awaiting_legal_name") {
      await prisma.whatsAppIntake.update({
        where: { phone: to },
        data: { legalName: incomingText, status: "awaiting_address" },
      });

      await sendTypingIndicator(apiKey, from, to);
      await pause(TYPING_DELAY_MS);
      const askAddress = await sendTextMessage(
        apiKey,
        from,
        to,
        "Please reply with your address and pincode.\n*Example: _ISKCON Mayapur, Mayapur, Nadia, West Bengal 741313_*",
      );
      if (!askAddress.ok) {
        const text = await askAddress.text();
        return NextResponse.json(
          {
            ok: false,
            error: "Failed to send address prompt.",
            status: askAddress.status,
            details: text,
          },
          { status: 502 },
        );
      }

      return NextResponse.json({ ok: true, step: "awaiting_address" });
    }

    if (intake?.status === "awaiting_address") {
      const pincode = extractPincode(incomingText);
      const donor =
        intake.donorName &&
        intake.donorQty &&
        intake.donorBlockId &&
        intake.donorSerial
          ? {
              name: intake.donorName,
              qty: intake.donorQty,
              blockId: intake.donorBlockId,
              serial: intake.donorSerial,
            }
          : null;
      const donorFallback = donor ? null : await lookupDonorByWhatsapp(req, to);
      const donorDetails = donor ?? donorFallback;

      if (!donorDetails) {
        await prisma.whatsAppIntake.update({
          where: { phone: to },
          data: {
            address: incomingText,
            pincode,
            status: "completed",
          },
        });

        await sendTypingIndicator(apiKey, from, to);
        const noMatch = await sendTextMessage(
          apiKey,
          from,
          to,
          "No submission found in this whatsapp number. Try a different one.",
        );
        if (!noMatch.ok) {
          const text = await noMatch.text();
          return NextResponse.json(
            {
              ok: false,
              error: "Failed to send no-submission response.",
              status: noMatch.status,
              details: text,
            },
            { status: 502 },
          );
        }

        return NextResponse.json({ ok: true, step: "no_submission" });
      }

      await prisma.whatsAppIntake.update({
        where: { phone: to },
        data: {
          address: incomingText,
          pincode,
          donorName: donorDetails.name,
          donorQty: donorDetails.qty,
          donorBlockId: donorDetails.blockId,
          donorSerial: donorDetails.serial,
          status: "completed",
        },
      });

      const pdfUrl = buildCertificateUrl(donorDetails);
      await sendTypingIndicator(apiKey, from, to);

      const receiptPayload = {
        messages: [
          {
            to,
            from,
            content: {
              templateName: DOUBLETICK_RECEIPT_TEMPLATE,
              language,
              templateData: {
                header: {
                  type: "DOCUMENT",
                  url: pdfUrl,
                  fileName: "receipt.pdf",
                },
                body: {
                  placeholders: [{ name: donorDetails.name }],
                },
              },
            },
          },
        ],
      };

      console.info("[doubletick] receipt payload", {
        to,
        from,
        templateName: DOUBLETICK_RECEIPT_TEMPLATE,
        pdfUrl,
        donorName: donorDetails.name,
      });

      const receiptResponse = await fetch(DOUBLETICK_API_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          Authorization: apiKey,
        },
        body: JSON.stringify(receiptPayload),
      });

      const receiptText = await receiptResponse.text();
      console.info("[doubletick] receipt response", {
        status: receiptResponse.status,
        ok: receiptResponse.ok,
        body: receiptText,
      });

      if (!receiptResponse.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: "Doubletick receipt request failed.",
            status: receiptResponse.status,
            details: receiptText,
          },
          { status: 502 },
        );
      }

      let receiptData: DoubleTickTemplateResponse | null = null;
      try {
        receiptData = receiptText
          ? (JSON.parse(receiptText) as DoubleTickTemplateResponse)
          : null;
      } catch {
        receiptData = null;
      }
      return NextResponse.json({ ok: true, step: "receipt_sent", receiptData });
    }
  }

  if (messageText !== "new") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const donor = await lookupDonorByWhatsapp(req, to);
  if (!donor) {
    await sendTypingIndicator(apiKey, from, to);
    const noMatch = await sendTextMessage(
      apiKey,
      from,
      to,
      "No submission found in this whatsapp number. Try a different one.",
    );
    if (!noMatch.ok) {
      const text = await noMatch.text();
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to send no-submission response.",
          status: noMatch.status,
          details: text,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, step: "no_submission" });
  }

  await prisma.whatsAppIntake.upsert({
    where: { phone: to },
    update: {
      donorName: donor.name,
      donorQty: donor.qty,
      donorBlockId: donor.blockId,
      donorSerial: donor.serial,
    },
    create: {
      phone: to,
      donorName: donor.name,
      donorQty: donor.qty,
      donorBlockId: donor.blockId,
      donorSerial: donor.serial,
      status: "ready",
      expiresAt: new Date(Date.now() + INTAKE_TTL_HOURS * 60 * 60 * 1000),
    },
  });

  const body = {
    messages: [
      {
        to,
        from,
        content: {
          templateName: DOUBLETICK_TEMPLATE_NAME,
          language,
          templateData: {
            body: {
              placeholders: [{ name: donor.name }],
            },
          },
        },
      },
    ],
  };

  const response = await fetch(DOUBLETICK_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json(
      {
        ok: false,
        error: "Doubletick request failed.",
        status: response.status,
        details: text,
      },
      { status: 502 },
    );
  }

  const data = (await response.json()) as DoubleTickTemplateResponse;
  return NextResponse.json({ ok: true, data });
}
