import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { getNumberDetail } from "@/lib/whatsapp-care/address-collection";

// GET /api/admin/whatsapp-care/<number>
// Full per-number rollup used by the inline detail view in the reconciliation shell. Admin-only.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ number: string }> },
) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { number } = await params;
  const detail = await getNumberDetail(number);
  return NextResponse.json(detail);
}
