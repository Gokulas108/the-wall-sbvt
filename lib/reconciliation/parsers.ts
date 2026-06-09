// ─────────────────────────────────────────────────────────────────────────────
// CSV parsers for the two external data sources.
//
// Single file, one external import (papaparse) — so it resolves identically under
// the Next bundler and under Node's type-stripping (for test-parsers.ts).
//
// Header strings are matched case-insensitively and the source typos are PRESERVED
// exactly (`transcationType`, `refundStstus`) — those are the real column names in
// the exported files, not mistakes to "fix". Amounts parse to integer paise.
// ─────────────────────────────────────────────────────────────────────────────

import Papa from "papaparse";

export interface RowError {
  row: number; // 1-based line number in the file (header = line 1)
  message: string;
}

export interface ParseResult<T> {
  ok: boolean; // false ⇒ header shape mismatch, whole file rejected
  missingHeaders: string[];
  rows: T[];
  errors: RowError[];
  minDate: Date | null; // for the upload batch's inferred period window
  maxDate: Date | null;
}

export interface ParsedGatewayRow {
  transactionId: string;
  merchantTranId: string | null;
  rrn: string | null;
  amountPaise: number;
  chargesPaise: number;
  netAmountPaise: number;
  status: string;
  reconciliationStatus: string | null;
  originalTransactionId: string | null;
  isSuccess: boolean;
  isRefund: boolean;
  customerName: string | null;
  customerMobile: string | null;
  transactionDate: Date | null;
  rawRow: Record<string, string>;
}

export interface ParsedUpiRow {
  merchantTranId: string;
  bankRRN: string;
  amountPaise: number;
  status: string;
  refundStatus: string | null;
  customerVPA: string | null;
  contactNumber: string | null;
  payerName: string | null;
  isSuccess: boolean;
  isRefund: boolean;
  transactionDate: Date | null;
  rawRow: Record<string, string>;
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function rowGetter(row: Record<string, string>) {
  const map = new Map<string, string>();
  for (const k of Object.keys(row)) map.set(k.trim().toLowerCase(), row[k]);
  return (name: string): string => (map.get(name.trim().toLowerCase()) ?? "").toString().trim();
}

/** "₹1,008.50" → 100850 paise. Empty/garbage → 0. */
export function parseRupeesToPaise(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return 0;
  const rupees = parseFloat(cleaned);
  if (!Number.isFinite(rupees)) return 0;
  return Math.round(rupees * 100);
}

/** Tolerant date parse: ISO, or DD-MM-YYYY / DD/MM/YYYY [HH:mm[:ss]]. Unknown → null. */
export function parseLooseDate(raw: string): Date | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = Date.parse(s);
    if (!Number.isNaN(iso)) return new Date(iso);
  }
  const m = s.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (m) {
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    const d = new Date(
      Date.UTC(
        year,
        parseInt(m[2], 10) - 1,
        parseInt(m[1], 10),
        parseInt(m[4] || "0", 10),
        parseInt(m[5] || "0", 10),
        parseInt(m[6] || "0", 10),
      ),
    );
    if (!Number.isNaN(d.getTime())) return d;
  }
  const fallback = Date.parse(s);
  return Number.isNaN(fallback) ? null : new Date(fallback);
}

const SUCCESS_TOKENS = new Set([
  "success",
  "successful",
  "captured",
  "settled",
  "completed",
  "paid",
  "credited",
]);
export function isSuccessStatus(s: string): boolean {
  return SUCCESS_TOKENS.has((s ?? "").trim().toLowerCase());
}

const REFUNDED_TOKENS = new Set([
  "success",
  "successful",
  "refunded",
  "completed",
  "processed",
  "done",
  "yes",
  "y",
  "true",
]);
function looksRefunded(s: string): boolean {
  const v = (s ?? "").trim().toLowerCase();
  return v !== "" && REFUNDED_TOKENS.has(v);
}

function readCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const out = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h: string) => h.trim(),
  });
  const headers = (out.meta.fields ?? []).map((h) => h.trim());
  const rows = (out.data ?? []).filter(
    (r): r is Record<string, string> => !!r && typeof r === "object",
  );
  return { headers, rows };
}

