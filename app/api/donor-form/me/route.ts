import { NextRequest, NextResponse } from "next/server";
import {
  ensureDefaultAdminUser,
  getCurrentUserFromRequest,
  toSafeUser,
} from "@/lib/auth/donor-form";

export async function GET(req: NextRequest) {
  await ensureDefaultAdminUser();
  const user = await getCurrentUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true, user: toSafeUser(user) });
}
