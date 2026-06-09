// Canonical WhatsApp-number key used to GROUP and JOIN across tables that store
// the same number in different shapes — block_submissions.whatsapp is "+91 9876543210"
// (spaced, with a leading +country), while whatsapp_intakes.phone is the raw Doubletick
// "919876543210" (digits, no +). Both collapse to the same key here.
//
// This is a grouping/display helper only. Do NOT use it to rewrite stored values:
// the spaced "+91 …" form in block_submissions is the lookup format the live Doubletick
// receipt path matches on (see app/api/block-submissions/route.ts) — changing it breaks receipts.

// Digits-only, no '+', no spaces. "+91 98765 43210" / "09876543210" / "9876543210" /
// "919876543210" → "919876543210". India-default: a bare 10-digit number gets +91.
// Returns "" for empty/garbage so callers can skip those rows.
export function normalizeWhatsappNumber(raw: string): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  // Strip a "00" international call prefix, then any leading trunk zeros.
  const d = digits.replace(/^00/, "").replace(/^0+/, "");
  if (!d) return "";
  if (d.length === 10) return "91" + d; // bare Indian mobile
  if (d.length === 12 && d.startsWith("91")) return d; // already +91-prefixed
  return d; // already carries some country code
}

// Pretty form for display only — never use as a key.
export function formatWhatsappDisplay(normalized: string): string {
  if (!normalized) return "—";
  if (normalized.length === 12 && normalized.startsWith("91")) {
    return "+91 " + normalized.slice(2);
  }
  return "+" + normalized;
}

// True when the canonical key is an Indian number: country code 91 + 10-digit mobile.
// Used to scope outbound campaigns (e.g. the WoL random batch) to Indian numbers only.
export function isIndianWhatsappNumber(normalized: string): boolean {
  return normalized.length === 12 && normalized.startsWith("91");
}

// Heuristic: does `normalized` (digits-only, country-coded — the output of
// normalizeWhatsappNumber) look like a REAL phone number, or the placeholder junk a
// volunteer types to clear a required field (9999999999, 0000000000, 0123456789)?
//
// This is a soft "a human should look at this" signal, not a strict validator — it errs
// toward flagging obvious garbage and passing anything otherwise plausible.
export function looksLikePhoneNumber(normalized: string): boolean {
  if (!normalized) return false;

  // National significant number: drop the India country code when present so the checks
  // below run on the 10-digit mobile number rather than the "91" prefix.
  const indian = normalized.length === 12 && normalized.startsWith("91");
  const body = indian ? normalized.slice(2) : normalized;

  if (indian) {
    if (body.length !== 10) return false; // Indian mobiles are exactly 10 digits
    if (!/^[6-9]/.test(body)) return false; // …and start with the 6–9 mobile series
  } else if (normalized.length < 10 || normalized.length > 15) {
    return false; // outside the normal E.164 national range
  }

  // Placeholder patterns: all identical digits (9999999999), a strict ascending or
  // descending run (0123456789 / 9876543210), or too little variety to be a real number
  // (1212121212, 9090909090).
  if (/^(\d)\1+$/.test(body)) return false;
  if (isStrictDigitRun(body)) return false;
  if (new Set(body).size <= 2) return false;

  return true;
}

// True when every adjacent pair of digits steps by exactly +1 (ascending) or −1
// (descending) across the whole string — i.e. a counting sequence, not a phone number.
function isStrictDigitRun(s: string): boolean {
  if (s.length < 4) return false;
  let asc = true;
  let desc = true;
  for (let i = 1; i < s.length; i++) {
    const step = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (step !== 1) asc = false;
    if (step !== -1) desc = false;
  }
  return asc || desc;
}
