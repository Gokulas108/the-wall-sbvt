import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { formatINR } from "@/lib/mosaic/engine";

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
  email: string;
  phone: string;
  paymentReference: string | null;
  createdAt: string;
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
const DOUBLETICK_DOCUMENT_URL =
  "https://public.doubletick.io/whatsapp/message/document";
const DOUBLETICK_TYPING_URL =
  "https://public.doubletick.io/whatsapp/message/typing-indicator";
const DOUBLETICK_TEMPLATE_NAME = "donation_successful";
const DOUBLETICK_RECEIPT_TEMPLATE = "receipt_generation";
const DEFAULT_WABA_NUMBER = "919002977288";
const DETAILS_BUTTON_TEXT = "Enter Details";
const INTAKE_TTL_HOURS = 24;
const TYPING_DELAY_MS = 1500;
const CERTIFICATE_BASE_URL =
  "https://sbvt-pdf-gen-13a632ead426.herokuapp.com/download-ticket";
const RECEIPT_BASE_URL =
  "https://sbvt-pdf-gen-13a632ead426.herokuapp.com/generate-reciept";
const NOTES_TEXT =
  "Towards the contribution for Srila Bhaktivinoda Thakur's Wall Of Legacy Campaign.";
const RUPEE_SYMBOL = "₹";
const AMOUNT_SUFFIX = "/-";
const DONATION_URL = "https://birnagar.org/donation";

function normalizeText(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function extractPincode(value: string) {
  const match = value.match(/\b\d{6}\b/);
  return match ? match[0] : null;
}

// Collapse a multi-line address into a single comma-separated line. Trailing
// commas on each line are stripped first so newline-joined parts never produce
// a double comma, and runs of spaces/tabs are collapsed.
function normalizeAddress(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/,+$/, "").trim())
    .filter((line) => line.length > 0)
    .join(", ")
    .replace(/[ \t]+/g, " ")
    .trim();
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

