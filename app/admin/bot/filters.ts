import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export type Filters = { sent: string; balance: string; q: string };

// Friendly labels for the raw whatsapp_intakes.status values.
export const STATUS_LABELS: Record<string, string> = {
  ready: "Waiting for first reply",
  awaiting_legal_name: "Awaiting name",
  awaiting_address: "Awaiting address",
  completed: "Completed",
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return STATUS_LABELS[status] ?? status;
}

export const SENT_OPTIONS = [
  { value: "all", label: "All" },
  { value: "yes", label: "Sent" },
  { value: "no", label: "Pending" },
];

export const BALANCE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Balance due" },
  { value: "done", label: "Fully received" },
];

// Validate raw query values against the allowed options, defaulting to "all".
export function normalizeFilters(
  sentRaw: string | null | undefined,
  balanceRaw: string | null | undefined,
  qRaw: string | null | undefined,
): Filters {
  const sent = SENT_OPTIONS.some((o) => o.value === sentRaw)
    ? (sentRaw as string)
    : "all";
  const balance = BALANCE_OPTIONS.some((o) => o.value === balanceRaw)
    ? (balanceRaw as string)
    : "all";
  const q = typeof qRaw === "string" ? qRaw.trim() : "";
  return { sent, balance, q };
}

export function buildKkdWhere({
  sent,
  balance,
  q,
}: Filters): Prisma.KkdCollectionWhereInput {
  const where: Prisma.KkdCollectionWhereInput = {};
  if (sent === "yes") where.messageSent = true;
  else if (sent === "no") where.messageSent = false;
  if (balance === "pending") {
    where.amtReceived = { lt: prisma.kkdCollection.fields.amtCommitted };
  } else if (balance === "done") {
    where.amtReceived = { gte: prisma.kkdCollection.fields.amtCommitted };
  }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { whatsapp: { contains: q } },
    ];
  }
  return where;
}
