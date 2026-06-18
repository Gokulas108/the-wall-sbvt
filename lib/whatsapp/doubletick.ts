// ─────────────────────────────────────────────────────────────────────────────
// Shared Doubletick (WhatsApp) send helpers + endpoint constants.
//
// Extracted from the inbound webhook (app/api/generate-test-response/route.ts) so the
// receipt-intake flow and the Wall-of-Legacy campaign code (lib/wol/*) share one copy of
// the exact request shapes Doubletick expects. Every helper returns the raw fetch Response
// so callers can inspect status / body and log failures themselves.
// ─────────────────────────────────────────────────────────────────────────────

export const DOUBLETICK_TEMPLATE_URL =
  "https://public.doubletick.io/v2/whatsapp/message/template";
export const DOUBLETICK_TEXT_URL =
  "https://public.doubletick.io/whatsapp/message/text";
export const DOUBLETICK_DOCUMENT_URL =
  "https://public.doubletick.io/whatsapp/message/document";
export const DOUBLETICK_TYPING_URL =
  "https://public.doubletick.io/whatsapp/message/typing-indicator";

// Bot's WhatsApp Business Account number; overridable via DOUBLETICK_WABA_NUMBER.
export const DEFAULT_WABA_NUMBER = "919002977288";

export interface DoubletickConfig {
  apiKey: string;
  from: string;
  language: string;
}

// Resolve the env config once per request. Returns null when DOUBLETICK_API_KEY is
// missing so the caller can surface a 500 with its own error shape.
export function resolveDoubletick(): DoubletickConfig | null {
  const apiKey = process.env.DOUBLETICK_API_KEY;
  if (!apiKey) return null;
  const from = process.env.DOUBLETICK_WABA_NUMBER ?? DEFAULT_WABA_NUMBER;
  const language = process.env.DOUBLETICK_TEMPLATE_LANGUAGE ?? "en";
  return { apiKey, from, language };
}

function jsonHeaders(apiKey: string) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    Authorization: apiKey,
  };
}

export async function sendTextMessage(
  apiKey: string,
  from: string,
  to: string,
  text: string,
) {
  return fetch(DOUBLETICK_TEXT_URL, {
    method: "POST",
    headers: jsonHeaders(apiKey),
    body: JSON.stringify({ from, to, content: { text } }),
  });
}

export async function sendDocumentMessage(
  apiKey: string,
  from: string,
  to: string,
  mediaUrl: string,
  filename: string,
) {
  return fetch(DOUBLETICK_DOCUMENT_URL, {
    method: "POST",
    headers: jsonHeaders(apiKey),
    body: JSON.stringify({ from, to, content: { mediaUrl, filename } }),
  });
}

export async function sendTypingIndicator(apiKey: string, from: string, to: string) {
  return fetch(DOUBLETICK_TYPING_URL, {
    method: "POST",
    headers: jsonHeaders(apiKey),
    body: JSON.stringify({ wabaNumber: from, customerNumber: to }),
  });
}

// A DOCUMENT header attaches a PDF (certificate/receipt) above a template's body — the
// shape the existing receipt_generation send uses.
export interface TemplateDocumentHeader {
  type: "DOCUMENT";
  mediaUrl: string;
  filename: string;
}

// Send an approved template with a single body placeholder (the donor name) and an
// optional DOCUMENT header. Mirrors the payload used across kkd-wf and generate-test-response.
export async function sendTemplateMessage(
  apiKey: string,
  from: string,
  to: string,
  templateName: string,
  language: string,
  name: string,
  header?: TemplateDocumentHeader,
) {
  return sendTemplateWithPlaceholders(
    apiKey,
    from,
    to,
    templateName,
    language,
    [name],
    header,
  );
}

// Same as sendTemplateMessage but for templates with multiple positional body placeholders
// (e.g. wol_no_address_v1 → [name, amount, date]). `placeholders` map to {{1}}, {{2}}, … in
// order. Doubletick names each body value with a `name` key regardless of what it represents.
export async function sendTemplateWithPlaceholders(
  apiKey: string,
  from: string,
  to: string,
  templateName: string,
  language: string,
  placeholders: string[],
  header?: TemplateDocumentHeader,
) {
  const templateData: Record<string, unknown> = {
    body: { placeholders: placeholders.map((value) => ({ name: value })) },
  };
  if (header) templateData.header = header;
  return fetch(DOUBLETICK_TEMPLATE_URL, {
    method: "POST",
    headers: jsonHeaders(apiKey),
    body: JSON.stringify({
      messages: [{ to, from, content: { templateName, language, templateData } }],
    }),
  });
}
