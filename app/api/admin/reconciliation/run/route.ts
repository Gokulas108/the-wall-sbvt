import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { runReconciliation } from "@/lib/reconciliation/run";

// POST /api/admin/reconciliation/run — rebuild the materialized ledger.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const summary = await runReconciliation({ triggeredById: admin.id });
    return NextResponse.json(summary);
  } catch (e) {
    console.error("[reconciliation/run]", e);
    return NextResponse.json({ error: "Reconciliation failed." }, { status: 500 });
  }
}
