// Ad-hoc engine test (run: `node test-reconcile.ts` — Node 24 strips the types).
// Exercises the pure reconciliation engine against every edge case in the plan.
// Not part of any suite; mirrors the repo's existing root-level test-*.js scratch scripts.

import {
  reconcile,
  type ReconcileInput,
  type ContributionInput,
  type GatewayTxnInput,
  type UpiTxnInput,
  type ContributionStatus,
} from "./lib/reconciliation/engine.ts";

const P = 100_000; // paise for one name (₹1000)

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.error("  ✗ " + msg);
  }
}

function statusOf(res: ReturnType<typeof reconcile>, key: string): ContributionStatus | "MISSING" {
  return res.contributions.find((c) => c.key === key)?.status ?? "MISSING";
}
function lineOf(res: ReturnType<typeof reconcile>, key: string) {
  return res.contributions.find((c) => c.key === key);
}

// Builders to keep fixtures terse.
function sub(
  key: string,
  channel: "online" | "upi" | "cash",
  ref: string | null,
  names: number,
  actionType = channel === "online" ? "online_donate" : "donate",
  contributedAt: string | null = null,
): ContributionInput {
  return {
    key,
    sourceType: "wall_submission",
    channel,
    paymentReference: ref,
    expectedPaise: names * P,
    actionType,
    contributedAt,
  };
}
function gw(
  id: number,
  transactionId: string,
  rupees: number,
  opts: Partial<GatewayTxnInput> = {},
): GatewayTxnInput {
  return {
    id,
    transactionId,
    amountPaise: rupees * 100,
    isSuccess: opts.isSuccess ?? true,
    isRefund: opts.isRefund ?? false,
    chargesPaise: opts.chargesPaise ?? 0,
    originalTransactionId: opts.originalTransactionId ?? null,
    status: opts.status,
  };
}
function upi(
  id: number,
  rrn: string,
  rupees: number,
  opts: Partial<UpiTxnInput> = {},
): UpiTxnInput {
  return {
    id,
    bankRRN: rrn,
    amountPaise: rupees * 100,
    isSuccess: opts.isSuccess ?? true,
    isRefund: opts.isRefund ?? false,
    status: opts.status,
  };
}

const empty = { gateway: [], upi: [], windows: [], contributions: [] };

// ─────────────────────────────────────────────────────────────────────────────
// 1. Online ₹4000 as one submission of qty=4 (1 txn covers 4 names).
{
  const res = reconcile({
    ...empty,
    contributions: [sub("sub:1", "online", "GWT-4000", 4)],
    gateway: [gw(10, "GWT-4000", 4000)],
  });
  check(statusOf(res, "sub:1") === "MATCHED", "1: qty=4 online → MATCHED");
  check(lineOf(res, "sub:1")!.matchedPaise === 4 * P, "1: matched = ₹4000");
  check(res.totals.closureOk, "1: closure ok");
  check(res.totals.orphanPaise === 0, "1: no orphan");
}

// 2. Split: ONE UPI RRN shared by 4 separate donor rows of ₹1000 each.
{
  const res = reconcile({
    ...empty,
    contributions: [
      sub("sub:a", "upi", "RRN999", 1),
      sub("sub:b", "upi", "RRN999", 1),
      sub("sub:c", "upi", "RRN999", 1),
      sub("sub:d", "upi", "RRN999", 1),
    ],
    upi: [upi(20, "RRN999", 4000)],
  });
  for (const k of ["sub:a", "sub:b", "sub:c", "sub:d"]) {
    check(statusOf(res, k) === "MATCHED", `2: ${k} → MATCHED (group sum)`);
    check(lineOf(res, k)!.matchedPaise === P, `2: ${k} apportioned ₹1000`);
  }
  const apportioned = res.contributions
    .filter((c) => c.key.startsWith("sub:"))
    .reduce((s, c) => s + c.matchedPaise, 0);
  check(apportioned === 4 * P, "2: apportioned sum == ₹4000 (no paise lost)");
  // Exactly one match record for the single CSV txn, attributed to the primary.
  check(
    res.matches.filter((m) => m.upiTxnId === 20).length === 1,
    "2: single CSV txn → single match record",
  );
  check(res.totals.closureOk, "2: closure ok");
}

