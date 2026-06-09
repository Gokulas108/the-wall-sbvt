import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { formatTreasuryReceiptNo } from "@/lib/reconciliation/receipts";
import { submitReceiptsToTreasury } from "@/lib/reconciliation/treasury";

// POST /api/admin/reconciliation/receipts/submit  { contributionIds: number[] }
// Assigns sequential receipt numbers, marks the selected transactions submitted to the
// treasury (idempotent), and returns the created receipt ids so the client can pull the
// CSV + ZIP. Admin-only.
export async function POST(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { contributionIds?: unknown } | null;
  const ids = Array.isArray(body?.contributionIds)
    ? body!.contributionIds.map(Number).filter(Number.isFinite)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: "No transactions selected" }, { status: 400 });

  const { created, skipped } = await submitReceiptsToTreasury(ids, {
    id: admin.id,
    username: admin.username,
  });

  return NextResponse.json({
    ok: true,
    createdCount: created.length,
    skipped,
    receiptIds: created.map((r) => r.id),
    receipts: created.map((r) => ({ id: r.id, receiptNo: formatTreasuryReceiptNo(r.id) })),
  });
}
