// ─────────────────────────────────────────────────────────────────────────────
// Wall-of-Legacy re-send campaign. Drives the one-off "follow up donors who didn't
// finish" push that's triggered ONLY from /admin/wol-test. Each row in
// resend-list.csv carries a Tag; the tag decides which approved template to send:
//
//   No bot reply / No Address / No Name → follow_up_wol      ([name],  Enter Details button)
//   No reply                            → wol_no_address_v1  ([name, amount, date], Enter Details)
//   discrepancy                         → wol_discrepancy    ([name] + corrected receipt PDF)
//
// follow_up_wol & wol_no_address_v1 reuse the existing "Enter Details" flow, so we pre-tag
// the intake as flow="wol" (exactly like app/api/wol-wf/route.ts) before sending.
//
// For discrepancy we rebuild the donor's real receipt but OVERRIDE the legal name + address
// with the CSV's Correct Name / Correct Address, and attach it as the template's DOCUMENT
// header. All other receipt data (amount, serial, payment reference, date) stays real.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "@/lib/db/prisma";
import { COST_PER_NAME, formatINR } from "@/lib/mosaic/engine";
import {
  donorPlaceholderName,
  getWolNumberContext,
} from "@/lib/wol/context";
import { buildReceipts, resolveReceiptMode } from "@/lib/wol/receipts";
import { normalizeWhatsappNumber } from "@/lib/whatsapp-care/phone";
import {
  sendTemplateWithPlaceholders,
  type DoubletickConfig,
  type TemplateDocumentHeader,
} from "@/lib/whatsapp/doubletick";

const TEMPLATE_FOLLOW_UP = "follow_up_wol";
const TEMPLATE_NO_ADDRESS_V1 = "wol_no_address_v1";
const TEMPLATE_DISCREPANCY = "wol_discrepancy";
const INTAKE_TTL_MS = 24 * 60 * 60 * 1000;
const SEND_CONCURRENCY = 5; // gentle on Doubletick + the pdf-server during the bulk push

// Normalised (lower-cased, trimmed) CSV tag → template name.
const TAG_TEMPLATE: Record<string, string> = {
  "no bot reply": TEMPLATE_FOLLOW_UP,
  "no reply": TEMPLATE_NO_ADDRESS_V1,
  "no address": TEMPLATE_FOLLOW_UP,
  "no name": TEMPLATE_FOLLOW_UP,
  discrepancy: TEMPLATE_DISCREPANCY,
};

export function templateForTag(tag: string): string | null {
  return TAG_TEMPLATE[tag.trim().toLowerCase()] ?? null;
}

export interface ResendRow {
  name: string;
  phone: string; // raw, as in the CSV
  tag: string;
  correctName: string;
  correctAddress: string;
}

export interface ResendResult {
  ok: boolean;
  phone: string; // normalized
  tag: string;
  templateName: string | null;
  documents?: number; // receipts attached (discrepancy only)
  error?: string;
  detail?: string; // Doubletick response body on a send failure
}

// Minimal CSV line splitter that respects double-quoted fields (addresses contain commas).
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// Read resend-list.csv (committed at the app root). Columns:
// Name, Phone number, Tags, Correct Name, Correct Address.
export function loadResendRows(): ResendRow[] {
  const raw = readFileSync(join(process.cwd(), "resend-list.csv"), "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: ResendRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const phone = (cols[1] ?? "").trim();
    if (!phone) continue;
    rows.push({
      name: (cols[0] ?? "").trim(),
      phone,
      tag: (cols[2] ?? "").trim(),
      correctName: (cols[3] ?? "").trim(),
      correctAddress: (cols[4] ?? "").trim(),
    });
  }
  return rows;
}

function extractPincode(value: string): string | null {
  const m = value.match(/\b\d{6}\b/);
  return m ? m[0] : null;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ISO timestamp → "18 Jun 2026". Parsed from the date part to stay timezone-stable.
function formatDonationDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  const mi = Number(m) - 1;
  if (!y || !d || mi < 0 || mi > 11) return "";
  return `${Number(d)} ${MONTHS[mi]} ${y}`;
}

// Light per-number lookup (filtered query, a handful of rows) for the follow_up_wol /
// wol_no_address_v1 placeholders — name, total, latest date. Avoids the full-table scan in
// getWolNumberContext, which we reserve for the discrepancy receipts that actually need it.
async function lightDonorInfo(phone: string): Promise<{
  found: boolean;
  donorNames: string[];
  totalRupees: number;
  latestDate: string | null;
}> {
  const last10 = phone.slice(-10);
  const subs = await prisma.blockSubmission.findMany({
    where: { whatsapp: { contains: last10 } },
    select: { name: true, qty: true, whatsapp: true, createdAt: true },
  });
  const mine = subs.filter((s) => normalizeWhatsappNumber(s.whatsapp) === phone);
  const donorNames = [...new Set(mine.map((s) => s.name.trim()).filter(Boolean))];
  const totalRupees = mine.reduce((a, s) => a + s.qty * COST_PER_NAME, 0);
  const latest = mine.reduce<Date | null>(
    (a, s) => (!a || s.createdAt > a ? s.createdAt : a),
    null,
  );
  return {
    found: mine.length > 0,
    donorNames,
    totalRupees,
    latestDate: latest ? latest.toISOString() : null,
  };
}

