// ─────────────────────────────────────────────────────────────────────────────
// Wall-of-Legacy daily send cap + random eligibility.
//
// Only the INITIAL outbound template (wol_address_exists / wol_no_address) counts against
// the 250/day cap; each successful send writes one WolMessageLog row. The day window is
// IST midnight (the campaign is India-based). The random batch draws from "all okay"
// numbers that — for the initial rollout — have exactly one donor, excluding any number
// already sent the WoL template.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/db/prisma";
import { getAddressCollection } from "@/lib/whatsapp-care/address-collection";

export const WOL_DAILY_LIMIT = 250;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// The UTC instant of the most recent 00:00 IST.
function istDayStart(now = Date.now()): Date {
  const shifted = now + IST_OFFSET_MS;
  const dayStart = Math.floor(shifted / 86_400_000) * 86_400_000;
  return new Date(dayStart - IST_OFFSET_MS);
}

export interface WolSendStatus {
  limit: number;
  sentToday: number;
  remaining: number;
}

export async function getWolSendStatus(): Promise<WolSendStatus> {
  const sentToday = await prisma.wolMessageLog.count({
    where: { status: "sent", createdAt: { gte: istDayStart() } },
  });
  return {
    limit: WOL_DAILY_LIMIT,
    sentToday,
    remaining: Math.max(0, WOL_DAILY_LIMIT - sentToday),
  };
}

export async function recordWolSend(entry: {
  normalizedPhone: string;
  templateName: string;
  donorName?: string | null;
  status?: "sent" | "failed";
  userId?: number | null;
  username?: string | null;
}): Promise<void> {
  await prisma.wolMessageLog.create({
    data: {
      normalizedPhone: entry.normalizedPhone,
      templateName: entry.templateName,
      donorName: entry.donorName ?? null,
      status: entry.status ?? "sent",
      sentByUserId: entry.userId ?? null,
      sentByUsername: entry.username ?? null,
    },
  });
}

// Has this number already been sent the WoL template (any day)? Used to keep the manual
// per-row send idempotent-ish and to exclude from the random batch.
export async function alreadySentNumbers(): Promise<Set<string>> {
  const rows = await prisma.wolMessageLog.findMany({
    where: { status: "sent" },
    select: { normalizedPhone: true },
  });
  return new Set(rows.map((r) => r.normalizedPhone));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Random "all okay", single-donor WoL numbers not yet sent, capped at `budget`.
export async function pickRandomEligibleNumbers(
  budget: number,
): Promise<string[]> {
  if (budget <= 0) return [];
  const [{ rows }, sent] = await Promise.all([
    getAddressCollection(),
    alreadySentNumbers(),
  ]);
  const eligible = rows.filter(
    (r) =>
      !r.needsReview &&
      !r.isInvalid &&
      r.donorNames.length === 1 &&
      !sent.has(r.normalizedNumber),
  );
  return shuffle(eligible)
    .slice(0, budget)
    .map((r) => r.normalizedNumber);
}
