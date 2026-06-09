import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { querySubmittedReceipts } from "@/lib/reconciliation/receipts";

// GET /api/admin/reconciliation/receipts/submitted?q&channel&donationType&status&from&to&page&pageSize
// "Submitted to treasury": the treasury_receipts records, with the admin who submitted each.
export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const csv = (v: string | null) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);
  const result = await querySubmittedReceipts({
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
