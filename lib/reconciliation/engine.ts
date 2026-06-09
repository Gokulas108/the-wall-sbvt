// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation engine — PURE, zero imports.
//
// This file deliberately has no dependencies (not even on @/lib/mosaic/engine):
// it operates entirely on integer *paise* that the caller supplies. That keeps it
// (a) runnable directly under Node's type-stripping for `test-reconcile.ts`, and
// (b) trivially unit-testable with plain fixtures. The orchestrator (run.ts) is the
// only place that touches Prisma and imports COST_PER_NAME to compute expectedPaise.
//
// Money rule: everything here is integer paise. Never floats. See
// docs/reconciliation-plan.md for the full design and edge-case catalogue.
// ─────────────────────────────────────────────────────────────────────────────

export type ContributionStatus =
  | "MATCHED"
  | "OVERPAID"
  | "UNDERPAID"
  | "UNVERIFIED"
  | "CASH"
  | "SETTLEMENT"
  | "PLEDGE"
  | "FAILED_REFUNDED"
  | "ORPHAN"
  | "AMBIGUOUS";

export const ALL_STATUSES: ContributionStatus[] = [
  "MATCHED",
  "OVERPAID",
  "UNDERPAID",
  "UNVERIFIED",
  "CASH",
  "SETTLEMENT",
  "PLEDGE",
  "FAILED_REFUNDED",
  "ORPHAN",
  "AMBIGUOUS",
];

export type PaymentChannel = "online" | "upi" | "cash" | "none";

export type SourceType = "wall_submission" | "birnagar_general" | "cash_bucket";

export const RECONCILE_CONFIG = {
  // Any positive surplus ⇒ OVERPAID (still a valid, receiptable contribution).
  // A shortfall within this tolerance rounds up to MATCHED (covers paise rounding
  // and the donor who pays ₹999.50). Applied per reference-GROUP on summed amounts,
  // never per row.
  UNDERPAY_TOLERANCE_PAISE: 100,
};

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface ContributionInput {
  /** Stable, unique key for this ledger line, e.g. "sub:12", "bir:45", "cash:7". */
  key: string;
  sourceType: SourceType;
  channel: PaymentChannel;
  /** Caller may pass raw; the engine trims/normalizes before comparing. */
  paymentReference: string | null;
  expectedPaise: number;
  /** donate | online_donate | pledge | cash_bucket | general */
  actionType: string | null;
  /** Cash buckets carry the already-settled amount here (terminal CASH line). */
  presetMatchedPaise?: number;
  /** ISO string; used only for the CSV-window (UNVERIFIED vs not-yet-uploaded) check. */
  contributedAt?: string | null;
}

export interface GatewayTxnInput {
  id: number;
  transactionId: string;
  amountPaise: number; // gross "Transaction Amount"
  chargesPaise?: number;
  netAmountPaise?: number;
  isSuccess: boolean;
  isRefund: boolean;
  /** For refund rows: points back at the original Transaction ID. */
  originalTransactionId?: string | null;
  status?: string;
}

export interface UpiTxnInput {
  id: number;
  bankRRN: string;
  amountPaise: number;
  isSuccess: boolean;
  isRefund: boolean;
  status?: string;
}

export interface BatchWindowInput {
  kind: "gateway" | "upi";
  periodStart?: string | null; // ISO
  periodEnd?: string | null; // ISO
}

export interface ManualMatchInput {
  /** Which contribution this manual link belongs to. null ⇒ a kept manual orphan note. */
  contributionKey: string | null;
  gatewayTxnId?: number | null;
  upiTxnId?: number | null;
  /** Override amount (paise); falls back to the CSV row's amount. */
  amountPaise?: number | null;
  note?: string | null;
  createdById?: number | null;
}

export interface ReconcileInput {
  contributions: ContributionInput[];
  gateway: GatewayTxnInput[];
  upi: UpiTxnInput[];
  windows: BatchWindowInput[];
  manualMatches?: ManualMatchInput[];
}

// ── Outputs ──────────────────────────────────────────────────────────────────

