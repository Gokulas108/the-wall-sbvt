import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { prisma } from "@/lib/db/prisma";

// POST — create a settlement
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const volunteerId = parseInt(id, 10);
  if (!Number.isFinite(volunteerId)) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }

  const body = await req.json();
  const amount = parseInt(body?.amount, 10);
  const note = String(body?.note ?? "").trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "Amount must be a positive number." },
      { status: 400 },
    );
  }

  const volunteer = await prisma.donorFormUser.findUnique({
    where: { id: volunteerId },
    select: { id: true, amountInCash: true, amountSettled: true },
  });

  if (!volunteer) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const pendingToSettle = volunteer.amountInCash - volunteer.amountSettled;
  if (amount > pendingToSettle) {
    return NextResponse.json(
      {
        error: `Amount exceeds pending balance. Pending: ₹${pendingToSettle}`,
      },
      { status: 400 },
    );
  }

  const settlement = await prisma.$transaction(async (tx) => {
    const created = await tx.cashSettlement.create({
      data: {
        volunteerId,
        adminId: admin.id,
        amount,
        note,
      },
      select: {
        id: true,
        amount: true,
        note: true,
        createdAt: true,
        admin: { select: { id: true, username: true } },
      },
    });

    await tx.donorFormUser.update({
      where: { id: volunteerId },
      data: { amountSettled: { increment: amount } },
    });

    return created;
  });

  return NextResponse.json({ settlement }, { status: 201 });
}

// GET — list settlements for a user
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const volunteerId = parseInt(id, 10);
  if (!Number.isFinite(volunteerId)) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }

  const settlements = await prisma.cashSettlement.findMany({
    where: { volunteerId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      amount: true,
      note: true,
      createdAt: true,
      admin: { select: { id: true, username: true } },
    },
  });

  const volunteer = await prisma.donorFormUser.findUnique({
    where: { id: volunteerId },
    select: { amountInCash: true, amountSettled: true },
  });

  return NextResponse.json({
    settlements,
    amountInCash: volunteer?.amountInCash ?? 0,
    amountSettled: volunteer?.amountSettled ?? 0,
    pendingToSettle:
      (volunteer?.amountInCash ?? 0) - (volunteer?.amountSettled ?? 0),
  });
}
