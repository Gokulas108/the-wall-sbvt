// ─────────────────────────────────────────────────────────────────────────────
// Wall-of-Legacy per-number context: given one WhatsApp number, resolve the legal
// name / address / PAN we hold (from whatsapp_intakes) plus every wall donation line
// (block_submissions) with its serial, payment reference, reconciled amount, and
// whether that reference is shared with any other donor.
//
// Two entry points:
//   getWolNumberSummary  — light (this number's submissions + intake only). Used by the
//                          outbound trigger to choose the template + placeholder name; cheap
//                          enough to call once per number in the random burst.
//   getWolNumberContext  — heavy (full reference-sharing + reconciliation scan). Used once
//                          per donor interaction when actually building receipts.
//
// Phone shapes differ across tables (block_submissions.whatsapp "+91 98…" vs
// whatsapp_intakes.phone "9198…"); we normalise + join in JS exactly like
// lib/whatsapp-care/address-collection.ts and lib/reconciliation/receipts.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/db/prisma";
import { COST_PER_NAME, formatINR } from "@/lib/mosaic/engine";
import { MATCHED_STATUSES } from "@/lib/reconciliation/format";
import { modeOfPaymentLabel } from "@/lib/receipts/urls";
import {
  normalizeWhatsappNumber,
  formatWhatsappDisplay,
} from "@/lib/whatsapp-care/phone";

// PAN is collected (no-address flow) when a number's total contribution exceeds this.
export const PAN_THRESHOLD_RUPEES = 10000;

export interface WolDonorLine {
  submissionId: number;
  donorName: string;
  qty: number;
  blockId: string;
  serial: string;
  email: string;
  phone: string; // contact phone (block_submissions.phone) — used as receipt phone_no
  paymentReference: string | null; // resolved ref (gateway/upi/typed) or null
  createdAt: string; // ISO
  reconciledRupees: number | null; // matched amount (rupees) when reconciled, else null
  referenceShared: boolean; // resolved ref carried by >1 submission globally
  nominalRupees: number; // qty × COST_PER_NAME
  modeOfPayment: string; // "Online" | "UPI" | "Cash" | "" — for the receipt
}

export interface WolNumberContext {
  found: boolean; // at least one wall donation line for this number
  normalizedNumber: string;
  displayNumber: string;
  legalName: string | null;
  address: string | null;
  pincode: string | null;
  panNo: string | null;
  intakeStatus: string | null;
  donorNames: string[]; // distinct, in line order
  lines: WolDonorLine[];
  totalRupees: number; // Σ nominalRupees — the headline total
  hasDetails: boolean; // legalName && address present
  panRequired: boolean; // totalRupees > PAN_THRESHOLD_RUPEES
  panSatisfied: boolean; // !panRequired || panNo present
}

export interface WolNumberSummary {
  found: boolean;
  normalizedNumber: string;
  displayNumber: string;
  donorNames: string[]; // distinct
  donorCount: number; // distinct donor names
  lineCount: number; // block_submission lines
  totalRupees: number;
  latestDate: string | null; // ISO of this number's most recent submission, null if none
  legalName: string | null;
  address: string | null;
  panNo: string | null;
  intakeStatus: string | null;
  hasDetails: boolean;
  panRequired: boolean;
  panSatisfied: boolean;
}

function serialFor(sub: {
  serialNumber: string | null;
  actionType: string;
  blockId: string;
  id: number;
}): string {
  if (sub.serialNumber) return sub.serialNumber;
  const prefix = sub.actionType === "pledge" ? "PLG" : "DON";
  return `${prefix}-${sub.blockId}-${String(sub.id).padStart(6, "0")}`;
}

