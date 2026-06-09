import { prisma } from "@/lib/db/prisma";
import { GOAL } from "@/lib/mosaic/engine";
import { ALL_STATUSES } from "@/lib/reconciliation/engine";
import { getReceiptCounts, type ReceiptCounts } from "@/lib/reconciliation/receipts";

// Per-status rollup: count plus the summed money for that status bucket.
export interface StatusBreakdownRow {
  count: number;
  expectedPaise: number;
  matchedPaise: number;
  variancePaise: number;
}

// Per payment-channel rollup (online / upi / cash / none).
export interface ChannelBreakdownRow {
  channel: string;
  count: number;
  expectedPaise: number;
  matchedPaise: number;
}

// One day of donation activity for the overview time chart (ascending by day).
// Excludes cash-bucket settlement rows — those are deposits, not donations.
export interface DonationsByDayRow {
  day: string; // YYYY-MM-DD (UTC)
  count: number;
  receivedPaise: number;
}

// One contiguous date span (inclusive, day granularity) of unverified payments whose
// statement hasn't been uploaded — i.e. a CSV the admin should export & upload.
export interface CsvUploadRange {
  start: string; // YYYY-MM-DD (inclusive)
  end: string; // YYYY-MM-DD (inclusive)
  count: number;
  expectedPaise: number;
}

// CSV uploads needed for one channel: the statement kind to export, plus the date
// ranges (clustered) it must cover to clear that channel's csv_not_uploaded backlog.
export interface CsvUploadNeed {
  channel: "online" | "upi";
  kind: "gateway" | "upi"; // the statement kind to upload
  ranges: CsvUploadRange[];
  count: number; // total csv_not_uploaded contributions in this channel (incl. undated)
  expectedPaise: number;
  undatedCount: number; // rows with no contributedAt — can't be placed in a range
}

// Needed-day clusters separated by more than this many days become separate ranges;
// closer ones collapse into a single suggested upload window. (Re-uploading an
// overlapping range is idempotent, so erring toward fewer, wider ranges is safe.)
const CSV_RANGE_MERGE_GAP_DAYS = 7;

const MS_PER_DAY = 86_400_000;

// Cluster a map of day → totals into contiguous date ranges (see CSV_RANGE_MERGE_GAP_DAYS).
function clusterDaysIntoRanges(
  byDay: Map<string, { count: number; expectedPaise: number }>,
): CsvUploadRange[] {
  const days = [...byDay.keys()].sort();
  const ranges: CsvUploadRange[] = [];
  let current: CsvUploadRange | null = null;
  let prevIdx = 0;
  for (const day of days) {
    const idx = Math.floor(Date.parse(day + "T00:00:00Z") / MS_PER_DAY);
    const cell = byDay.get(day)!;
    if (current && idx - prevIdx <= CSV_RANGE_MERGE_GAP_DAYS) {
      current.end = day;
      current.count += cell.count;
      current.expectedPaise += cell.expectedPaise;
    } else {
      if (current) ranges.push(current);
      current = { start: day, end: day, count: cell.count, expectedPaise: cell.expectedPaise };
    }
    prevIdx = idx;
  }
  if (current) ranges.push(current);
  return ranges;
}

