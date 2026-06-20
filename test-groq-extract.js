// Ad-hoc scratch harness — run with:  node test-groq-extract.js
// Eyeballs the Groq extraction prompts used by lib/whatsapp/groq.ts. Self-contained plain
// JS that mirrors that module's prompts + safe-parse/fallback (not part of any test suite).
//
// Env: GROQ_API_KEY (required to hit the provider; unset → shows the safe IRRELEVANT fallback)
//      GROQ_MODEL         (optional, default llama-3.1-8b-instant)
//      GROQ_API_BASE_URL  (optional, default Groq; set to any OpenAI-compatible /chat/completions
//                          endpoint to test a fallback provider, e.g. OpenRouter). Mirrors
//                          lib/whatsapp/groq.ts.
//
// Load .env.local manually since this is plain node (no Next runtime):
//   node --env-file=.env.local test-groq-extract.js
// or export GROQ_API_KEY first.

const GROQ_URL =
  process.env.GROQ_API_BASE_URL || "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const API_KEY = process.env.GROQ_API_KEY;

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

async function callGroqJson(system, user, maxTokens = 150) {
  if (!API_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
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
      console.warn("  [non-2xx]", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    try {
      return JSON.parse(content);
    } catch {
      console.warn("  [bad JSON]", content);
      return null;
    }
  } catch (err) {
    console.warn("  [request failed]", err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const INTENTS = ["NAME_PROVIDED", "ADDRESS_PROVIDED", "GREETING", "QUESTION", "IRRELEVANT"];
const intent = (v, fallback) => (INTENTS.includes(v) ? v : fallback);

async function extractIntake(msg) {
  const p = await callGroqJson(EXTRACTION_PROMPT, msg);
  return {
    name: clean(p?.name),
    address: clean(p?.address),
    intent: intent(p?.intent, "IRRELEVANT"),
  };
}

async function extractPan(msg) {
  const p = await callGroqJson(PAN_PROMPT, msg);
  return { pan: clean(p?.pan), intent: intent(p?.intent, "IRRELEVANT") };
}

async function extractReceiptChoice(msg) {
  const p = await callGroqJson(CHOICE_PROMPT, msg);
  const c = clean(p?.choice);
  return { choice: c === "1" || c === "2" ? c : null, intent: intent(p?.intent, "IRRELEVANT") };
}

async function run(title, fn, samples) {
  console.log(`\n== ${title} ==`);
  for (const m of samples) {
    console.log(`  ${JSON.stringify(m)} →`, await fn(m));
  }
}

async function main() {
  if (!API_KEY) {
    console.log("⚠️  GROQ_API_KEY not set — every extractor returns the safe fallback.\n");
  }
  await run("extractIntake", extractIntake, [
    "hi",
    "who is this?",
    "Hi, I am John",
    "ok",
    "12 Temple Rd, Mayapur, Nadia 741313",
  ]);
  await run("extractPan", extractPan, [
    "my pan is abcde1234f",
    "why do you need this?",
    "ABCDE1234F",
    "1234",
  ]);
  await run("extractReceiptChoice", extractReceiptChoice, [
    "together",
    "one each",
    "what's the difference?",
    "1",
  ]);
}

main();