// 3. UPI overpayment: ₹1000 expected, ₹1008 paid → OVERPAID + surplus ₹8.
{
  const res = reconcile({
    ...empty,
    contributions: [sub("sub:o", "upi", "RRN-OP", 1)],
    upi: [upi(30, "RRN-OP", 1008)],
  });
  check(statusOf(res, "sub:o") === "OVERPAID", "3: 1008 → OVERPAID");
  check(res.totals.surplusPaise === 8 * 100, "3: surplus = ₹8");
  check(lineOf(res, "sub:o")!.variancePaise === 8 * 100, "3: variance +₹8");
}

// 4. Underpayment ₹900 → UNDERPAID + shortfall ₹100.
{
  const res = reconcile({
    ...empty,
    contributions: [sub("sub:u", "upi", "RRN-UP", 1)],
    upi: [upi(40, "RRN-UP", 900)],
  });
  check(statusOf(res, "sub:u") === "UNDERPAID", "4: 900 → UNDERPAID");
  check(res.totals.shortfallPaise === 100 * 100, "4: shortfall = ₹100");
}

// 5. Underpayment within tolerance (50 paise short) → MATCHED.
{
  const res = reconcile({
    ...empty,
    contributions: [{ ...sub("sub:t", "online", "GWT-TOL", 1) }],
    gateway: [{ ...gw(50, "GWT-TOL", 1000), amountPaise: P - 50 }],
  });
  check(statusOf(res, "sub:t") === "MATCHED", "5: 50 paise short → MATCHED (tolerance)");
  check(res.totals.shortfallPaise === 0, "5: no shortfall recorded");
}

// 6. Refund (gateway): original success + refund row pointing back → FAILED_REFUNDED.
{
  const res = reconcile({
    ...empty,
    contributions: [sub("sub:r", "online", "GWT-REF", 1)],
    gateway: [
      gw(60, "GWT-REF", 1000),
      gw(61, "GWT-REF-RV", 1000, { isRefund: true, originalTransactionId: "GWT-REF" }),
    ],
  });
  check(statusOf(res, "sub:r") === "FAILED_REFUNDED", "6: refunded → FAILED_REFUNDED");
  check(lineOf(res, "sub:r")!.matchedPaise === 0, "6: refunded matched = 0 (excluded)");
  check(res.totals.receivedGrossPaise === 0, "6: refund not counted as received");
  check(res.totals.orphanPaise === 0, "6: original+refund both consumed, no orphan");
  check(res.totals.closureOk, "6: closure ok");
}

// 7. Duplicate RRN: one RRN → two successful UPI rows → AMBIGUOUS.
{
  const res = reconcile({
    ...empty,
    contributions: [sub("sub:amb", "upi", "RRN-DUP", 1)],
    upi: [upi(70, "RRN-DUP", 1000), upi(71, "RRN-DUP", 1000)],
  });
  check(statusOf(res, "sub:amb") === "AMBIGUOUS", "7: duplicate RRN → AMBIGUOUS");
  // Unconsumed success rows surface as orphan money for the workbench.
  check(res.totals.orphanPaise === 2000 * 100, "7: both rows become orphan money");
  check(res.totals.closureOk, "7: closure ok");
}

// 8. Orphan: a successful CSV txn with no matching donor.
{
  const res = reconcile({
    ...empty,
    contributions: [],
    gateway: [gw(80, "GWT-ORPH", 1000)],
  });
  check(res.orphans.length === 1, "8: one orphan record");
  check(res.totals.orphanPaise === 1000 * 100, "8: orphan money = ₹1000");
  check(res.totals.closureOk, "8: closure ok (orphan partitions CSV money)");
}

