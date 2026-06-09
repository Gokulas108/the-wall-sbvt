import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { getPendingReceiptIds } from "@/lib/reconciliation/receipts";

// GET /api/admin/reconciliation/receipts/pending-ids?q&channel&donationType&status&from&to
// Every "yet to submit" transaction id matching the filters (all pages) — backs
// "Select all N pending". Admin-only.
export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const csv = (v: string | null) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);
  const ids = await getPendingReceiptIds({
    q: sp.get("q"),
    channel: sp.get("channel"),
    donationType: csv(sp.get("donationType")),
    status: csv(sp.get("status")),
    from: sp.get("from"),
    to: sp.get("to"),
  });
  return NextResponse.json({ ids });
}