function checkHeaders(headers: string[], required: string[]): string[] {
  const have = new Set(headers.map((h) => h.toLowerCase()));
  return required.filter((h) => !have.has(h.toLowerCase()));
}

function track(min: Date | null, max: Date | null, d: Date | null): [Date | null, Date | null] {
  if (!d) return [min, max];
  return [min && min < d ? min : d, max && max > d ? max : d];
}

// ── Gateway CSV ──────────────────────────────────────────────────────────────

const GATEWAY_REQUIRED = ["Transaction ID", "Transaction Amount", "Transaction Status"];

export function parseGatewayCsv(text: string): ParseResult<ParsedGatewayRow> {
  const { headers, rows } = readCsv(text);
  const missing = checkHeaders(headers, GATEWAY_REQUIRED);
  if (missing.length) {
    return { ok: false, missingHeaders: missing, rows: [], errors: [], minDate: null, maxDate: null };
  }

  const out: ParsedGatewayRow[] = [];
  const errors: RowError[] = [];
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  rows.forEach((row, i) => {
    const g = rowGetter(row);
    const transactionId = g("Transaction ID");
    if (!transactionId) {
      errors.push({ row: i + 2, message: "missing Transaction ID" });
      return;
    }
    const txnType = g("Transaction Type");
    const originalTransactionId = g("Original Transaction ID") || null;
    const isRefund = /refund/i.test(txnType) || !!originalTransactionId;
    const status = g("Transaction Status");
    const amountPaise = parseRupeesToPaise(g("Transaction Amount"));
    const chargesPaise = parseRupeesToPaise(g("Transaction Charges"));
    const date = parseLooseDate(g("Transaction Date"));
    [minDate, maxDate] = track(minDate, maxDate, date);

    out.push({
      transactionId,
      merchantTranId: g("Merchant Reference No") || null,
      rrn: g("RRN") || null,
      amountPaise,
      chargesPaise,
      netAmountPaise: amountPaise - chargesPaise,
      status,
      reconciliationStatus: g("Reconciliation Status") || null,
      originalTransactionId,
      isSuccess: isSuccessStatus(status) && !isRefund,
      isRefund,
      customerName: g("Customer Name") || null,
      customerMobile: g("Customer Mobile Number") || null,
      transactionDate: date,
      rawRow: row,
    });
  });

  return { ok: true, missingHeaders: [], rows: out, errors, minDate, maxDate };
}

// ── UPI CSV ──────────────────────────────────────────────────────────────────

const UPI_REQUIRED = ["merchantTranId", "bankRRN", "amount", "status"];

export function parseUpiCsv(text: string): ParseResult<ParsedUpiRow> {
  const { headers, rows } = readCsv(text);
  const missing = checkHeaders(headers, UPI_REQUIRED);
  if (missing.length) {
    return { ok: false, missingHeaders: missing, rows: [], errors: [], minDate: null, maxDate: null };
  }

  const out: ParsedUpiRow[] = [];
  const errors: RowError[] = [];
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  rows.forEach((row, i) => {
    const g = rowGetter(row);
    const merchantTranId = g("merchantTranId");
    if (!merchantTranId) {
      errors.push({ row: i + 2, message: "missing merchantTranId" });
      return;
    }
    const status = g("status");
    const refundStatus = g("refundStstus") || null; // sic — real column name
    const txnType = g("transcationType"); // sic — real column name
    const isRefund = /refund/i.test(txnType) || (refundStatus ? looksRefunded(refundStatus) : false);
    const amountPaise = parseRupeesToPaise(g("amount"));
    const date = parseLooseDate(g("txnCompletationDate") || g("dateTime") || g("Date"));
    [minDate, maxDate] = track(minDate, maxDate, date);

    out.push({
      merchantTranId,
      bankRRN: g("bankRRN"),
      amountPaise,
      status,
      refundStatus,
      customerVPA: g("customerVPA") || null,
      contactNumber: g("Contact Numbers") || null,
      payerName: g("Name") || null,
      isSuccess: isSuccessStatus(status) && !isRefund,
      isRefund,
      transactionDate: date,
      rawRow: row,
    });
  });

  return { ok: true, missingHeaders: [], rows: out, errors, minDate, maxDate };
}