export interface ContributionResult {
  key: string;
  status: ContributionStatus;
  expectedPaise: number;
  matchedPaise: number;
  variancePaise: number;
  receiptEligible: boolean;
  flags: string[];
  /** CSV txns attributed to this line (only the group's primary carries them). */
  matchedGatewayTxnIds: number[];
  matchedUpiTxnIds: number[];
}

export interface MatchRecord {
  contributionKey: string | null; // null ⇒ ORPHAN (money with no donor)
  gatewayTxnId: number | null;
  upiTxnId: number | null;
  matchType: "auto_reference" | "manual";
  amountPaise: number;
  note: string | null;
  confidence: number | null;
  createdById: number | null;
}

export interface ReconcileTotals {
  countsByStatus: Record<ContributionStatus, number>;
  expectedWallPaise: number; // wall donate + online_donate (excl. pledge & cash bucket)
  pledgedPaise: number;
  receivedGrossPaise: number; // matched of MATCHED/OVERPAID/UNDERPAID + cash settled
  receivedNetPaise: number; // gross − gateway charges on consumed gateway txns
  generalReceivedPaise: number; // birnagar source='web' matched
  cashSettledPaise: number;
  cashCollectedPaise: number;
  surplusPaise: number; // Σ positive variance (online/upi)
  shortfallPaise: number; // Σ negative variance, abs (online/upi)
  unverifiedPaise: number; // expected of UNVERIFIED + AMBIGUOUS
  orphanPaise: number; // Σ orphan CSV amount (refunds subtract)
  csvSuccessPaise: number; // Σ gross success non-refund CSV
  closureOk: boolean;
  closureDeltaPaise: number;
}

export interface ReconcileResult {
  contributions: ContributionResult[];
  matches: MatchRecord[]; // includes orphans (contributionKey === null)
  orphans: MatchRecord[];
  totals: ReconcileTotals;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function norm(s: string | null | undefined): string {
  return (s ?? "").trim();
}

function classifyByVariance(
  matched: number,
  expected: number,
  tolerance: number,
): ContributionStatus {
  const v = matched - expected;
  if (v === 0) return "MATCHED";
  if (v > 0) return "OVERPAID";
  if (-v <= tolerance) return "MATCHED";
  return "UNDERPAID";
}

/** Apportion `total` across weights pro-rata; remainder to the largest weight.
 *  Guarantees Σ shares === total exactly (integer paise, no drift). */
function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) {
    // No basis to split on — give it all to the first row.
    return weights.map((_, i) => (i === 0 ? total : 0));
  }
  const shares = weights.map((w) => Math.floor((total * w) / sum));
  let remainder = total - shares.reduce((s, x) => s + x, 0);
  // Hand the leftover paise to the largest-weight rows, descending.
  const order = weights
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w - a.w || a.i - b.i);
  let k = 0;
  while (remainder > 0 && order.length > 0) {
    shares[order[k % order.length].i] += 1;
    remainder -= 1;
    k += 1;
  }
  return shares;
}

// ── Core ─────────────────────────────────────────────────────────────────────

