// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation orchestrator (impure).
//
// The ONLY place that touches Prisma and the COST_PER_NAME amount authority.
// It loads every source, maps it onto the pure engine's inputs (in paise),
// runs reconcile(), then persists the materialized ledger + match table inside a
// single transaction — preserving manual matches and the Contribution ids they
// reference (which is why the soft keys are @unique and we upsert, never delete+recreate).
// ─────────────────────────────────────────────────────────────────────────────

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { COST_PER_NAME } from "@/lib/mosaic/engine";
import {
  reconcile,
  type ContributionInput,
  type ManualMatchInput,
  type PaymentChannel,
  type ReconcileResult,
} from "@/lib/reconciliation/engine";

const EXPECTED_PAISE_PER_NAME = COST_PER_NAME * 100;

type Tx = Prisma.TransactionClient;

function keyForSoftRow(row: {
  blockSubmissionId: number | null;
  birnagarDonationId: number | null;
  cashVolunteerId: number | null;
}): string | null {
  if (row.blockSubmissionId != null) return `sub:${row.blockSubmissionId}`;
  if (row.birnagarDonationId != null) return `bir:${row.birnagarDonationId}`;
  if (row.cashVolunteerId != null) return `cash:${row.cashVolunteerId}`;
  return null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function channelForSubmission(actionType: string, paymentMethod: string | null): PaymentChannel {
  if (actionType === "pledge") return "none";
  if (actionType === "online_donate") return "online";
  const pm = (paymentMethod ?? "cash").toLowerCase();
  if (pm === "upi") return "upi";
  if (pm === "online") return "online";
  return "cash";
}

interface Prepared {
  input: ContributionInput;
  persist: {
    sourceType: string;
    blockSubmissionId: number | null;
    birnagarDonationId: number | null;
    cashVolunteerId: number | null;
    donorName: string | null;
    donorPhone: string | null;
    donorEmail: string | null;
    blockId: string | null;
    serialNumber: string | null;
    qty: number;
    actionType: string | null;
    collectedByUserId: number | null;
    contributedAt: Date | null;
    paymentChannel: PaymentChannel;
    paymentReference: string | null;
  };
}

export interface ReconcileRunSummary {
  runId: number;
  countsByStatus: Record<string, number>;
  totalExpectedPaise: number;
  totalMatchedPaise: number;
  totalOrphanPaise: number;
  closureOk: boolean;
  closureDeltaPaise: number;
  contributionCount: number;
  matchCount: number;
  orphanCount: number;
}

export async function runReconciliation(opts: {
  triggeredById?: number | null;
} = {}): Promise<ReconcileRunSummary> {
  // ── Load the contribution side ────────────────────────────────────────────
  const [submissions, birnagarWeb, settlements, gatewayRows, upiRows, batches] =
    await Promise.all([
      prisma.blockSubmission.findMany(),
      prisma.birnagarDonation.findMany({ where: { source: "web", status: "success" } }),
      // Each cash settlement (deposit) becomes its own SETTLEMENT ledger row, dated by its
      // own created_at and labelled with the volunteer who settled.
      prisma.cashSettlement.findMany({
        select: {
          id: true,
          volunteerId: true,
          amount: true,
          createdAt: true,
          volunteer: { select: { username: true } },
        },
      }),
      prisma.gatewayTransaction.findMany(),
      prisma.upiTransaction.findMany(),
      prisma.csvUploadBatch.findMany({
        where: { kind: { in: ["gateway", "upi"] } },
        select: { kind: true, periodStart: true, periodEnd: true },
      }),
    ]);

  const prepared: Prepared[] = [];

  // Wall submissions → contributions.
  // Collect EVERY wall submission's payment reference (any channel/actionType). A
  // birnagar 'web' row that shares one of these is the SAME gateway payment mirrored
  // into both databases, so it must not become a second contribution. We key the
  // de-dup on the reference itself — never on actionType — because some legacy rows
  // carry junk like a trailing newline ("online_donate\n").
  const wallRefs = new Set<string>();
  for (const s of submissions) {
    const ref = s.paymentReference?.trim();
    if (ref) wallRefs.add(ref);
  }

  for (const s of submissions) {
    const actionType = (s.actionType ?? "").trim();
    const channel = channelForSubmission(actionType, s.paymentMethod);
    const ref = s.paymentReference?.trim() || null;
    prepared.push({
      input: {
        key: `sub:${s.id}`,
        sourceType: "wall_submission",
        channel,
        paymentReference: ref,
        expectedPaise: s.qty * EXPECTED_PAISE_PER_NAME,
        actionType,
        contributedAt: s.createdAt.toISOString(),
      },
      persist: {
        sourceType: "wall_submission",
        blockSubmissionId: s.id,
        birnagarDonationId: null,
        cashVolunteerId: null,
        donorName: s.name,
        donorPhone: s.phone,
        donorEmail: s.email,
        blockId: s.blockId,
        serialNumber: s.serialNumber,
        qty: s.qty,
        actionType,
        collectedByUserId: s.collectedByUserId,
        contributedAt: s.createdAt,
        paymentChannel: channel,
        paymentReference: ref,
      },
    });
  }

  // Birnagar general donations (source='web', success) → general contributions.
  for (const b of birnagarWeb) {
    const ref = b.txnId?.trim() || null;
    if (ref && wallRefs.has(ref)) continue; // same payment already on the wall
    prepared.push({
      input: {
        key: `bir:${b.birnagarId}`,
        sourceType: "birnagar_general",
        channel: "online",
        paymentReference: ref,
        expectedPaise: b.amountPaise,
        actionType: "general",
        contributedAt: (b.donatedAt ?? b.createdAt).toISOString(),
      },
      persist: {
        sourceType: "birnagar_general",
        blockSubmissionId: null,
        birnagarDonationId: b.birnagarId,
        cashVolunteerId: null,
        donorName: b.name,
        donorPhone: b.phone,
        donorEmail: b.email,
        blockId: null,
        serialNumber: null,
        qty: 0,
        actionType: "general",
        collectedByUserId: null,
        contributedAt: b.donatedAt ?? b.createdAt,
        paymentChannel: "online",
        paymentReference: ref,
      },
    });
  }

  // One ledger row per cash settlement (deposit) — an itemised SETTLEMENT line dated by the
  // settlement's own created_at. Expected == matched, since a deposit fully accounts for
  // itself; the per-volunteer collected-vs-settled gap is reported via the cash totals.
  for (const st of settlements) {
    const amountPaise = st.amount * 100;
    prepared.push({
      input: {
        key: `settle:${st.id}`,
        sourceType: "cash_bucket",
        channel: "cash",
        paymentReference: null,
        expectedPaise: amountPaise,
        actionType: "cash_bucket",
        presetMatchedPaise: amountPaise,
      },
      persist: {
        sourceType: "cash_bucket",
        blockSubmissionId: null,
        birnagarDonationId: null,
        // cashVolunteerId carries a @unique constraint (one bucket per volunteer in the old
        // model). With one row per settlement, the volunteer link lives on collectedByUserId
        // instead; leaving this null keeps multiple settlement rows per volunteer legal.
        cashVolunteerId: null,
        donorName: st.volunteer?.username ?? null,
        donorPhone: null,
        donorEmail: null,
        blockId: null,
        serialNumber: null,
        qty: 0,
        actionType: "cash_bucket",
        collectedByUserId: st.volunteerId,
        contributedAt: st.createdAt,
        paymentChannel: "cash",
        paymentReference: null,
      },
    });
  }

  // ── Existing contributions + manual matches (to preserve them) ────────────
  const existingContribs = await prisma.contribution.findMany({
    select: {
      id: true,
      blockSubmissionId: true,
      birnagarDonationId: true,
      cashVolunteerId: true,
    },
  });
  const keyByContribId = new Map<number, string>();
  for (const c of existingContribs) {
    const k = keyForSoftRow(c);
    if (k) keyByContribId.set(c.id, k);
  }

  const manualRows = await prisma.contributionMatch.findMany({
    where: { matchType: "manual" },
  });
  const manualMatches: ManualMatchInput[] = manualRows.map((m) => ({
    contributionKey: m.contributionId != null ? keyByContribId.get(m.contributionId) ?? null : null,
    gatewayTxnId: m.gatewayTxnId,
    upiTxnId: m.upiTxnId,
    amountPaise: m.amountPaise,
    note: m.note,
    createdById: m.createdById,
  }));

  // ── Run the pure engine ───────────────────────────────────────────────────
  const result: ReconcileResult = reconcile({
    contributions: prepared.map((p) => p.input),
    gateway: gatewayRows.map((g) => ({
      id: g.id,
      transactionId: g.transactionId,
      amountPaise: g.amountPaise,
      chargesPaise: g.chargesPaise,
      netAmountPaise: g.netAmountPaise,
      isSuccess: g.isSuccess,
      isRefund: g.isRefund,
      originalTransactionId: g.originalTransactionId,
      status: g.status,
    })),
    upi: upiRows.map((u) => ({
      id: u.id,
      bankRRN: u.bankRRN,
      amountPaise: u.amountPaise,
      isSuccess: u.isSuccess,
      isRefund: u.isRefund,
      status: u.status,
    })),
    windows: batches.map((b) => ({
      kind: b.kind as "gateway" | "upi",
      periodStart: b.periodStart?.toISOString() ?? null,
      periodEnd: b.periodEnd?.toISOString() ?? null,
    })),
    manualMatches,
  });

  const resultByKey = new Map(result.contributions.map((r) => [r.key, r]));

  // Manual matches must survive the rebuild. delete+recreate changes contribution
  // ids, so capture each manual match's id and the contribution KEY it points at;
  // after re-inserting we re-point them to the new ids by key.
  const manualRepoint = manualRows
    .filter((m) => m.contributionId != null)
    .map((m) => ({ matchId: m.id, key: keyByContribId.get(m.contributionId!) }))
    .filter((m): m is { matchId: number; key: string } => !!m.key);

  const CONTRIB_CHUNK = 500;
  const MATCH_CHUNK = 1000;

  // ── Persist atomically ────────────────────────────────────────────────────
  // Bulk delete + bulk insert. Per-row upserts (one network round-trip each over
  // the Supabase pooler) time out the interactive transaction at a few thousand
  // rows; a handful of chunked bulk statements finishes in a second or two.
  const summary = await prisma.$transaction(
    async (tx: Tx) => {
      const run = await tx.reconcileRun.create({
        data: {
          triggeredById: opts.triggeredById ?? null,
          countsByStatus: result.totals.countsByStatus,
          totalExpectedPaise: result.totals.expectedWallPaise,
          totalMatchedPaise: result.totals.receivedGrossPaise,
          totalOrphanPaise: result.totals.orphanPaise,
          closureOk: result.totals.closureOk,
        },
      });

      // Clear the old ledger. Deleting contributions sets manual matches'
      // contributionId to null (onDelete: SetNull) — re-pointed below.
      await tx.contributionMatch.deleteMany({
        where: { matchType: { in: ["auto_reference", "auto_fuzzy_suggested"] } },
      });
      await tx.contribution.deleteMany({});

      const createRows = prepared
        .map((p) => {
          const r = resultByKey.get(p.input.key);
          if (!r) return null;
          return {
            blockSubmissionId: p.persist.blockSubmissionId,
            birnagarDonationId: p.persist.birnagarDonationId,
            cashVolunteerId: p.persist.cashVolunteerId,
            sourceType: p.persist.sourceType,
            donorName: p.persist.donorName,
            donorPhone: p.persist.donorPhone,
            donorEmail: p.persist.donorEmail,
            blockId: p.persist.blockId,
            serialNumber: p.persist.serialNumber,
            qty: p.persist.qty,
            actionType: p.persist.actionType,
            collectedByUserId: p.persist.collectedByUserId,
            contributedAt: p.persist.contributedAt,
            paymentChannel: p.persist.paymentChannel,
            paymentReference: p.persist.paymentReference,
            expectedPaise: r.expectedPaise,
            matchedPaise: r.matchedPaise,
            variancePaise: r.variancePaise,
            status: r.status,
            statusFlags: (r.flags.length ? r.flags : undefined) as
              | Prisma.InputJsonValue
              | undefined,
            receiptEligible: r.receiptEligible,
            reconciledAt: run.startedAt,
            reconcileRunId: run.id,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      const contribIdByKey = new Map<string, number>();
      for (const part of chunk(createRows, CONTRIB_CHUNK)) {
        const created = await tx.contribution.createManyAndReturn({
          data: part,
          select: {
            id: true,
            blockSubmissionId: true,
            birnagarDonationId: true,
            cashVolunteerId: true,
          },
        });
        for (const row of created) {
          const k = keyForSoftRow(row);
          if (k) contribIdByKey.set(k, row.id);
        }
      }

      // Re-point preserved manual matches to the freshly-created contributions.
      for (const m of manualRepoint) {
        const newId = contribIdByKey.get(m.key);
        if (newId) {
          await tx.contributionMatch.update({
            where: { id: m.matchId },
            data: { contributionId: newId },
          });
        }
      }

      // Insert the auto_reference matches (orphans carry contributionId null).
      const autoData = result.matches
        .filter((m) => m.matchType === "auto_reference")
        .map((m) => ({
          contributionId:
            m.contributionKey != null ? contribIdByKey.get(m.contributionKey) ?? null : null,
          gatewayTxnId: m.gatewayTxnId,
          upiTxnId: m.upiTxnId,
          matchType: m.matchType,
          amountPaise: m.amountPaise,
          confidence: m.confidence,
          note: m.note,
          createdById: m.createdById,
        }));
      for (const part of chunk(autoData, MATCH_CHUNK)) {
        await tx.contributionMatch.createMany({ data: part });
      }

      await tx.reconcileRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date() },
      });

      return {
        runId: run.id,
        countsByStatus: result.totals.countsByStatus as Record<string, number>,
        totalExpectedPaise: result.totals.expectedWallPaise,
        totalMatchedPaise: result.totals.receivedGrossPaise,
        totalOrphanPaise: result.totals.orphanPaise,
        closureOk: result.totals.closureOk,
        closureDeltaPaise: result.totals.closureDeltaPaise,
        contributionCount: result.contributions.length,
        matchCount: result.matches.length,
        orphanCount: result.orphans.length,
      } satisfies ReconcileRunSummary;
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  return summary;
}