// Card rollups, read straight from the materialized Contribution ledger (that is
// exactly what the read-model is for). All amounts in paise; the client formats.
export interface ReconciliationSummary {
  statusCounts: Record<string, number>;
  // Counts + money per status, for the Overview distribution table. Same source as
  // statusCounts (cash buckets included, as SETTLEMENT), so totals line up with the ledger.
  statusBreakdown: Record<string, StatusBreakdownRow>;
  channelBreakdown: ChannelBreakdownRow[];
  // Total ledger contributions (includes cash buckets as SETTLEMENT, matching the ledger view).
  totalContributions: number;
  // ICICI gateway fees deducted on matched successful charges (gross − net).
  gatewayChargesPaise: number;
  // Treasury receipt readiness, same source as the Receipts view: a transaction is
  // "ready" once one of its WhatsApp numbers has sent a legal name + address.
  receiptsReady: ReceiptCounts;
  expectedWallPaise: number;
  receivedGrossPaise: number;
  receivedNetPaise: number;
  pledgedPaise: number;
  surplusPaise: number;
  shortfallPaise: number;
  unverifiedPaise: number;
  orphanPaise: number;
  orphanCount: number;
  cashCollectedPaise: number;
  cashSettledPaise: number;
  generalReceivedPaise: number;
  // Donation-type split. General = birnagar donation-page gifts; Wall of Legacy =
  // names on the wall (block submissions) + volunteer cash.
  general: { count: number; expectedPaise: number; receivedPaise: number };
  wallOfLegacy: {
    count: number;
    expectedPaise: number;
    receivedPaise: number;
    pledgedPaise: number;
    cashCollectedPaise: number;
    cashSettledPaise: number;
  };
  goalPaise: number;
  // UNVERIFIED payments whose date is outside every uploaded statement window
  // (flag csv_not_uploaded): exporting & uploading the gateway/UPI statement for
  // these date ranges is what lets the reconciler match them. Grouped by channel.
  csvUploadsNeeded: CsvUploadNeed[];
  // UNVERIFIED payments an upload will NOT fix — missing or mistyped reference
  // (ref_not_in_csv / missing_reference). These need manual matching instead.
  unverifiedNeedsManual: { count: number; expectedPaise: number };
  // Daily donation activity (count + received money) for the overview time chart.
  donationsByDay: DonationsByDayRow[];
  lastRun: {
    id: number;
    startedAt: string;
    finishedAt: string | null;
    closureOk: boolean;
    // Username of the admin who triggered the run (null if unknown / no longer in users table).
    triggeredBy: string | null;
  } | null;
  lastBatches: {
    kind: string;
    createdAt: string;
    rowsTotal: number;
    periodStart: string | null;
    periodEnd: string | null;
  }[];
}