// 9a. Unverified, no batch window uploaded → flag csv_not_uploaded.
{
  const res = reconcile({
    ...empty,
    contributions: [sub("sub:nv", "online", "GWT-NONE", 1, "online_donate", "2026-06-01T00:00:00Z")],
    windows: [],
  });
  check(statusOf(res, "sub:nv") === "UNVERIFIED", "9a: no CSV at all → UNVERIFIED");
  check(lineOf(res, "sub:nv")!.flags.includes("csv_not_uploaded"), "9a: flag csv_not_uploaded");
}
// 9b. Unverified, inside an uploaded window but ref absent → flag ref_not_in_csv.
{
  const res = reconcile({
    ...empty,
    contributions: [sub("sub:wr", "online", "GWT-WRONG", 1, "online_donate", "2026-06-02T10:00:00Z")],
    gateway: [gw(90, "GWT-OTHER", 1000)],
    windows: [{ kind: "gateway", periodStart: "2026-06-01T00:00:00Z", periodEnd: "2026-06-03T00:00:00Z" }],
  });
  check(statusOf(res, "sub:wr") === "UNVERIFIED", "9b: ref absent in uploaded window → UNVERIFIED");
  check(lineOf(res, "sub:wr")!.flags.includes("ref_not_in_csv"), "9b: flag ref_not_in_csv");
  // The unrelated gateway row is an orphan.
  check(res.totals.orphanPaise === 1000 * 100, "9b: the other gateway row is orphan");
}

// 10. Pledge → PLEDGE, excluded from received, counted as pledged.
{
  const res = reconcile({
    ...empty,
    contributions: [sub("sub:p", "cash", null, 2, "pledge")],
  });
  check(statusOf(res, "sub:p") === "PLEDGE", "10: pledge → PLEDGE");
  check(res.totals.pledgedPaise === 2 * P, "10: pledged = ₹2000");
  check(res.totals.receivedGrossPaise === 0, "10: pledge not received");
  check(lineOf(res, "sub:p")!.receiptEligible === false, "10: pledge not receipt-eligible");
}

// 11. Cash bucket: collected ₹5000, settled ₹3000 → CASH; cards split collected/settled.
{
  const res = reconcile({
    ...empty,
    contributions: [
      {
        key: "cash:7",
        sourceType: "cash_bucket",
        channel: "cash",
        paymentReference: null,
        expectedPaise: 5000 * 100,
        actionType: "cash_bucket",
        presetMatchedPaise: 3000 * 100,
      },
    ],
  });
  check(statusOf(res, "cash:7") === "CASH", "11: cash bucket → CASH");
  check(res.totals.cashCollectedPaise === 5000 * 100, "11: cash collected ₹5000");
  check(res.totals.cashSettledPaise === 3000 * 100, "11: cash settled ₹3000");
  check(res.totals.receivedGrossPaise === 3000 * 100, "11: received includes settled cash only");
}

// 12. Individual cash donation row → CASH, matched 0, excluded from received but in expected.
{
  const res = reconcile({
    ...empty,
    contributions: [sub("sub:cash", "cash", null, 1, "donate")],
  });
  check(statusOf(res, "sub:cash") === "CASH", "12: cash donate row → CASH");
  check(res.totals.receivedGrossPaise === 0, "12: cash row not double-counted into received");
  check(res.totals.expectedWallPaise === 1 * P, "12: cash row still counts toward wall expected");
}

// 13. Birnagar general (source='web') matches the gateway CSV → counts as general received.
{
  const res = reconcile({
    ...empty,
    contributions: [
      {
        key: "bir:45",
        sourceType: "birnagar_general",
        channel: "online",
        paymentReference: "GWT-GEN",
        expectedPaise: 2500 * 100,
        actionType: "general",
      },
    ],
    gateway: [gw(130, "GWT-GEN", 2500)],
  });
  check(statusOf(res, "bir:45") === "MATCHED", "13: birnagar general → MATCHED");
  check(res.totals.generalReceivedPaise === 2500 * 100, "13: general received ₹2500");
  check(res.totals.expectedWallPaise === 0, "13: general NOT counted in wall expected");
}

