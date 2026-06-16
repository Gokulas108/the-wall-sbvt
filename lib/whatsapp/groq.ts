// ─────────────────────────────────────────────────────────────────────────────
// Groq LLM helpers for the Wall-of-Legacy WhatsApp intake.
//
// The backend owns conversation flow (see lib/wol/inbound.ts). Groq is used ONLY to:
//   1. extract structured values (name / address / PAN / receipt-choice), and
//   2. classify intent (greeting / question / irrelevant),
//   3. answer FAQ questions grounded strictly in birnagar.md.
// It never decides what state to move to. Every call degrades gracefully — on any
// failure we return a safe "nothing extracted / IRRELEVANT" result so the caller simply
// re-asks, and the webhook never throws. Raw user text is logged for debugging but never
// persisted to the DB (callers store only the extracted values).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { join } from "node:path";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TIMEOUT_MS = 6000;

function model() {
  return process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";
}

export type IntakeIntent =
  | "NAME_PROVIDED"
  | "ADDRESS_PROVIDED"
  | "GREETING"
  | "QUESTION"
  | "IRRELEVANT";

const INTENTS: readonly IntakeIntent[] = [
  "NAME_PROVIDED",
  "ADDRESS_PROVIDED",
  "GREETING",
  "QUESTION",
  "IRRELEVANT",
];

export interface IntakeExtraction {
  name: string | null;
  address: string | null;
  intent: IntakeIntent;
}

// The exact extraction prompt — an information-extraction system that returns strict JSON
// and prefers null over guessing.
const EXTRACTION_PROMPT = `You are an information extraction system.

Your task is to analyze a user's message and extract structured data.

Extract ONLY if you are highly confident. If unsure, return null.

Return a valid JSON object with exactly this structure:

{
  "name": string or null,
  "address": string or null,
  "intent": "NAME_PROVIDED" | "ADDRESS_PROVIDED" | "GREETING" | "QUESTION" | "IRRELEVANT"
}

Definitions:

- name:
  A real person's name. Usually 2+ words (e.g., "John Smith").
  Accept single names ONLY if clearly introduced (e.g., "I am John").
  Reject greetings like "Hey there", "Hello".

- address:
  A physical location (house, street, area, city, etc.)
  Reject vague responses.

- intent:
  NAME_PROVIDED → valid name detected
  ADDRESS_PROVIDED → valid address detected
  GREETING → greetings
  QUESTION → user is asking something
  IRRELEVANT → anything else

Strict rules:
- Do NOT guess
- Do NOT hallucinate
- Output ONLY JSON
- If unsure, return null`;

const PAN_PROMPT = `You extract an Indian PAN (Permanent Account Number) from a user's message.

A PAN is exactly 10 characters: 5 letters, then 4 digits, then 1 letter (e.g., ABCDE1234F).

Return a valid JSON object with exactly this structure:

{
  "pan": string or null,
  "intent": "QUESTION" | "GREETING" | "IRRELEVANT"
}

Rules:
- "pan": the 10-character PAN if one is clearly present, else null. Do NOT invent or complete a partial PAN.
- "intent": GREETING for greetings, QUESTION if the user is asking something, otherwise IRRELEVANT.
- Output ONLY JSON. If unsure, return null.`;

const CHOICE_PROMPT = `You map a user's reply to a receipt-format choice.

Return a valid JSON object with exactly this structure:

{
  "choice": "1" | "2" | null,
  "intent": "QUESTION" | "GREETING" | "IRRELEVANT"
}

Rules:
- "choice": "1" if they want ONE combined receipt (e.g., "combined", "together", "single", "all in one", "just one"); "2" if they want SEPARATE / per-donor receipts (e.g., "separate", "each", "individual", "one for each"). If ambiguous or unrelated, null.
- "intent": GREETING for greetings, QUESTION if the user is asking something, otherwise IRRELEVANT.
- Output ONLY JSON. If unsure, return null.`;

