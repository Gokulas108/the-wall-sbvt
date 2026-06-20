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
export const DOUBLETICK_TEMPLATES_URL =
  "https://public.doubletick.io/v2/templates";
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

// A media header attaches a PDF/image/video above a template's body. Doubletick REQUIRES a
// mediaUrl at send time for any media-header template (the template's own default media is
// NOT auto-applied) — see fetchTemplateMeta for the auto-fill of static headers.
export interface TemplateMediaHeader {
  type: "DOCUMENT" | "IMAGE" | "VIDEO";
  mediaUrl: string;
  filename?: string;
}
// Back-compat alias — existing callers import TemplateDocumentHeader for receipt PDFs.
export type TemplateDocumentHeader = TemplateMediaHeader;

// Shape of the GET /v2/templates response we care about (body var names + media header).
interface DtTemplateVariable {
  name?: string;
  mediaUrl?: string;
  fileName?: string;
}
interface DtTemplateComponent {
  type?: string;
  format?: string;
  variables?: DtTemplateVariable[];
}
interface DtTemplate {
  name?: string;
  language?: string;
  components?: DtTemplateComponent[];
}

interface TemplateMeta {
  bodyVarNames: string[]; // ordered names of the {{...}} body variables
  headerType: "IMAGE" | "DOCUMENT" | "VIDEO" | "TEXT" | null;
  headerMediaUrl: string | null; // the template's static default media, if any
  headerFileName: string | null;
}

// One GET per (template, language) per process; cached because approved templates are stable.
const templateMetaCache = new Map<string, TemplateMeta>();

// Introspect a template so we can (a) key each body placeholder by its REAL variable name
// ({ name }, { amount }, { date } — not a hardcoded "name") and (b) auto-supply a static
// media header's mediaUrl. Returns null on any failure; callers degrade gracefully.
async function fetchTemplateMeta(
  apiKey: string,
  templateName: string,
  language: string,
): Promise<TemplateMeta | null> {
  const cacheKey = `${templateName}:${language}`;
  const hit = templateMetaCache.get(cacheKey);
  if (hit) return hit;
  try {
    const url = `${DOUBLETICK_TEMPLATES_URL}?name=${encodeURIComponent(
      templateName,
    )}&status=ALL`;
    const res = await fetch(url, {
      headers: { accept: "application/json", Authorization: apiKey },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return null;
    const list = data as DtTemplate[];
    // `name` is a PREFIX filter (querying "wol_no_address" also returns "wol_no_address_v1"),
    // so pick the EXACT name, preferring the requested language.
    const tpl =
      list.find((t) => t.name === templateName && t.language === language) ??
      list.find((t) => t.name === templateName);
    if (!tpl) return null;
    const comps = Array.isArray(tpl.components) ? tpl.components : [];
    const body = comps.find((c) => c.type === "BODY");
    const headerComp = comps.find((c) => c.type === "HEADER");
    const headerVar = headerComp?.variables?.[0];
    const meta: TemplateMeta = {
      bodyVarNames: (body?.variables ?? [])
        .map((v) => v.name)
        .filter((n): n is string => Boolean(n)),
      headerType: (headerComp?.format as TemplateMeta["headerType"]) ?? null,
      headerMediaUrl: headerVar?.mediaUrl ?? null,
      headerFileName: headerVar?.fileName ?? null,
    };
    templateMetaCache.set(cacheKey, meta);
    return meta;
  } catch {
    return null;
  }
}

// Send an approved template with a single body placeholder (the donor name) and an
// optional media header. Mirrors the payload used across kkd-wf and generate-test-response.
export async function sendTemplateMessage(
  apiKey: string,
  from: string,
  to: string,
  templateName: string,
  language: string,
  name: string,
  header?: TemplateMediaHeader,
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

// Send a template whose body has one or more variables. `values` are the substitutions in
// the template's declared variable order (e.g. wol_no_address_v1 → [name, amount, date]).
// Doubletick keys each body placeholder by the variable's NAME ({ name }, { amount }, …), so
// we look the names up from the template definition. A caller-supplied header wins (e.g. a
// generated receipt PDF); otherwise a static media header's default mediaUrl is filled in.
export async function sendTemplateWithPlaceholders(
  apiKey: string,
  from: string,
  to: string,
  templateName: string,
  language: string,
  values: string[],
  header?: TemplateMediaHeader,
) {
  const meta = await fetchTemplateMeta(apiKey, templateName, language);
  const varNames = meta?.bodyVarNames ?? [];
  // Map each value to its variable name: { <varName>: value }. Fall back to "name" for the
  // first var / positional keys if introspection was unavailable (keeps single-var sends OK).
  const placeholders = values.map((value, i) => {
    const key = varNames[i] ?? (i === 0 ? "name" : String(i + 1));
    return { [key]: value };
  });

  const templateData: Record<string, unknown> = {
    body: { placeholders },
  };

  const effectiveHeader: TemplateMediaHeader | undefined =
    header ??
    (meta &&
    meta.headerMediaUrl &&
    (meta.headerType === "IMAGE" ||
      meta.headerType === "DOCUMENT" ||
      meta.headerType === "VIDEO")
      ? {
          type: meta.headerType,
          mediaUrl: meta.headerMediaUrl,
          ...(meta.headerFileName ? { filename: meta.headerFileName } : {}),
        }
      : undefined);
  if (effectiveHeader) templateData.header = effectiveHeader;

  return fetch(DOUBLETICK_TEMPLATE_URL, {
    method: "POST",
    headers: jsonHeaders(apiKey),
    body: JSON.stringify({
      messages: [{ to, from, content: { templateName, language, templateData } }],
    }),
  });
}
