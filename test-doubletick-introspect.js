// Summarize the body-variable names + header type/mediaUrl for each WoL/KKD template, so we
// know the exact placeholder keys + header needs the send API expects.
//   node --env-file=.env.local test-doubletick-introspect.js
// Never prints the API key.

const API_KEY = process.env.DOUBLETICK_API_KEY;
if (!API_KEY) {
  console.error("Missing DOUBLETICK_API_KEY (run with --env-file=.env.local).");
  process.exit(1);
}

const NAMES = [
  "wol_no_address_v1",
  "follow_up_wol",
  "wol_discrepancy",
  "wol_thankyou_receipt",
  "wol_address_exists",
  "wol_no_address",
  "receipt_generation",
];

async function meta(name) {
  const url = `https://public.doubletick.io/v2/templates?name=${encodeURIComponent(name)}&status=ALL`;
  const res = await fetch(url, { headers: { accept: "application/json", Authorization: API_KEY } });
  const text = await res.text();
  let arr;
  try {
    arr = JSON.parse(text);
  } catch {
    return console.log(`\n${name}: HTTP ${res.status} (non-JSON) ${text.slice(0, 120)}`);
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    return console.log(`\n${name}: not found (HTTP ${res.status})`);
  }
  for (const t of arr) {
    const body = (t.components || []).find((c) => c.type === "BODY");
    const header = (t.components || []).find((c) => c.type === "HEADER");
    const bodyVars = (body?.variables || []).map((v) => v.name ?? JSON.stringify(v));
    console.log(`\n${t.name} [${t.language}] status=${t.status}`);
    console.log(`  body vars: ${JSON.stringify(bodyVars)}`);
    console.log(`  header: ${header ? header.format : "none"}${header?.variables ? " (var: " + JSON.stringify(header.variables[0]) + ")" : ""}`);
  }
}

(async () => {
  for (const n of NAMES) await meta(n).catch((e) => console.log(`${n}: threw ${e.message}`));
})();