// Core HTTP call. Returns the parsed JSON object the model produced, or null on any
// failure (missing key, network, timeout, non-2xx, non-JSON). Logs the raw content.
async function callGroqJson(
  system: string,
  user: string,
  maxTokens = 150,
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn("[groq] GROQ_API_KEY not set — skipping extraction (safe fallback).");
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model(),
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[groq] non-2xx response", { status: res.status, body });
      return null;
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    console.info("[groq] raw content", { content });
    try {
      const parsed = JSON.parse(content) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      console.warn("[groq] failed to parse JSON content", { content });
      return null;
    }
  } catch (err) {
    console.warn("[groq] request failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Trim a value to a non-empty string, else null. Guards against the model returning ""
// or whitespace when it means "nothing".
function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function coerceIntent(value: unknown, fallback: IntakeIntent): IntakeIntent {
  return INTENTS.includes(value as IntakeIntent)
    ? (value as IntakeIntent)
    : fallback;
}

// Extract { name, address, intent } from a single inbound message using the exact spec
// prompt. Safe fallback (nothing extracted, IRRELEVANT) on any failure.
export async function extractIntake(message: string): Promise<IntakeExtraction> {
  const parsed = await callGroqJson(EXTRACTION_PROMPT, message);
  const result: IntakeExtraction = {
    name: cleanString(parsed?.name),
    address: cleanString(parsed?.address),
    intent: coerceIntent(parsed?.intent, "IRRELEVANT"),
  };
  console.info("[groq] extractIntake", { parsed: result });
  return result;
}

// Extract a PAN candidate + intent. The caller MUST re-validate the candidate against the
// strict PAN regex before storing it — this never guarantees a valid PAN.
export async function extractPan(
  message: string,
): Promise<{ pan: string | null; intent: IntakeIntent }> {
  const parsed = await callGroqJson(PAN_PROMPT, message);
  const result = {
    pan: cleanString(parsed?.pan),
    intent: coerceIntent(parsed?.intent, "IRRELEVANT"),
  };
  console.info("[groq] extractPan", { parsed: result });
  return result;
}

// Map a free-text reply to receipt choice "1" | "2" (or null when ambiguous) + intent.
export async function extractReceiptChoice(
  message: string,
): Promise<{ choice: "1" | "2" | null; intent: IntakeIntent }> {
  const parsed = await callGroqJson(CHOICE_PROMPT, message);
  const rawChoice = cleanString(parsed?.choice);
  const choice: "1" | "2" | null =
    rawChoice === "1" ? "1" : rawChoice === "2" ? "2" : null;
  const result = { choice, intent: coerceIntent(parsed?.intent, "IRRELEVANT") };
  console.info("[groq] extractReceiptChoice", { parsed: result });
  return result;
}

// The exact line to send when a question can't be answered from birnagar.md.
const KB_FALLBACK =
  "Thank you for your question. Someone from our team will contact you shortly.";

// birnagar.md is small and static — read once and cache for the process lifetime.
let knowledgeBase: string | null = null;
function loadKnowledgeBase(): string {
  if (knowledgeBase === null) {
    try {
      knowledgeBase = readFileSync(join(process.cwd(), "birnagar.md"), "utf8");
    } catch (err) {
      console.warn("[groq] failed to read birnagar.md", {
        error: err instanceof Error ? err.message : String(err),
      });
      knowledgeBase = "";
    }
  }
  return knowledgeBase;
}

// Answer a user's question using ONLY birnagar.md. Returns a short grounded answer, or the
// exact KB_FALLBACK line when the answer isn't in the file / on any failure. The model is
// kept strictly grounded — it does not drive conversation flow.
export async function answerFromKnowledgeBase(question: string): Promise<string> {
  const kb = loadKnowledgeBase();
  if (!kb) return KB_FALLBACK;

  const system = `You answer a donor's question using ONLY the reference text below. Keep the answer short (1-3 sentences), polite, and relevant.

If the answer is not clearly in the reference text, reply with EXACTLY this sentence and nothing else:
${KB_FALLBACK}

Reference text:
"""
${kb}
"""`;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return KB_FALLBACK;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model(),
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: "system", content: system },
          { role: "user", content: question },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[groq] KB non-2xx response", { status: res.status, body });
      return KB_FALLBACK;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const answer = cleanString(data.choices?.[0]?.message?.content);
    console.info("[groq] answerFromKnowledgeBase", { answer });
    return answer ?? KB_FALLBACK;
  } catch (err) {
    console.warn("[groq] KB request failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return KB_FALLBACK;
  } finally {
    clearTimeout(timer);
  }
}
