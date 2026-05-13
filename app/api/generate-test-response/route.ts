import { NextRequest, NextResponse } from "next/server";

type DoubleTickInbound = {
  from?: string;
  message?: {
    type?: string;
    text?: string;
  };
};

type DoubleTickTemplateResponse = {
  success?: boolean;
  message?: string;
  data?: unknown;
};

const DOUBLETICK_API_URL =
  "https://public.doubletick.io/v2/whatsapp/message/template";
const DOUBLETICK_TEMPLATE_NAME = "donation_successful";
const DEFAULT_TEMPLATE_NAME_VALUE = "Satya";
const DEFAULT_WABA_NUMBER = "919002977288";

function normalizeText(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
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
  if (messageText !== "new") {
    return NextResponse.json({ ok: true, skipped: true });
  }

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
              placeholders: [{ name: DEFAULT_TEMPLATE_NAME_VALUE }],
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
