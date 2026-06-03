import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

type DoubleTickTemplateResponse = {
  success?: boolean;
  message?: string;
  data?: unknown;
};

const DOUBLETICK_TEMPLATE_URL =
  "https://public.doubletick.io/v2/whatsapp/message/template";
const DEFAULT_WABA_NUMBER = "919002977288";
const KKD_COLLECTION_TEMPLATE = "kkd_collection";
const KKD_CONFIRMATION_TEMPLATE = "kkd_collection_confirmation";
const INTAKE_TTL_HOURS = 24;

async function sendTemplateMessage(
  apiKey: string,
  from: string,
  to: string,
  templateName: string,
  language: string,
  name: string,
) {
  return fetch(DOUBLETICK_TEMPLATE_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      messages: [
        {
          to,
          from,
          content: {
            templateName,
            language,
            templateData: {
              body: {
                placeholders: [{ name }],
              },
            },
          },
        },
      ],
    }),
  });
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const whatsapp =
    params.get("whatsapp")?.trim() ??
    params.get("number")?.trim() ??
    params.get("whatsapp_number")?.trim() ??
    "";
  const name = params.get("name")?.trim() ?? "";

  if (!whatsapp || !name) {
    return NextResponse.json(
      { ok: false, error: "whatsapp and name are required." },
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

  const intake = await prisma.whatsAppIntake.findUnique({
    where: { phone: whatsapp },
  });
  const alreadyCollected = Boolean(
    intake?.legalName?.trim() && intake?.address?.trim(),
  );

  const templateName = alreadyCollected
    ? KKD_CONFIRMATION_TEMPLATE
    : KKD_COLLECTION_TEMPLATE;
  const step = alreadyCollected ? "kkd_confirmation" : "kkd_collection";

  // For the collection path, pre-tag the intake as flow="kkd" so the inbound
  // webhook routes the "Enter Details" reply to the kkd branch (no donor lookup).
  if (!alreadyCollected) {
    const expiresAt = new Date(Date.now() + INTAKE_TTL_HOURS * 60 * 60 * 1000);
    await prisma.whatsAppIntake.upsert({
      where: { phone: whatsapp },
      update: { flow: "kkd", status: "ready", expiresAt },
      create: { phone: whatsapp, flow: "kkd", status: "ready", expiresAt },
    });
  }

  const response = await sendTemplateMessage(
    apiKey,
    from,
    whatsapp,
    templateName,
    language,
    name,
  );

  if (!response.ok) {
    const details = await response.text();
    return NextResponse.json(
      {
        ok: false,
        error: "Doubletick request failed.",
        status: response.status,
        details,
      },
      { status: 502 },
    );
  }

  // Mark the matching collection row(s) as messaged. Does not create rows —
  // commitment amounts are unknown here and are managed from the admin page.
  await prisma.kkdCollection.updateMany({
    where: { whatsapp },
    data: { messageSent: true, messageSentAt: new Date() },
  });

  const data = (await response.json()) as DoubleTickTemplateResponse;
  return NextResponse.json({ ok: true, step, data });
}
