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

type SearchResult = {
  kind: string;
  label: string;
  block_id: string;
  qty: number;
  created_at: string;
  subtitle: string | null;
  serial_number: string | null;
  action_type: string | null;
  phone: string | null;
  email: string | null;
};

type SearchResponse = {
  query: string;
  results: SearchResult[];
};

const DOUBLETICK_API_URL =
  "https://public.doubletick.io/v2/whatsapp/message/template";
const DOUBLETICK_TEXT_URL =
  "https://public.doubletick.io/whatsapp/message/text";
const DOUBLETICK_TYPING_URL =
  "https://public.doubletick.io/whatsapp/message/typing-indicator";
const DOUBLETICK_TEMPLATE_NAME = "donation_successful";
const DEFAULT_TEMPLATE_NAME_VALUE = "Satya";
const DEFAULT_WABA_NUMBER = "919002977288";
const DETAILS_BUTTON_TEXT = "Enter Details";
const INTAKE_TTL_HOURS = 24;
const TYPING_DELAY_MS = 700;

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

async function lookupDonorNameByWhatsapp(req: NextRequest, whatsapp: string) {
  const url = new URL("/api/search", req.nextUrl.origin);
  url.searchParams.set("q", whatsapp);
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) return null;
  const data = (await response.json()) as SearchResponse;
  const hit = data.results.find((result) => result.kind === "phone");
  return hit?.label ?? null;
}

async function pause(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
      await pause(TYPING_DELAY_MS);
      const askName = await sendTextMessage(
        apiKey,
        from,
        to,
        "Please reply with your legal name.\n*Example: Satya Narayan Das*",
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
        "Please reply with your address and pincode.\n*Example: 24 MG Road, Pune 411001*",
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
      await prisma.whatsAppIntake.update({
        where: { phone: to },
        data: {
          address: incomingText,
          pincode,
          status: "completed",
        },
      });

      const confirm = await sendTextMessage(
        apiKey,
        from,
        to,
        "Thanks! We have saved your details.",
      );
      if (!confirm.ok) {
        const text = await confirm.text();
        return NextResponse.json(
          {
            ok: false,
            error: "Failed to send confirmation.",
            status: confirm.status,
            details: text,
          },
          { status: 502 },
        );
      }

      return NextResponse.json({ ok: true, step: "completed" });
    }
  }

  if (messageText !== "new") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const donorName = await lookupDonorNameByWhatsapp(req, to);
  if (!donorName) {
    await sendTypingIndicator(apiKey, from, to);
    await pause(TYPING_DELAY_MS);
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
              placeholders: [{ name: donorName }],
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