// Latest intake row (legal name / address / PAN) for the canonical number. There is one
// intake per phone, but the stored shape can differ, so match by trailing-10 then confirm.
async function findIntakeForKey(key: string) {
  const last10 = key.slice(-10);
  const candidates = await prisma.whatsAppIntake.findMany({
    where: { phone: { contains: last10 } },
    select: {
      phone: true,
      status: true,
      legalName: true,
      address: true,
      pincode: true,
      panNo: true,
      testAmount: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  return candidates.find((c) => normalizeWhatsappNumber(c.phone) === key) ?? null;
}

export async function getWolNumberSummary(
  rawNumber: string,
): Promise<WolNumberSummary> {
  const key = normalizeWhatsappNumber(rawNumber);
  const displayNumber = formatWhatsappDisplay(key);
  const base: WolNumberSummary = {
    found: false,
    normalizedNumber: key,
    displayNumber,
    donorNames: [],
    donorCount: 0,
    lineCount: 0,
    totalRupees: 0,
    latestDate: null,
    legalName: null,
    address: null,
    panNo: null,
    intakeStatus: null,
    hasDetails: false,
    panRequired: false,
    panSatisfied: true,
  };
  if (!key) return base;

  const last10 = key.slice(-10);
  const [subs, intake] = await Promise.all([
    prisma.blockSubmission.findMany({
      where: { whatsapp: { contains: last10 } },
      select: { name: true, qty: true, whatsapp: true, createdAt: true },
    }),
    findIntakeForKey(key),
  ]);
  const mine = subs.filter((s) => normalizeWhatsappNumber(s.whatsapp) === key);

  const donorNames = [
    ...new Set(mine.map((s) => s.name.trim()).filter(Boolean)),
  ];
  const totalRupees = mine.reduce((a, s) => a + s.qty * COST_PER_NAME, 0);
  const latest = mine.reduce<Date | null>(
    (a, s) => (!a || s.createdAt > a ? s.createdAt : a),
    null,
  );
  const legalName = intake?.legalName?.trim() ? intake.legalName : null;
  const address = intake?.address?.trim() ? intake.address : null;
  const panNo = intake?.panNo?.trim() ? intake.panNo : null;
  // testAmount (set only by the /admin/wol-test dashboard, null for real donors) overrides
  // the rupee basis for the PAN threshold so the PAN branch can be exercised end-to-end.
  const effectiveForPan = intake?.testAmount ?? totalRupees;
  const panRequired = effectiveForPan > PAN_THRESHOLD_RUPEES;

  return {
    found: mine.length > 0,
    normalizedNumber: key,
    displayNumber,
    donorNames,
    donorCount: donorNames.length,
    lineCount: mine.length,
    totalRupees,
    latestDate: latest ? latest.toISOString() : null,
    legalName,
    address,
    panNo,
    intakeStatus: intake?.status ?? null,
    hasDetails: Boolean(legalName && address),
    panRequired,
    panSatisfied: !panRequired || Boolean(panNo),
  };
}

export async function getWolNumberContext(
  rawNumber: string,
): Promise<WolNumberContext> {
  const key = normalizeWhatsappNumber(rawNumber);
  const displayNumber = formatWhatsappDisplay(key);
  const empty: WolNumberContext = {
    found: false,
    normalizedNumber: key,
    displayNumber,
    legalName: null,
    address: null,
    pincode: null,
    panNo: null,
    intakeStatus: null,
    donorNames: [],
    lines: [],
    totalRupees: 0,
    hasDetails: false,
    panRequired: false,
    panSatisfied: true,
  };
  if (!key) return empty;

  // Full scan to resolve references exactly like address-collection.ts: a line's reference
  // is the matched gateway/UPI ref, else its typed paymentReference. Shared iff >1 submission
  // carries the same resolved reference (within OR across numbers).
  const [submissions, contributions, intake] = await Promise.all([
    prisma.blockSubmission.findMany({
      select: {
        id: true,
        name: true,
        whatsapp: true,
        qty: true,
        blockId: true,
        serialNumber: true,
        actionType: true,
        paymentMethod: true,
        email: true,
        phone: true,
        paymentReference: true,
        createdAt: true,
      },
    }),
    prisma.contribution.findMany({
      where: { blockSubmissionId: { not: null } },
      select: {
        blockSubmissionId: true,
        status: true,
        matchedPaise: true,
        matches: {
          select: {
            gatewayTxn: { select: { transactionId: true, rrn: true } },
            upiTxn: { select: { bankRRN: true, merchantTranId: true } },
          },
        },
      },
    }),
    findIntakeForKey(key),
  ]);

  const contribBySub = new Map<
    number,
    { status: string; matchedPaise: number; matchedRef: string | null }
  >();
  for (const c of contributions) {
    if (c.blockSubmissionId == null) continue;
    let matchedRef: string | null = null;
    for (const m of c.matches) {
      if (m.gatewayTxn) {
        matchedRef = m.gatewayTxn.transactionId ?? m.gatewayTxn.rrn ?? null;
        break;
      }
      if (m.upiTxn) {
        matchedRef = m.upiTxn.bankRRN ?? m.upiTxn.merchantTranId ?? null;
        break;
      }
    }
    contribBySub.set(c.blockSubmissionId, {
      status: c.status,
      matchedPaise: c.matchedPaise,
      matchedRef,
    });
  }

  const resolvedRefBySub = new Map<number, string | null>();
  const refToSubs = new Map<string, number[]>();
  for (const s of submissions) {
    const contrib = contribBySub.get(s.id);
    let ref: string | null = null;
    if (contrib?.matchedRef) ref = contrib.matchedRef;
    else if (s.paymentReference) ref = s.paymentReference;
    resolvedRefBySub.set(s.id, ref);
    if (ref) {
      const arr = refToSubs.get(ref) ?? [];
      arr.push(s.id);
      refToSubs.set(ref, arr);
    }
  }

  const mine = submissions
    .filter((s) => normalizeWhatsappNumber(s.whatsapp) === key)
    .sort((a, b) => a.id - b.id); // oldest first, stable

  const legalName = intake?.legalName?.trim() ? intake.legalName : null;
  const address = intake?.address?.trim() ? intake.address : null;
  const panNo = intake?.panNo?.trim() ? intake.panNo : null;

  if (mine.length === 0) {
    return {
      ...empty,
      found: false,
      legalName,
      address,
      pincode: intake?.pincode ?? null,
      panNo,
      intakeStatus: intake?.status ?? null,
    };
  }

  const lines: WolDonorLine[] = mine.map((s) => {
    const ref = resolvedRefBySub.get(s.id) ?? null;
    const shared = ref ? (refToSubs.get(ref)?.length ?? 0) > 1 : false;
    const contrib = contribBySub.get(s.id);
    const reconciledRupees =
      contrib && MATCHED_STATUSES.has(contrib.status) && contrib.matchedPaise > 0
        ? contrib.matchedPaise / 100
        : null;
    return {
      submissionId: s.id,
      donorName: s.name,
      qty: s.qty,
      blockId: s.blockId,
      serial: serialFor(s),
      email: s.email,
      phone: s.phone,
      paymentReference: ref,
      createdAt: s.createdAt.toISOString(),
      reconciledRupees,
      referenceShared: shared,
      nominalRupees: s.qty * COST_PER_NAME,
      modeOfPayment: modeOfPaymentLabel(
        s.actionType === "online_donate" ? "online" : s.paymentMethod,
      ),
    };
  });

  const donorNames = [
    ...new Set(lines.map((l) => l.donorName.trim()).filter(Boolean)),
  ];
  const totalRupees = lines.reduce((a, l) => a + l.nominalRupees, 0);
  const hasDetails = Boolean(legalName && address);
  // testAmount (set only by the /admin/wol-test dashboard, null for real donors) overrides
  // the rupee basis for the PAN threshold so the PAN branch can be exercised end-to-end.
  const effectiveForPan = intake?.testAmount ?? totalRupees;
  const panRequired = effectiveForPan > PAN_THRESHOLD_RUPEES;

  return {
    found: true,
    normalizedNumber: key,
    displayNumber,
    legalName,
    address,
    pincode: intake?.pincode ?? null,
    panNo,
    intakeStatus: intake?.status ?? null,
    donorNames,
    lines,
    totalRupees,
    hasDetails,
    panRequired,
    panSatisfied: !panRequired || Boolean(panNo),
  };
}

// Placeholder name for the outbound template / receipt salutation: a single donor's name,
// or "<first> and N others" when the number has multiple distinct donors.
export function donorPlaceholderName(donorNames: string[]): string {
  if (donorNames.length === 0) return "Donor";
  if (donorNames.length === 1) return donorNames[0];
  return `${donorNames[0]} and ${donorNames.length - 1} others`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ISO timestamp → "18 Jun 2026". Parsed from the date part to stay timezone-stable.
export function formatDonationDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  const mi = Number(m) - 1;
  if (!y || !d || mi < 0 || mi > 11) return "";
  return `${Number(d)} ${MONTHS[mi]} ${y}`;
}

// Body placeholders for the wol_no_address_v1 template, in its declared order:
// [donorName, amount, date]. `amount` is the BARE rupee number (the approved template body
// renders "₹{{amount}}/-"); `date` is the number's latest contribution date as "18 Jun 2026".
// Falls back to today's date only if, exceptionally, no dated submission is on file.
export function wolNoAddressV1Placeholders(summary: WolNumberSummary): string[] {
  return [
    donorPlaceholderName(summary.donorNames),
    formatINR(summary.totalRupees),
    formatDonationDate(summary.latestDate ?? new Date().toISOString()),
  ];
}