export function reconcile(input: ReconcileInput): ReconcileResult {
  const tol = RECONCILE_CONFIG.UNDERPAY_TOLERANCE_PAISE;

  // Index the contribution side.
  const contribByKey = new Map<string, ContributionInput>();
  for (const c of input.contributions) contribByKey.set(c.key, c);

  // Index the CSV side.
  const gatewayById = new Map<number, GatewayTxnInput>();
  const gatewayByTxn = new Map<string, GatewayTxnInput>(); // transactionId is unique
  const refundsByOriginal = new Map<string, GatewayTxnInput[]>();
  for (const g of input.gateway) {
    gatewayById.set(g.id, g);
    if (g.isRefund && g.originalTransactionId) {
      const k = norm(g.originalTransactionId);
      const arr = refundsByOriginal.get(k) ?? [];
      arr.push(g);
      refundsByOriginal.set(k, arr);
    } else {
      const txn = norm(g.transactionId);
      if (txn) gatewayByTxn.set(txn, g);
    }
  }

  const upiById = new Map<number, UpiTxnInput>();
  const upiByRRN = new Map<string, UpiTxnInput[]>(); // RRN is NOT unique
  for (const u of input.upi) {
    upiById.set(u.id, u);
    const k = norm(u.bankRRN);
    if (!k) continue;
    const arr = upiByRRN.get(k) ?? [];
    arr.push(u);
    upiByRRN.set(k, arr);
  }

  const consumedGateway = new Set<number>();
  const consumedUpi = new Set<number>();
  const matches: MatchRecord[] = [];
  const resultByKey = new Map<string, ContributionResult>();

  const makeResult = (
    c: ContributionInput,
    status: ContributionStatus,
    matched: number,
    gwIds: number[],
    upiIds: number[],
    flags: string[],
  ): ContributionResult => {
    const moneyCompared =
      status === "MATCHED" ||
      status === "OVERPAID" ||
      status === "UNDERPAID" ||
      c.sourceType === "cash_bucket";
    return {
      key: c.key,
      status,
      expectedPaise: c.expectedPaise,
      matchedPaise: matched,
      variancePaise: moneyCompared ? matched - c.expectedPaise : 0,
      receiptEligible:
        (status === "MATCHED" || status === "OVERPAID") &&
        c.actionType !== "pledge",
      flags,
      matchedGatewayTxnIds: gwIds,
      matchedUpiTxnIds: upiIds,
    };
  };

  // ── 1. Manual matches first: resolve those contributions standalone, and
  //       remove their CSV txns from the auto pool. Manual links are authoritative.
  const manualKeys = new Set<string>();
  for (const m of input.manualMatches ?? []) {
    if (m.gatewayTxnId != null) consumedGateway.add(m.gatewayTxnId);
    if (m.upiTxnId != null) consumedUpi.add(m.upiTxnId);
    if (m.contributionKey) manualKeys.add(m.contributionKey);
  }
  for (const key of manualKeys) {
    const c = contribByKey.get(key);
    if (!c) continue; // manual link to a vanished contribution — ignore quietly
    const links = (input.manualMatches ?? []).filter(
      (m) => m.contributionKey === key,
    );
    let matchedSum = 0;
    const gwIds: number[] = [];
    const upiIds: number[] = [];
    for (const m of links) {
      if (m.gatewayTxnId != null) {
        const g = gatewayById.get(m.gatewayTxnId);
        const amt = m.amountPaise ?? g?.amountPaise ?? 0;
        matchedSum += amt;
        gwIds.push(m.gatewayTxnId);
        matches.push({
          contributionKey: key,
          gatewayTxnId: m.gatewayTxnId,
          upiTxnId: null,
          matchType: "manual",
          amountPaise: amt,
          note: m.note ?? null,
          confidence: null,
          createdById: m.createdById ?? null,
        });
      }
      if (m.upiTxnId != null) {
        const u = upiById.get(m.upiTxnId);
        const amt = m.amountPaise ?? u?.amountPaise ?? 0;
        matchedSum += amt;
        upiIds.push(m.upiTxnId);
        matches.push({
          contributionKey: key,
          gatewayTxnId: null,
          upiTxnId: m.upiTxnId,
          matchType: "manual",
          amountPaise: amt,
          note: m.note ?? null,
          confidence: null,
          createdById: m.createdById ?? null,
        });
      }
    }
    const status = classifyByVariance(matchedSum, c.expectedPaise, tol);
    resultByKey.set(key, makeResult(c, status, matchedSum, gwIds, upiIds, ["manual"]));
  }

  // ── 2. Partition remaining contributions: terminal/standalone vs reference groups.
  interface Group {
    channel: PaymentChannel;
    ref: string;
    members: ContributionInput[];
  }
  const groups = new Map<string, Group>();
  const standalone: ContributionInput[] = [];

  for (const c of input.contributions) {
    if (manualKeys.has(c.key)) continue;
    if (c.sourceType === "cash_bucket") {
      standalone.push(c);
      continue;
    }
    if (c.actionType === "pledge") {
      standalone.push(c);
      continue;
    }
    if (c.channel === "cash") {
      standalone.push(c);
      continue;
    }
    const ref = norm(c.paymentReference);
    if (!ref) {
      standalone.push(c);
      continue;
    }
    const gk = c.channel + " " + ref;
    const g = groups.get(gk) ?? { channel: c.channel, ref, members: [] };
    g.members.push(c);
    groups.set(gk, g);
  }

  // Terminal lines.
  for (const c of standalone) {
    if (c.sourceType === "cash_bucket") {
      // Per-volunteer cash bucket — its own SETTLEMENT status so it stands out in the
      // ledger (collected = expected, settled = matched). Not a donor line.
      resultByKey.set(c.key, makeResult(c, "SETTLEMENT", c.presetMatchedPaise ?? 0, [], [], []));
    } else if (c.actionType === "pledge") {
      resultByKey.set(c.key, makeResult(c, "PLEDGE", 0, [], [], []));
    } else if (c.channel === "cash") {
      // Individual cash donation: shown in the ledger, but its money is represented
      // by the volunteer's cash bucket + settlements (excluded from received sums).
      resultByKey.set(c.key, makeResult(c, "CASH", 0, [], [], ["cash_in_bucket"]));
    } else {
      resultByKey.set(c.key, makeResult(c, "UNVERIFIED", 0, [], [], ["missing_reference"]));
    }
  }

  // CSV-window check: is a payment of this channel/date covered by an uploaded batch?
  const withinWindow = (channel: PaymentChannel, atISO: string | null): boolean => {
    const kind = channel === "online" ? "gateway" : "upi";
    const wins = input.windows.filter((w) => w.kind === kind);
    if (wins.length === 0) return false;
    if (!atISO) return wins.some((w) => !w.periodStart && !w.periodEnd);
    const t = Date.parse(atISO);
    return wins.some((w) => {
      const s = w.periodStart ? Date.parse(w.periodStart) : -Infinity;
      const e = w.periodEnd ? Date.parse(w.periodEnd) : Infinity;
      return t >= s && t <= e;
    });
  };

  const primaryOf = (g: Group): ContributionInput =>
    [...g.members].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))[0];

  // Same status across all members; pro-rata matched only when there is money.
  const assignGroup = (
    g: Group,
    status: ContributionStatus,
    matchedSum: number,
    gwIds: number[],
    upiIds: number[],
    flags: string[],
  ) => {
    const primary = primaryOf(g);
    const weights = g.members.map((m) => m.expectedPaise);
    const shares =
      matchedSum > 0 ? apportion(matchedSum, weights) : g.members.map(() => 0);
    g.members.forEach((m, i) => {
      const isPrimary = m.key === primary.key;
      resultByKey.set(
        m.key,
        makeResult(
          m,
          status,
          shares[i],
          isPrimary ? gwIds : [],
          isPrimary ? upiIds : [],
          flags,
        ),
      );
    });
    // One ContributionMatch per CSV txn, attributed to the group's primary line.
    for (const id of gwIds) {
      matches.push({
        contributionKey: primary.key,
        gatewayTxnId: id,
        upiTxnId: null,
        matchType: "auto_reference",
        amountPaise: gatewayById.get(id)?.amountPaise ?? 0,
        note: null,
        confidence: null,
        createdById: null,
      });
    }
    for (const id of upiIds) {
      matches.push({
        contributionKey: primary.key,
        gatewayTxnId: null,
        upiTxnId: id,
        matchType: "auto_reference",
        amountPaise: upiById.get(id)?.amountPaise ?? 0,
        note: null,
        confidence: null,
        createdById: null,
      });
    }
  };

  // ── 3. Match each reference group by (channel, reference).
  for (const g of groups.values()) {
    const expectedSum = g.members.reduce((s, m) => s + m.expectedPaise, 0);
    const repDate =
      g.members
        .map((m) => m.contributedAt ?? null)
        .filter((d): d is string => !!d)
        .sort()[0] ?? null;

    if (g.channel === "online") {
      const gtx = gatewayByTxn.get(g.ref);
      const refunds = refundsByOriginal.get(g.ref) ?? [];
      if (!gtx) {
        const inWin = withinWindow("online", repDate);
        assignGroup(g, "UNVERIFIED", 0, [], [], [inWin ? "ref_not_in_csv" : "csv_not_uploaded"]);
        continue;
      }
      if (!gtx.isSuccess || refunds.length > 0) {
        consumedGateway.add(gtx.id);
        const gwIds = [gtx.id];
        for (const r of refunds) {
          consumedGateway.add(r.id);
          gwIds.push(r.id);
        }
        assignGroup(g, "FAILED_REFUNDED", 0, gwIds, [], refunds.length ? ["refunded"] : ["failed"]);
        continue;
      }
      consumedGateway.add(gtx.id);
      const status = classifyByVariance(gtx.amountPaise, expectedSum, tol);
      assignGroup(g, status, gtx.amountPaise, [gtx.id], [], []);
    } else if (g.channel === "upi") {
      const rows = upiByRRN.get(g.ref) ?? [];
      if (rows.length === 0) {
        const inWin = withinWindow("upi", repDate);
        assignGroup(g, "UNVERIFIED", 0, [], [], [inWin ? "ref_not_in_csv" : "csv_not_uploaded"]);
        continue;
      }
      const refundRows = rows.filter((r) => r.isRefund);
      const successRows = rows.filter((r) => r.isSuccess && !r.isRefund);
      const failedRows = rows.filter((r) => !r.isSuccess && !r.isRefund);
      if (refundRows.length > 0) {
        const ids = rows.map((r) => r.id);
        ids.forEach((id) => consumedUpi.add(id));
        assignGroup(g, "FAILED_REFUNDED", 0, [], ids, ["refunded"]);
        continue;
      }
      if (successRows.length === 0) {
        const ids = failedRows.map((r) => r.id);
        ids.forEach((id) => consumedUpi.add(id));
        assignGroup(g, "FAILED_REFUNDED", 0, [], ids, ["failed"]);
        continue;
      }
      if (successRows.length > 1) {
        // One RRN → several successful rows: can't safely auto-attribute. Leave the
        // CSV rows UNconsumed so they surface as orphans in the workbench too.
        assignGroup(g, "AMBIGUOUS", 0, [], [], ["multiple_upi_rows"]);
        continue;
      }
      const u = successRows[0];
      consumedUpi.add(u.id);
      const status = classifyByVariance(u.amountPaise, expectedSum, tol);
      assignGroup(g, status, u.amountPaise, [], [u.id], []);
    } else {
      // channel "none"/"cash" never reaches grouping (filtered to standalone).
      assignGroup(g, "UNVERIFIED", 0, [], [], ["missing_reference"]);
    }
  }

  // ── 4. Orphan detection: any success, non-refund CSV txn not consumed = money
  //       with no donor. Unmatched refunds surface as negative orphans.
  for (const g of input.gateway) {
    if (g.isRefund) {
      if (!consumedGateway.has(g.id)) {
        matches.push({
          contributionKey: null,
          gatewayTxnId: g.id,
          upiTxnId: null,
          matchType: "auto_reference",
          amountPaise: -g.amountPaise,
          note: "unmatched_refund",
          confidence: null,
          createdById: null,
        });
      }
      continue;
    }
    if (g.isSuccess && !consumedGateway.has(g.id)) {
      matches.push({
        contributionKey: null,
        gatewayTxnId: g.id,
        upiTxnId: null,
        matchType: "auto_reference",
        amountPaise: g.amountPaise,
        note: null,
        confidence: null,
        createdById: null,
      });
    }
  }
  for (const u of input.upi) {
    if (u.isRefund) {
      if (!consumedUpi.has(u.id)) {
        matches.push({
          contributionKey: null,
          gatewayTxnId: null,
          upiTxnId: u.id,
          matchType: "auto_reference",
          amountPaise: -u.amountPaise,
          note: "unmatched_refund",
          confidence: null,
          createdById: null,
        });
      }
      continue;
    }
    if (u.isSuccess && !consumedUpi.has(u.id)) {
      matches.push({
        contributionKey: null,
        gatewayTxnId: null,
        upiTxnId: u.id,
        matchType: "auto_reference",
        amountPaise: u.amountPaise,
        note: null,
        confidence: null,
        createdById: null,
      });
    }
  }

  // ── 5. Totals + closure invariant.
  const results = [...resultByKey.values()];
  const countsByStatus = Object.fromEntries(
    ALL_STATUSES.map((s) => [s, 0]),
  ) as Record<ContributionStatus, number>;

  let expectedWallPaise = 0;
  let pledgedPaise = 0;
  let receivedGrossPaise = 0;
  let generalReceivedPaise = 0;
  let cashSettledPaise = 0;
  let cashCollectedPaise = 0;
  let surplusPaise = 0;
  let shortfallPaise = 0;
  let unverifiedPaise = 0;

  for (const r of results) {
    countsByStatus[r.status] += 1;
    const c = contribByKey.get(r.key)!;
    if (
      c.sourceType === "wall_submission" &&
      (c.actionType === "donate" || c.actionType === "online_donate")
    ) {
      expectedWallPaise += r.expectedPaise;
    }
    if (c.actionType === "pledge") pledgedPaise += r.expectedPaise;
    if (c.sourceType === "cash_bucket") {
      cashSettledPaise += r.matchedPaise;
      cashCollectedPaise += r.expectedPaise;
    }
    if (r.status === "MATCHED" || r.status === "OVERPAID" || r.status === "UNDERPAID") {
      receivedGrossPaise += r.matchedPaise;
      if (c.sourceType === "birnagar_general") generalReceivedPaise += r.matchedPaise;
      // Surplus/shortfall come only from genuinely over/under-paid lines — a
      // tolerance-rounded MATCHED line's tiny variance is noise, not a shortfall.
      if (r.status === "OVERPAID" && r.variancePaise > 0) surplusPaise += r.variancePaise;
      if (r.status === "UNDERPAID" && r.variancePaise < 0) shortfallPaise += -r.variancePaise;
    }
    if (r.status === "UNVERIFIED" || r.status === "AMBIGUOUS") {
      unverifiedPaise += r.expectedPaise;
    }
  }
  receivedGrossPaise += cashSettledPaise;

  // Net = gross − gateway charges on consumed gateway txns (UPI carries no charge col).
  let chargesPaise = 0;
  for (const id of consumedGateway) {
    const g = gatewayById.get(id);
    if (g && g.isSuccess && !g.isRefund) chargesPaise += g.chargesPaise ?? 0;
  }
  const receivedNetPaise = receivedGrossPaise - chargesPaise;

  let orphanPaise = 0;
  for (const m of matches) if (m.contributionKey === null) orphanPaise += m.amountPaise;

  // Closure: every success non-refund CSV rupee is either consumed by a group or an
  // orphan — a strict partition. A non-zero delta means the engine dropped or
  // double-counted a transaction (a logic bug), so we assert it.
  let csvSuccessPaise = 0;
  let consumedSuccessPaise = 0;
  let orphanSuccessPaise = 0;
  for (const g of input.gateway) {
    if (!g.isSuccess || g.isRefund) continue;
    csvSuccessPaise += g.amountPaise;
    if (consumedGateway.has(g.id)) consumedSuccessPaise += g.amountPaise;
    else orphanSuccessPaise += g.amountPaise;
  }
  for (const u of input.upi) {
    if (!u.isSuccess || u.isRefund) continue;
    csvSuccessPaise += u.amountPaise;
    if (consumedUpi.has(u.id)) consumedSuccessPaise += u.amountPaise;
    else orphanSuccessPaise += u.amountPaise;
  }
  const closureDeltaPaise =
    csvSuccessPaise - (consumedSuccessPaise + orphanSuccessPaise);

  const totals: ReconcileTotals = {
    countsByStatus,
    expectedWallPaise,
    pledgedPaise,
    receivedGrossPaise,
    receivedNetPaise,
    generalReceivedPaise,
    cashSettledPaise,
    cashCollectedPaise,
    surplusPaise,
    shortfallPaise,
    unverifiedPaise,
    orphanPaise,
    csvSuccessPaise,
    closureOk: closureDeltaPaise === 0,
    closureDeltaPaise,
  };

  const orphans = matches.filter((m) => m.contributionKey === null);
  return { contributions: results, matches, orphans, totals };
}