export async function getReconciliationSummary(): Promise<ReconciliationSummary> {
  const [byStatus, bySource, byChannel, receiptCounts, orphanAgg, gatewayCharges, cashCollectedAgg, unverifiedRows, dayRows, lastRun, batches] =
    await Promise.all([
      prisma.contribution.groupBy({
        by: ["status"],
        // Include cash buckets here so the SETTLEMENT chip count matches the ledger (buckets
        // now show as SETTLEMENT rows). They don't affect received totals: receivedFrom3
        // only sums MATCHED/OVERPAID/UNDERPAID, and settled cash flows in via bySource.
        _sum: { matchedPaise: true, expectedPaise: true, variancePaise: true },
        _count: { _all: true },
      }),
      prisma.contribution.groupBy({
        by: ["sourceType", "actionType"],
        _sum: { expectedPaise: true, matchedPaise: true },
        _count: { _all: true },
      }),
      prisma.contribution.groupBy({
        by: ["paymentChannel"],
        // Exclude settlement (cash_bucket) rows so channel totals reflect donor channels only.
        where: { sourceType: { not: "cash_bucket" } },
        _sum: { expectedPaise: true, matchedPaise: true },
        _count: { _all: true },
      }),
      // Treasury receipt readiness — same per-transaction aggregation the Receipts
      // view uses (only donors who've sent a legal name + address over WhatsApp count).
      getReceiptCounts(),
      prisma.contributionMatch.aggregate({
        where: { contributionId: null },
        _sum: { amountPaise: true },
        _count: { _all: true },
      }),
      prisma.gatewayTransaction.aggregate({
        where: { isSuccess: true, isRefund: false, match: { is: { contributionId: { not: null } } } },
        _sum: { chargesPaise: true },
      }),
      // Total cash COLLECTED across volunteers. Settlement rows only carry the settled
      // amount now (one row per deposit), so collected is read straight from the volunteers.
      prisma.donorFormUser.aggregate({ _sum: { amountInCash: true } }),
      // Every UNVERIFIED line, with just what's needed to build the upload-needed
      // date ranges. UNVERIFIED is a small bucket, so a findMany is fine here.
      prisma.contribution.findMany({
        where: { status: "UNVERIFIED" },
        select: { paymentChannel: true, contributedAt: true, expectedPaise: true, statusFlags: true },
      }),
      // Lean per-row projection for the daily donation chart; bucketed by day in JS
      // (no date_trunc in groupBy). Cash-bucket deposits excluded — not donations.
      prisma.contribution.findMany({
        where: { contributedAt: { not: null }, sourceType: { not: "cash_bucket" } },
        select: { contributedAt: true, matchedPaise: true },
      }),
      prisma.reconcileRun.findFirst({ orderBy: { id: "desc" } }),
      prisma.csvUploadBatch.findMany({ orderBy: { id: "desc" }, take: 6 }),
    ]);

  // ReconcileRun.triggeredById has no FK relation, so resolve the admin's name separately.
  const triggeredByUser = lastRun?.triggeredById
    ? await prisma.donorFormUser.findUnique({
        where: { id: lastRun.triggeredById },
        select: { username: true },
      })
    : null;

  const statusCounts: Record<string, number> = Object.fromEntries(
    ALL_STATUSES.map((s) => [s, 0]),
  );
  const statusBreakdown: Record<string, StatusBreakdownRow> = Object.fromEntries(
    ALL_STATUSES.map((s) => [s, { count: 0, expectedPaise: 0, matchedPaise: 0, variancePaise: 0 }]),
  );
  let receivedFrom3 = 0;
  let surplus = 0;
  let shortfall = 0;
  let unverified = 0;
  let totalContributions = 0;
  for (const g of byStatus) {
    statusCounts[g.status] = g._count._all;
    statusBreakdown[g.status] = {
      count: g._count._all,
      expectedPaise: g._sum.expectedPaise ?? 0,
      matchedPaise: g._sum.matchedPaise ?? 0,
      variancePaise: g._sum.variancePaise ?? 0,
    };
    totalContributions += g._count._all;
    if (g.status === "MATCHED" || g.status === "OVERPAID" || g.status === "UNDERPAID") {
      receivedFrom3 += g._sum.matchedPaise ?? 0;
    }
    if (g.status === "OVERPAID") surplus += g._sum.variancePaise ?? 0;
    if (g.status === "UNDERPAID") shortfall += Math.abs(g._sum.variancePaise ?? 0);
    if (g.status === "UNVERIFIED" || g.status === "AMBIGUOUS") {
      unverified += g._sum.expectedPaise ?? 0;
    }
  }

  const channelBreakdown: ChannelBreakdownRow[] = byChannel
    .map((g) => ({
      channel: g.paymentChannel,
      count: g._count._all,
      expectedPaise: g._sum.expectedPaise ?? 0,
      matchedPaise: g._sum.matchedPaise ?? 0,
    }))
    .sort((a, b) => b.matchedPaise - a.matchedPaise);

  let expectedWall = 0;
  let pledged = 0;
  // Collected = total cash in volunteers' hands; settled = sum of settlement (deposit) rows.
  const cashCollected = (cashCollectedAgg._sum.amountInCash ?? 0) * 100;
  let cashSettled = 0;
  let generalReceived = 0;
  let generalExpected = 0;
  let generalCount = 0;
  let wallCount = 0;
  for (const g of bySource) {
    const exp = g._sum.expectedPaise ?? 0;
    const mat = g._sum.matchedPaise ?? 0;
    if (
      g.sourceType === "wall_submission" &&
      (g.actionType === "donate" || g.actionType === "online_donate")
    ) {
      expectedWall += exp;
    }
    if (g.actionType === "pledge") pledged += exp;
    // cash_bucket rows are per-settlement deposits; their matched sum is total cash settled.
    if (g.sourceType === "cash_bucket") cashSettled += mat;
    if (g.sourceType === "birnagar_general") {
      generalReceived += mat;
      generalExpected += exp;
      generalCount += g._count._all;
    } else if (g.sourceType === "wall_submission") {
      // Wall-of-Legacy donor count = real named donors only; cash buckets (the
      // sourceType === "cash_bucket" branch above) are settlement rows, not donors.
      wallCount += g._count._all;
    }
  }

  const receivedGross = receivedFrom3 + cashSettled;
  const receivedNet = receivedGross - (gatewayCharges._sum.chargesPaise ?? 0);

  // Split the UNVERIFIED bucket: csv_not_uploaded rows (an upload would match them) by
  // channel/day for the suggested ranges; everything else is a manual-match problem.
  interface ChannelAccum {
    byDay: Map<string, { count: number; expectedPaise: number }>;
    count: number;
    expectedPaise: number;
    undatedCount: number;
  }
  const uploadAccum: Record<"online" | "upi", ChannelAccum> = {
    online: { byDay: new Map(), count: 0, expectedPaise: 0, undatedCount: 0 },
    upi: { byDay: new Map(), count: 0, expectedPaise: 0, undatedCount: 0 },
  };
  let unverifiedManualCount = 0;
  let unverifiedManualPaise = 0;
  for (const c of unverifiedRows) {
    const flags = Array.isArray(c.statusFlags) ? (c.statusFlags as string[]) : [];
    const channel = c.paymentChannel;
    if (flags.includes("csv_not_uploaded") && (channel === "online" || channel === "upi")) {
      const acc = uploadAccum[channel];
      acc.count += 1;
      acc.expectedPaise += c.expectedPaise;
      if (c.contributedAt) {
        const day = c.contributedAt.toISOString().slice(0, 10);
        const cell = acc.byDay.get(day) ?? { count: 0, expectedPaise: 0 };
        cell.count += 1;
        cell.expectedPaise += c.expectedPaise;
        acc.byDay.set(day, cell);
      } else {
        acc.undatedCount += 1;
      }
    } else {
      unverifiedManualCount += 1;
      unverifiedManualPaise += c.expectedPaise;
    }
  }
  // Daily donation activity for the time chart: count + received money per UTC day.
  const dayBuckets = new Map<string, { count: number; receivedPaise: number }>();
  for (const c of dayRows) {
    const day = c.contributedAt!.toISOString().slice(0, 10);
    const cell = dayBuckets.get(day) ?? { count: 0, receivedPaise: 0 };
    cell.count += 1;
    cell.receivedPaise += c.matchedPaise;
    dayBuckets.set(day, cell);
  }
  const donationsByDay: DonationsByDayRow[] = [...dayBuckets.entries()]
    .map(([day, cell]) => ({ day, count: cell.count, receivedPaise: cell.receivedPaise }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  const csvUploadsNeeded: CsvUploadNeed[] = (["online", "upi"] as const)
    .filter((channel) => uploadAccum[channel].count > 0)
    .map((channel) => {
      const acc = uploadAccum[channel];
      return {
        channel,
        kind: channel === "online" ? "gateway" : "upi",
        ranges: clusterDaysIntoRanges(acc.byDay),
        count: acc.count,
        expectedPaise: acc.expectedPaise,
        undatedCount: acc.undatedCount,
      };
    });

  return {
    statusCounts,
    statusBreakdown,
    channelBreakdown,
    totalContributions,
    gatewayChargesPaise: gatewayCharges._sum.chargesPaise ?? 0,
    receiptsReady: receiptCounts,
    expectedWallPaise: expectedWall,
    receivedGrossPaise: receivedGross,
    receivedNetPaise: receivedNet,
    pledgedPaise: pledged,
    surplusPaise: surplus,
    shortfallPaise: shortfall,
    unverifiedPaise: unverified,
    orphanPaise: orphanAgg._sum.amountPaise ?? 0,
    orphanCount: orphanAgg._count._all,
    cashCollectedPaise: cashCollected,
    cashSettledPaise: cashSettled,
    generalReceivedPaise: generalReceived,
    general: {
      count: generalCount,
      expectedPaise: generalExpected,
      receivedPaise: generalReceived,
    },
    wallOfLegacy: {
      count: wallCount,
      expectedPaise: expectedWall,
      receivedPaise: receivedGross - generalReceived,
      pledgedPaise: pledged,
      cashCollectedPaise: cashCollected,
      cashSettledPaise: cashSettled,
    },
    goalPaise: GOAL * 100,
    csvUploadsNeeded,
    unverifiedNeedsManual: { count: unverifiedManualCount, expectedPaise: unverifiedManualPaise },
    donationsByDay,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          startedAt: lastRun.startedAt.toISOString(),
          finishedAt: lastRun.finishedAt?.toISOString() ?? null,
          closureOk: lastRun.closureOk,
          triggeredBy: triggeredByUser?.username ?? null,
        }
      : null,
    lastBatches: batches.map((b) => ({
      kind: b.kind,
      createdAt: b.createdAt.toISOString(),
      rowsTotal: b.rowsTotal,
      periodStart: b.periodStart?.toISOString() ?? null,
      periodEnd: b.periodEnd?.toISOString() ?? null,
    })),
  };
}
