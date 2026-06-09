import { Prisma, type TreasuryReceipt } from "@prisma/client";
import JSZip from "jszip";
import Papa from "papaparse";
import { prisma } from "@/lib/db/prisma";
import { DONATION_TYPE_LABEL, type DonationType } from "@/lib/reconciliation/format";
import {
  bustReceiptsCache,
  formatTreasuryReceiptNo,
  getReceiptTransactionsByIds,
} from "@/lib/reconciliation/receipts";
import {
  buildReceiptUrl,
  formatDateOnly,
  modeOfPaymentLabel,
  type DonorReceiptInfo,
} from "@/lib/receipts/urls";

// Submit the selected matched transactions to the treasury: snapshot each into a
// treasury_receipts row (the row id IS the sequential receipt number). Idempotent —
// already-submitted transactions (unique transactionKey) are skipped, including the rare
// concurrent double-submit (P2002). Returns the freshly-created rows for CSV/ZIP download.
export async function submitReceiptsToTreasury(
  contributionIds: number[],
  admin: { id: number; username: string },
): Promise<{ created: TreasuryReceipt[]; skipped: number }> {
  const candidates = await getReceiptTransactionsByIds(contributionIds);
  if (candidates.length === 0) return { created: [], skipped: 0 };

  const existing = await prisma.treasuryReceipt.findMany({
    where: { transactionKey: { in: candidates.map((c) => c.transactionKey) } },
    select: { transactionKey: true },
  });
  const existingKeys = new Set(existing.map((e) => e.transactionKey));

  const created: TreasuryReceipt[] = [];
  for (const c of candidates) {
    if (existingKeys.has(c.transactionKey)) continue;
    try {
      const row = await prisma.treasuryReceipt.create({
        data: {
          transactionKey: c.transactionKey,
          contributionId: c.id,
          txnId: c.paymentReference,
          paymentChannel: c.paymentChannel,
          status: c.status,
          donationType: c.donationType,
          amountPaise: c.matchedPaise,
          qty: c.qty,
          donorName: c.donorName,
          donorPhone: c.donorPhone,
          donorEmail: c.donorEmail,
          whatsapp: c.whatsapp,
          legalName: c.legalName,
          address: c.address,
          pincode: c.pincode,
          contributedAt: c.contributedAt ? new Date(c.contributedAt) : null,
          submittedById: admin.id,
          submittedByUsername: admin.username,
        },
      });
      created.push(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }

  bustReceiptsCache(); // the submitted ones drop out of the "yet to submit" list
  return { created, skipped: candidates.length - created.length };
}

// Move receipts back to "yet to submit": delete the treasury rows so the transactions
// reappear in the pending list. Their (id-based) receipt numbers are released — a later
// re-submit assigns fresh ones. Returns how many were removed.
export async function unsubmitTreasuryReceipts(receiptIds: number[]): Promise<number> {
  if (receiptIds.length === 0) return 0;
  const { count } = await prisma.treasuryReceipt.deleteMany({ where: { id: { in: receiptIds } } });
  bustReceiptsCache();
  return count;
}

export async function getTreasuryReceiptsByIds(ids: number[]): Promise<TreasuryReceipt[]> {
  if (ids.length === 0) return [];
  return prisma.treasuryReceipt.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
}

function donationLabel(donationType: string): string {
  const key: DonationType = donationType === "general" ? "general" : "wall_of_legacy";
  return DONATION_TYPE_LABEL[key];
}

// CSV for the treasury. The donation type rides in a "Note" column.
export function buildTreasuryCsv(receipts: TreasuryReceipt[]): string {
  const rows = receipts.map((r) => ({
    "Receipt Number": formatTreasuryReceiptNo(r.id),
    "Receipt Date": r.submittedAt ? formatDateOnly(r.submittedAt) : "",
    "Transaction Id": r.txnId ?? "",
    "Payment Date": r.contributedAt ? formatDateOnly(r.contributedAt) : "",
    "Payment Mode": r.paymentChannel,
    "Amount Received": (r.amountPaise / 100).toFixed(2),
    "Legal Name": r.legalName ?? "",
    Phone: r.donorPhone ?? "",
    Address: r.address ?? "",
    Pincode: r.pincode ?? "",
    Note: donationLabel(r.donationType),
  }));
  return Papa.unparse(rows);
}

// One PDF per receipt, fetched from the pdf-server via buildReceiptUrl (same construction
// as the WhatsApp bot) and zipped, alongside the treasury CSV — a single download. Bounded
// concurrency; a PDF that fails to fetch is skipped rather than failing the whole archive.
export async function buildTreasuryZip(receipts: TreasuryReceipt[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("receipts.csv", buildTreasuryCsv(receipts));
  const receiptDate = formatDateOnly(new Date());
  const CONCURRENCY = 5;
  let cursor = 0;

  async function worker() {
    while (cursor < receipts.length) {
      const r = receipts[cursor++];
      const receiptNo = formatTreasuryReceiptNo(r.id);
      const donor: DonorReceiptInfo = {
        name: r.legalName ?? r.donorName ?? "",
        qty: r.qty,
        blockId: "",
        serial: "",
        email: r.donorEmail ?? "",
        phone: r.donorPhone ?? "",
        paymentReference: r.txnId,
        createdAt: (r.contributedAt ?? r.submittedAt).toISOString(),
        modeOfPayment: modeOfPaymentLabel(r.paymentChannel),
      };
      const url = buildReceiptUrl(
        donor,
        r.legalName ?? donor.name,
        r.address ?? "",
        r.pincode,
        receiptDate,
        receiptNo,
        r.amountPaise / 100, // actual received amount, not qty × cost-per-name
        undefined, // panNo — treasury receipts don't carry PAN
        r.donationType === "general" ? "General Donation" : undefined,
      );
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const safe = (r.legalName ?? r.donorName ?? "receipt").replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
        zip.file(`${receiptNo}_${safe}.pdf`, buf);
      } catch {
        // skip an unreachable PDF; the rest of the archive still downloads
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, receipts.length) }, () => worker()));
  return zip.generateAsync({ type: "nodebuffer" });
}
