import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { getWolSendStatus, pickRandomEligibleNumbers } from "@/lib/wol/cap";

// Random batch picker for the WoL campaign: returns "all okay", single-donor, not-yet-sent
// numbers up to the remaining daily budget (optionally capped by ?count=). The client then
// loops GET /api/wol-wf?number= per number so the cap is enforced per send. Single operator.
const WOL_SENDER_USERNAME = "gokul";

export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (admin.username !== WOL_SENDER_USERNAME) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = await getWolSendStatus();
  const requested = Number(req.nextUrl.searchParams.get("count") ?? "");
  const budget =
    Number.isFinite(requested) && requested > 0
      ? Math.min(requested, status.remaining)
      : status.remaining;

  const numbers = await pickRandomEligibleNumbers(budget);
  return NextResponse.json({ numbers, remaining: status.remaining });
}
