import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { getWolSendStatus } from "@/lib/wol/cap";

// Today's WoL send count vs the 250/day cap. Read by the reconciliation header so every admin
// sees how many sends remain.
export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getWolSendStatus());
}
