// ─────────────────────────────────────────────────────────────────────────────
// pdf-server URL builders for certificates & receipts.
//
// Extracted verbatim from app/api/generate-test-response/route.ts (the WhatsApp
// bot) so the reconciliation dashboard's future "send receipts to newly-eligible
// contributions" job can reuse the exact same URL construction. No behavior change:
// the only edit is using COST_PER_NAME (= 1000) instead of a hardcoded literal.
//
// The pdf-server host is hardcoded across the repo; keep it in sync if it moves.
// ─────────────────────────────────────────────────────────────────────────────

import { COST_PER_NAME } from "@/lib/mosaic/engine";

const CERTIFICATE_BASE_URL =
  "https://sbvt-pdf-gen-13a632ead426.herokuapp.com/download-ticket";
const RECEIPT_BASE_URL =
  "https://sbvt-pdf-gen-13a632ead426.herokuapp.com/generate-reciept";
const RUPEE_SYMBOL = "₹";
const AMOUNT_SUFFIX = "/-";

/** Everything the pdf-server needs to render a certificate / receipt for a donor. */
export interface DonorReceiptInfo {
  name: string;
  qty: number;
  blockId: string;
  serial: string;
  email: string;
  phone: string;
  paymentReference: string | null;
  createdAt: string;
  // "Online" | "UPI" | "Cash" | "" — printed on the receipt as mode_of_payment.
  modeOfPayment?: string;
}

// Map a reconciliation/submission payment channel to the receipt's mode_of_payment label.
export function modeOfPaymentLabel(channel: string | null | undefined): string {
  switch ((channel ?? "").toLowerCase()) {
    case "online":
      return "Online";
    case "upi":
      return "UPI";
    case "cash":
      return "Cash";
    default:
      return "";
  }
}

export function buildCertificateUrl(donor: DonorReceiptInfo) {
  const url = new URL(CERTIFICATE_BASE_URL);
  url.searchParams.set("name", donor.name);
  url.searchParams.set("qty", String(donor.qty));
  url.searchParams.set("block", donor.blockId);
  url.searchParams.set("serial", donor.serial);
  return url.toString();
}

export function formatDateOnly(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function randomReceiptNumber() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `R-${num}`;
}

export function numberToWords(value: number) {
  const ones = [
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];

  function chunkToWords(num: number): string {
    if (num < 20) return ones[num];
    if (num < 100) {
      const ten = Math.floor(num / 10);
      const rest = num % 10;
      return rest ? `${tens[ten]} ${ones[rest]}` : tens[ten];
    }
    const hundred = Math.floor(num / 100);
    const rest = num % 100;
    return rest
      ? `${ones[hundred]} Hundred ${chunkToWords(rest)}`
      : `${ones[hundred]} Hundred`;
  }

  if (value === 0) return "Zero";
  const parts: string[] = [];
  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1_000);
  const remainder = value % 1_000;

  if (millions) parts.push(`${chunkToWords(millions)} Million`);
  if (thousands) parts.push(`${chunkToWords(thousands)} Thousand`);
  if (remainder) parts.push(chunkToWords(remainder));
  return parts.join(" ");
}

export function buildReceiptUrl(
  donor: DonorReceiptInfo,
  legalName: string,
  address: string,
  pincode: string | null,
  receiptDate: string,
  // Treasury receipts pass their own sequential receipt number; the WhatsApp bot omits it
  // and falls back to a random one.
  receiptNo?: string,
  // Treasury receipts pass the ACTUAL received amount (rupees); the WhatsApp bot omits it
  // and falls back to the expected qty × cost-per-name.
  amountRupees?: number,
  // PAN to print on the receipt (collected for Wall-of-Legacy gifts over ₹10,000). Omitted
  // or empty → the pan_no field stays blank, as before.
  panNo?: string | null,
  // notes is printed only for general donations ("General Donation"); for Wall-of-Legacy
  // receipts it's not needed, so an empty/omitted value leaves the field off entirely.
  notes?: string | null,
) {
  const amount = amountRupees ?? donor.qty * COST_PER_NAME;
  // Split into rupees + paise from integer paise to avoid float drift.
  const totalPaise = Math.round(amount * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  const amountText = `${RUPEE_SYMBOL}${paise === 0 ? rupees : (totalPaise / 100).toFixed(2)}${AMOUNT_SUFFIX}`;
  // Whole-rupee wording is unchanged ("… Only"); paise amounts spell out both parts.
  const amountWords =
    paise === 0
      ? `${numberToWords(rupees)} Only`
      : `${numberToWords(rupees)} Rupees and ${numberToWords(paise)} Paise Only`;
  const url = new URL(RECEIPT_BASE_URL);
  url.searchParams.set("receipt_no", receiptNo ?? randomReceiptNumber());
  url.searchParams.set("receipt_date", receiptDate);
  url.searchParams.set("legal_name", legalName);
  url.searchParams.set("address", address);
  url.searchParams.set("pincode", pincode ?? "");
  url.searchParams.set("phone_no", donor.phone);
  url.searchParams.set("email", donor.email ?? "");
  url.searchParams.set("payment_reference", donor.paymentReference ?? "");
  url.searchParams.set("pan_no", panNo ?? "");
  url.searchParams.set("mode_of_payment", donor.modeOfPayment ?? "");
  url.searchParams.set("payment_date", formatDateOnly(donor.createdAt));
  url.searchParams.set("amount", amountText);
  url.searchParams.set("amount_in_words", amountWords);
  if (notes && notes.trim()) url.searchParams.set("notes", notes);
  return url.toString();
}
