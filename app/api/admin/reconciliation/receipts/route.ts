import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { queryPendingReceipts } from "@/lib/reconciliation/receipts";

// GET /api/admin/reconciliation/receipts?q&channel&donationType&status&from&to&page&pageSize
// "Yet to submit to treasury": one row per matched transaction whose WhatsApp donor has
// sent legal name + address, excluding transactions already submitted. Admin-only.
export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const csv = (v: string | null) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);
  const result = await queryPendingReceipts({
    page: Number(sp.get("page") ?? "1") || 1,
    pageSize: Number(sp.get("pageSize") ?? "25") || 25,
    q: sp.get("q"),
    channel: sp.get("channel"),
    donationType: csv(sp.get("donationType")),
    status: csv(sp.get("status")),
    from: sp.get("from"),
    to: sp.get("to"),
  });
  return NextResponse.json(result);
}