async function sendDocumentMessage(
  apiKey: string,
  from: string,
  to: string,
  mediaUrl: string,
  filename: string,
) {
  return fetch(DOUBLETICK_DOCUMENT_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      from,
      to,
      content: {
        mediaUrl,
        filename,
      },
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
    email: submission.email,
    phone: submission.phone,
    paymentReference: submission.paymentReference,
    createdAt: submission.createdAt,
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

function formatDateOnly(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function randomReceiptNumber() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `R-${num}`;
}

function numberToWords(value: number) {
  const ones = [
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];

  function chunkToWords(num: number): string {
    if (num < 20) return ones[num];
    if (num < 100) {
      const ten = Math.floor(num / 10);
      const rest = num % 10;
      return rest ? `${tens[ten]} ${ones[rest]}` : tens[ten];
    }
    const hundred = Math.floor(num / 100);
    const rest = num % 100;
    return rest
      ? `${ones[hundred]} Hundred ${chunkToWords(rest)}`
      : `${ones[hundred]} Hundred`;
  }

  if (value === 0) return "Zero";
  const parts: string[] = [];
  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1_000);
  const remainder = value % 1_000;

  if (millions) parts.push(`${chunkToWords(millions)} Million`);
  if (thousands) parts.push(`${chunkToWords(thousands)} Thousand`);
  if (remainder) parts.push(chunkToWords(remainder));
  return parts.join(" ");
}

function buildReceiptUrl(
  donor: DonorLookup,
  legalName: string,
  address: string,
  pincode: string | null,
  receiptDate: string,
) {
  const amount = donor.qty * 1000;
  const amountText = `${RUPEE_SYMBOL}${amount}${AMOUNT_SUFFIX}`;
  const amountWords = `${numberToWords(amount)} Only`;
  const url = new URL(RECEIPT_BASE_URL);
  url.searchParams.set("receipt_no", randomReceiptNumber());
  url.searchParams.set("receipt_date", receiptDate);
  url.searchParams.set("legal_name", legalName);
  url.searchParams.set("address", address);
  url.searchParams.set("pincode", pincode ?? "");
  url.searchParams.set("phone_no", donor.phone);
  url.searchParams.set("email", donor.email ?? "");
  url.searchParams.set("payment_reference", donor.paymentReference ?? "");
  url.searchParams.set("pan_no", "");
  url.searchParams.set("payment_date", formatDateOnly(donor.createdAt));
  url.searchParams.set("amount", amountText);
  url.searchParams.set("amount_in_words", amountWords);
  url.searchParams.set("notes", NOTES_TEXT);
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
        "*Please reply with your legal name.*\nExample: _Abhay Charan_",
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
        "*Please reply with your address and pincode.*\nExample: _ISKCON Mayapur, Mayapur, Nadia, West Bengal 741313_",
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
      const address = normalizeAddress(incomingText);
      const pincode = extractPincode(address);

      // kkd collection flow: save legal name + address + pincode only. No donor
      // lookup or receipt — this flow has no link to block_submissions.
      if (intake.flow === "kkd") {
        await prisma.whatsAppIntake.update({
          where: { phone: to },
          data: { address, pincode, status: "completed" },
        });

        const commitment = await prisma.kkdCollection.findFirst({
          where: { whatsapp: to },
        });

        const lines = ["Thank you for sharing your details! 🙏"];
        if (commitment && commitment.amtCommitted !== commitment.amtReceived) {
          lines.push(
            `Committed: ${RUPEE_SYMBOL}${formatINR(commitment.amtCommitted)} · Received: ${RUPEE_SYMBOL}${formatINR(commitment.amtReceived)}`,
          );
        }
        lines.push(`Donate now: ${DONATION_URL}`);

        await sendTypingIndicator(apiKey, from, to);
        const thanks = await sendTextMessage(
          apiKey,
          from,
          to,
          lines.join("\n\n"),
        );
        if (!thanks.ok) {
          const text = await thanks.text();
          return NextResponse.json(
            {
              ok: false,
              error: "Failed to send kkd confirmation.",
              status: thanks.status,
              details: text,
            },
            { status: 502 },
          );
        }

        return NextResponse.json({ ok: true, step: "kkd_saved" });
      }

      const donor =
        intake.donorName &&
        intake.donorQty &&
        intake.donorBlockId &&
        intake.donorSerial &&
        intake.donorEmail &&
        intake.donorPhone &&
        intake.donorCreatedAt
          ? {
              name: intake.donorName,
              qty: intake.donorQty,
              blockId: intake.donorBlockId,
              serial: intake.donorSerial,
              email: intake.donorEmail,
              phone: intake.donorPhone,
              paymentReference: intake.donorPaymentReference ?? null,
              createdAt: intake.donorCreatedAt.toISOString(),
            }
          : null;
      const donorFallback = donor ? null : await lookupDonorByWhatsapp(req, to);
      const donorDetails = donor ?? donorFallback;

      if (!donorDetails) {
        await prisma.whatsAppIntake.update({
          where: { phone: to },
          data: {
            address,
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
          address,
          pincode,
          donorName: donorDetails.name,
          donorQty: donorDetails.qty,
          donorBlockId: donorDetails.blockId,
          donorSerial: donorDetails.serial,
          donorEmail: donorDetails.email,
          donorPhone: donorDetails.phone,
          donorPaymentReference: donorDetails.paymentReference ?? null,
          donorCreatedAt: new Date(donorDetails.createdAt),
          status: "completed",
        },
      });

      const receiptDate = formatDateOnly(new Date());
      const pdfUrl = buildCertificateUrl(donorDetails);
      const generatedReceiptUrl = buildReceiptUrl(
        donorDetails,
        intake?.legalName ?? donorDetails.name,
        address,
        pincode,
        receiptDate,
      );
      await sendTypingIndicator(apiKey, from, to);

      const receiptDocResponse = await sendDocumentMessage(
        apiKey,
        from,
        to,
        generatedReceiptUrl,
        "receipt.pdf",
      );
      if (!receiptDocResponse.ok) {
        const text = await receiptDocResponse.text();
        return NextResponse.json(
          {
            ok: false,
            error: "Doubletick receipt document failed.",
            status: receiptDocResponse.status,
            details: text,
          },
          { status: 502 },
        );
      }

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
                  mediaUrl: pdfUrl,
                  filename: "WoL-Certificate.pdf",
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
      donorEmail: donor.email,
      donorPhone: donor.phone,
      donorPaymentReference: donor.paymentReference ?? null,
      donorCreatedAt: new Date(donor.createdAt),
    },
    create: {
      phone: to,
      donorName: donor.name,
      donorQty: donor.qty,
      donorBlockId: donor.blockId,
      donorSerial: donor.serial,
      donorEmail: donor.email,
      donorPhone: donor.phone,
      donorPaymentReference: donor.paymentReference ?? null,
      donorCreatedAt: new Date(donor.createdAt),
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
