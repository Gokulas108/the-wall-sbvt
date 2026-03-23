import { NextRequest, NextResponse } from "next/server";
import {
  hashPasswordPin,
  isValidPin,
  requireAdminFromRequest,
} from "@/lib/auth/donor-form";
import { prisma } from "@/lib/db/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = parseInt(id, 10);
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }

  const body = await req.json();
  const updates: {
    isActive?: boolean;
    role?: "admin" | "volunteer";
    password?: string;
  } = {};

  if (typeof body?.isActive === "boolean") {
    updates.isActive = body.isActive;
  }

  if (body?.role !== undefined) {
    const roleValue = String(body.role).toLowerCase();
    if (roleValue !== "admin" && roleValue !== "volunteer") {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    updates.role = roleValue;
  }

  if (body?.password !== undefined) {
    const password = String(body.password);
    if (!isValidPin(password)) {
      return NextResponse.json(
        { error: "Password must be a 4-digit PIN." },
        { status: 400 },
      );
    }
    updates.password = hashPasswordPin(password);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No updates supplied." },
      { status: 400 },
    );
  }

  const existing = await prisma.donorFormUser.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (
    existing.role === "admin" &&
    updates.isActive === false &&
    admin.id === userId
  ) {
    return NextResponse.json(
      { error: "You cannot deactivate your own admin account." },
      { status: 400 },
    );
  }

  const updated = await prisma.donorFormUser.update({
    where: { id: userId },
    data: updates,
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

  if (updates.isActive === false) {
    await prisma.donorFormSession.deleteMany({ where: { userId } });
  }

  return NextResponse.json({ user: updated });
}
