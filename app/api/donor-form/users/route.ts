import { NextRequest, NextResponse } from "next/server";
import {
  hashPasswordPin,
  isValidPin,
  normalizeUsername,
  requireAdminFromRequest,
} from "@/lib/auth/donor-form";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const usersRaw = await prisma.donorFormUser.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      username: true,
      role: true,
      isActive: true,
      amountInCash: true,
      amountPledge: true,
      amountTotal: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: { submissions: true },
      },
    },
  });

  const users = usersRaw.map(u => ({
    ...u,
    donorsApproached: u._count.submissions,
    _count: undefined,
  }));

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const username = normalizeUsername(String(body?.username ?? ""));
  const password = String(body?.password ?? "");
  const roleValue = String(body?.role ?? "volunteer").toLowerCase();

  if (!username) {
    return NextResponse.json(
      { error: "Username is required." },
      { status: 400 },
    );
  }
  if (!isValidPin(password)) {
    return NextResponse.json(
      { error: "Password must be a 4-digit PIN." },
      { status: 400 },
    );
  }
  if (roleValue !== "admin" && roleValue !== "volunteer") {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  try {
    const created = await prisma.donorFormUser.create({
      data: {
        username,
        password: hashPasswordPin(password),
        role: roleValue,
      },
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        amountInCash: true,
        amountPledge: true,
        amountTotal: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return NextResponse.json({ user: created }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Username already exists." },
      { status: 409 },
    );
  }
}
