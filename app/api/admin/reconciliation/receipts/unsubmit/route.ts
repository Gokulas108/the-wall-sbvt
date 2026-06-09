import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { unsubmitTreasuryReceipts } from "@/lib/reconciliation/treasury";

// POST /api/admin/reconciliation/receipts/unsubmit  { receiptIds: number[] }
// Moves the given treasury receipts back to "yet to submit" (deletes the records). Admin-only.
export async function POST(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { receiptIds?: unknown } | null;
  const ids = Array.isArray(body?.receiptIds)
    ? body!.receiptIds.map(Number).filter(Number.isFinite)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: "No receipts selected" }, { status: 400 });

  const removed = await unsubmitTreasuryReceipts(ids);
  return NextResponse.json({ ok: true, removed });
}
