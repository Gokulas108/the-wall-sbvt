import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { getReconciliationSummary } from "@/lib/reconciliation/summary";

// GET /api/admin/reconciliation/summary — card rollups from the materialized ledger.
export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await getReconciliationSummary();
  return NextResponse.json(summary);
}
