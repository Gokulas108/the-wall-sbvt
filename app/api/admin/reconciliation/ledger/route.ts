import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { filtersFromSearchParams, queryLedger } from "@/lib/reconciliation/ledger";

// GET /api/admin/reconciliation/ledger?status&channel&volunteerId&blockId&q&from&to&page&pageSize
export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await queryLedger(filtersFromSearchParams(req.nextUrl.searchParams));
  return NextResponse.json(result);
}
