import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { getContributionDetail } from "@/lib/reconciliation/ledger-detail";

// GET /api/admin/reconciliation/ledger/<id>
// Full transaction detail for one contribution, used by the inline detail view in the
// reconciliation shell. Returns null for unknown ids. Admin-only.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const detail = await getContributionDetail(Number(id));
  return NextResponse.json(detail);
}