// Send one row's template. `row` may come from the CSV (bulk) or a single test trigger.
export async function sendResend(
  row: {
    phone: string;
    tag: string;
    name?: string;
    correctName?: string;
    correctAddress?: string;
  },
  cfg: DoubletickConfig,
): Promise<ResendResult> {
  const phone = normalizeWhatsappNumber(row.phone);
  const tag = row.tag.trim();
  const templateName = templateForTag(tag);
  const base = { phone, tag, templateName };
  if (!phone) return { ...base, ok: false, error: "Invalid phone number" };
  if (!templateName) return { ...base, ok: false, error: `Unknown tag "${tag}"` };

  if (templateName === TEMPLATE_DISCREPANCY) {
    return sendDiscrepancy(
      phone,
      tag,
      row.correctName ?? "",
      row.correctAddress ?? "",
      cfg,
    );
  }

  // follow_up_wol & wol_no_address_v1 both carry an "Enter Details" button → reuse the
  // existing WoL flow. Pre-tag the intake as flow="wol" so the inbound webhook routes the
  // button press and subsequent name/address/PAN replies to handleWolInbound.
  const expiresAt = new Date(Date.now() + INTAKE_TTL_MS);
  await prisma.whatsAppIntake.upsert({
    where: { phone },
    update: { flow: "wol", status: "ready", expiresAt },
    create: { phone, flow: "wol", status: "ready", expiresAt },
  });

  const info = await lightDonorInfo(phone);
  const realName = info.found ? donorPlaceholderName(info.donorNames) : "";
  const name = realName || row.name?.trim() || "Donor";

  let placeholders: string[];
  if (templateName === TEMPLATE_NO_ADDRESS_V1) {
    if (!info.found || !info.latestDate) {
      return {
        ...base,
        ok: false,
        error: "No contribution found — can't fill amount/date",
      };
    }
    const amount = `₹${formatINR(info.totalRupees)}`;
    placeholders = [name, amount, formatDonationDate(info.latestDate)];
  } else {
    placeholders = [name]; // follow_up_wol
  }

  const res = await sendTemplateWithPlaceholders(
    cfg.apiKey,
    cfg.from,
    phone,
    templateName,
    cfg.language,
    placeholders,
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ...base, ok: false, error: "Doubletick request failed", detail };
  }
  return { ...base, ok: true };
}

async function sendDiscrepancy(
  phone: string,
  tag: string,
  correctName: string,
  correctAddress: string,
  cfg: DoubletickConfig,
): Promise<ResendResult> {
  const base = { phone, tag, templateName: TEMPLATE_DISCREPANCY };
  const ctx = await getWolNumberContext(phone);
  if (!ctx.found || ctx.lines.length === 0) {
    return {
      ...base,
      ok: false,
      error: "No contribution found — can't build a corrected receipt",
    };
  }

  // Keep all real contribution data; override only the corrected legal name + address.
  const name = correctName.trim() || ctx.legalName || ctx.donorNames[0] || "Donor";
  const corrected = {
    ...ctx,
    legalName: name,
    address: correctAddress.trim() || ctx.address || "",
    pincode: extractPincode(correctAddress) ?? ctx.pincode,
  };
  const receipts = buildReceipts(corrected, resolveReceiptMode(corrected));

  let sent = 0;
  let detail: string | undefined;
  for (const r of receipts) {
    const header: TemplateDocumentHeader = {
      type: "DOCUMENT",
      mediaUrl: r.url,
      filename: r.filename,
    };
    const res = await sendTemplateWithPlaceholders(
      cfg.apiKey,
      cfg.from,
      phone,
      TEMPLATE_DISCREPANCY,
      cfg.language,
      [name],
      header,
    );
    if (res.ok) sent++;
    else detail = await res.text().catch(() => "");
  }
  if (sent === 0) {
    return { ...base, ok: false, error: "Doubletick request failed", detail };
  }
  return { ...base, ok: true, documents: sent };
}

export interface ResendBatchSummary {
  total: number;
  sent: number;
  failed: number;
  results: ResendResult[];
}

// Send to every row in resend-list.csv, routed by tag, in small concurrent batches.
export async function sendAllResends(
  cfg: DoubletickConfig,
): Promise<ResendBatchSummary> {
  const rows = loadResendRows();
  const results: ResendResult[] = [];
  for (let i = 0; i < rows.length; i += SEND_CONCURRENCY) {
    const batch = rows.slice(i, i + SEND_CONCURRENCY);
    const settled = await Promise.all(
      batch.map((row) =>
        sendResend(row, cfg).catch(
          (e): ResendResult => ({
            ok: false,
            phone: normalizeWhatsappNumber(row.phone),
            tag: row.tag,
            templateName: templateForTag(row.tag),
            error: e instanceof Error ? e.message : String(e),
          }),
        ),
      ),
    );
    results.push(...settled);
  }
  const sent = results.filter((r) => r.ok).length;
  return { total: rows.length, sent, failed: results.length - sent, results };
}
