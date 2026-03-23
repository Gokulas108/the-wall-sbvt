import { NextRequest, NextResponse } from "next/server";
import {
  clearAuthCookie,
  destroySessionByToken,
  getSessionTokenFromRequest,
} from "@/lib/auth/donor-form";

export async function POST(req: NextRequest) {
  const token = await getSessionTokenFromRequest(req);
  await destroySessionByToken(token);

  const response = NextResponse.json({ ok: true });
  await clearAuthCookie(response);
  return response;
}
