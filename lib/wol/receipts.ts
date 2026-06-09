// ─────────────────────────────────────────────────────────────────────────────
// Wall-of-Legacy receipt + certificate assembly. Turns a WolNumberContext into the
// list of pdf-server document URLs to deliver, applying the per-mode rules:
//
//   single    — one line on the number: one receipt. Reference + reconciled amount kept
//               when the reference is exclusive; blanked + nominal (qty×₹1000) when shared.
//   combined  — multi-donor, donor chose "1": ONE receipt, legal name, blank reference
//               (the lines carry different references), amount = Σ of each line's effective
//               amount.
//   per_line  — multi-donor, donor chose "2": one receipt per line, each by the single rule.
//
// Certificates are always one per block-submission line (name + qty + block + serial).
// ─────────────────────────────────────────────────────────────────────────────

import {
  buildCertificateUrl,
  buildReceiptUrl,
  formatDateOnly,
  randomReceiptNumber,
  type DonorReceiptInfo,
} from "@/lib/receipts/urls";
import type { WolDonorLine, WolNumberContext } from "@/lib/wol/context";

export type WolReceiptMode = "single" | "combined" | "per_line";

export interface WolReceiptDoc {
  url: string;
  filename: string;
  label: string; // donor name (per-line) or legal name (combined) — for logging/captions
}

export interface WolCertDoc {
  url: string;
  filename: string;
  donorName: string;
}

const RECEIPT_FILENAME = "WoL-Receipt.pdf";
const CERTIFICATE_FILENAME = "WoL-Certificate.pdf";

// Effective receipt amount + reference for ONE line. Exclusive reference → keep the real
// reconciled amount (else nominal) and the reference. Shared → blank the reference and use
// the nominal qty×₹1000.
function lineValues(line: WolDonorLine): {
  amountRupees: number;
  paymentReference: string | null;
} {
  if (line.referenceShared) {
    return { amountRupees: line.nominalRupees, paymentReference: null };
  }
  return {
    amountRupees: line.reconciledRupees ?? line.nominalRupees,
    paymentReference: line.paymentReference,
  };
}

// Combined-receipt total (used both for the combined receipt amount and the "₹X total"
// shown in the multi-donor choice prompt).
export function combinedReceiptRupees(ctx: WolNumberContext): number {
  return ctx.lines.reduce((a, l) => a + lineValues(l).amountRupees, 0);
}

export function resolveReceiptMode(
  ctx: WolNumberContext,
  choice?: "1" | "2",
): WolReceiptMode {
  if (ctx.lines.length <= 1) return "single";
  return choice === "1" ? "combined" : "per_line";
}

export function buildReceipts(
  ctx: WolNumberContext,
  mode: WolReceiptMode,
): WolReceiptDoc[] {
  const legalName = ctx.legalName ?? ctx.donorNames[0] ?? "Donor";
  const address = ctx.address ?? "";
  const receiptDate = formatDateOnly(new Date());

  if (mode === "combined") {
    const rep = ctx.lines[0];
    const totalQty = ctx.lines.reduce((a, l) => a + l.qty, 0);
    // One mode_of_payment only when every line shares it; otherwise leave it blank.
    const modes = new Set(ctx.lines.map((l) => l.modeOfPayment).filter(Boolean));
    const donor: DonorReceiptInfo = {
      name: rep.donorName,
      qty: totalQty,
      blockId: rep.blockId,
      serial: rep.serial,
      email: rep.email,
      phone: rep.phone,
      paymentReference: null, // different references across lines → blank
      createdAt: rep.createdAt,
      modeOfPayment: modes.size === 1 ? [...modes][0] : "",
    };
    const url = buildReceiptUrl(
      donor,
      legalName,
      address,
      ctx.pincode,
      receiptDate,
      randomReceiptNumber(),
      combinedReceiptRupees(ctx),
      ctx.panNo,
    );
    return [{ url, filename: RECEIPT_FILENAME, label: legalName }];
  }

  // single + per_line: one receipt per line, each by its own exclusive/shared rule.
  return ctx.lines.map((line) => {
    const { amountRupees, paymentReference } = lineValues(line);
    const donor: DonorReceiptInfo = {
      name: line.donorName,
      qty: line.qty,
      blockId: line.blockId,
      serial: line.serial,
      email: line.email,
      phone: line.phone,
      paymentReference,
      createdAt: line.createdAt,
      modeOfPayment: line.modeOfPayment,
    };
    const url = buildReceiptUrl(
      donor,
      legalName,
      address,
      ctx.pincode,
      receiptDate,
      randomReceiptNumber(),
      amountRupees,
      ctx.panNo,
    );
    return { url, filename: RECEIPT_FILENAME, label: line.donorName };
  });
}

export function buildCertificates(ctx: WolNumberContext): WolCertDoc[] {
  return ctx.lines.map((line) => {
    const donor: DonorReceiptInfo = {
      name: line.donorName,
      qty: line.qty,
      blockId: line.blockId,
      serial: line.serial,
      email: line.email,
      phone: line.phone,
      paymentReference: line.paymentReference,
      createdAt: line.createdAt,
    };
    return {
      url: buildCertificateUrl(donor),
      filename: CERTIFICATE_FILENAME,
      donorName: line.donorName,
    };
  });
}