// 14. Pro-rata remainder: 3×₹1000 names, ₹3000.01 paid → OVERPAID, no paise lost.
{
  const res = reconcile({
    ...empty,
    contributions: [
      sub("p:1", "upi", "RRN-PR", 1),
      sub("p:2", "upi", "RRN-PR", 1),
      sub("p:3", "upi", "RRN-PR", 1),
    ],
    upi: [{ ...upi(140, "RRN-PR", 3000), amountPaise: 3 * P + 1 }],
  });
  const sum = ["p:1", "p:2", "p:3"].reduce((s, k) => s + lineOf(res, k)!.matchedPaise, 0);
  check(sum === 3 * P + 1, "14: apportioned sum exact (remainder kept)");
  check(["p:1", "p:2", "p:3"].every((k) => statusOf(res, k) === "OVERPAID"), "14: all OVERPAID");
  check(res.totals.surplusPaise === 1, "14: surplus = 1 paise");
}

// 15. Manual match: link an orphan UPI txn to a previously-UNVERIFIED contribution.
{
  const base: ReconcileInput = {
    ...empty,
    contributions: [sub("sub:m", "upi", "TYPO-REF", 1)],
    upi: [upi(150, "REAL-RRN", 1000)],
  };
  const before = reconcile(base);
  check(statusOf(before, "sub:m") === "UNVERIFIED", "15: pre-manual → UNVERIFIED");
  check(before.totals.orphanPaise === 1000 * 100, "15: pre-manual orphan ₹1000");

  const after = reconcile({
    ...base,
    manualMatches: [{ contributionKey: "sub:m", upiTxnId: 150, amountPaise: null, note: "verified by admin", createdById: 1 }],
  });
  check(statusOf(after, "sub:m") === "MATCHED", "15: post-manual → MATCHED");
  check(after.totals.orphanPaise === 0, "15: post-manual orphan cleared");
  check(after.matches.some((m) => m.matchType === "manual" && m.upiTxnId === 150), "15: manual match recorded");
}

// 16. Idempotency / determinism: same input twice → identical output.
{
  const input: ReconcileInput = {
    ...empty,
    contributions: [
      sub("d:1", "online", "GWT-D", 2),
      sub("d:2", "upi", "RRN-D", 1),
      sub("d:3", "cash", null, 1, "pledge"),
    ],
    gateway: [gw(160, "GWT-D", 2000)],
    upi: [upi(161, "RRN-D", 1000)],
  };
  const a = JSON.stringify(reconcile(input));
  const b = JSON.stringify(reconcile(input));
  check(a === b, "16: reconcile is deterministic (idempotent)");
}

// 17. Closure invariant under a big mixed batch (the strongest end-to-end guard).
{
  const res = reconcile({
    ...empty,
    contributions: [
      sub("m:1", "online", "T1", 4), // matched ₹4000
      sub("m:2", "upi", "R1", 1), // overpaid
      sub("m:3", "upi", "R1", 1), // (shares R1 with m:2)
      sub("m:4", "online", "T-MISSING", 1), // unverified
      sub("m:5", "cash", null, 1, "pledge"), // pledge
    ],
    gateway: [
      gw(200, "T1", 4000),
      gw(201, "T-ORPHAN", 1500), // orphan
    ],
    upi: [upi(202, "R1", 2050)], // overpay the R1 group by ₹50
    windows: [{ kind: "gateway", periodStart: null, periodEnd: null }],
  });
  check(res.totals.closureOk, "17: closure ok on mixed batch");
  // CSV success = 4000 + 1500 + 2050 = 7550. Consumed = 4000 (T1) + 2050 (R1) = 6050. Orphan = 1500.
  check(res.totals.csvSuccessPaise === 7550 * 100, "17: csvSuccess = ₹7550");
  check(res.totals.orphanPaise === 1500 * 100, "17: orphan = ₹1500");
  check(res.totals.receivedGrossPaise === (4000 + 2050) * 100, "17: received = ₹6050");
  check(res.totals.closureDeltaPaise === 0, "17: closure delta 0");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log("✓ all reconciliation engine assertions passed");
