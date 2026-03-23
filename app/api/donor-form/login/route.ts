import { NextRequest, NextResponse } from "next/server";
import {
  authenticateUser,
  createSession,
  ensureDefaultAdminUser,
  toSafeUser,
} from "@/lib/auth/donor-form";

export async function POST(req: NextRequest) {
  await ensureDefaultAdminUser();

  const body = await req.json();
  const username = String(body?.username ?? "");
  const password = String(body?.password ?? "");

  const user = await authenticateUser(username, password);
  if (!user) {
    return NextResponse.json(
      { error: "Invalid username or PIN." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ user: toSafeUser(user) });
  await createSession(response, user.id);
  return response;
}
