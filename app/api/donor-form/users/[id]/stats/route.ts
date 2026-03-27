import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth/donor-form";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const currentUser = await getCurrentUserFromRequest(req);
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = parseInt(id, 10);
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 });
  }

  // Volunteers can only see their own stats
  if (currentUser.role !== "admin" && currentUser.id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userRaw = await prisma.donorFormUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      role: true,
      isActive: true,
      amountInCash: true,
      amountPledge: true,
      amountTotal: true,
      amountSettled: true,
      _count: {
        select: { submissions: true },
      },
    },
  });

  if (!userRaw) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  return NextResponse.json({
    user: {
      ...userRaw,
      donorsApproached: userRaw._count.submissions,
      pendingToSettle: userRaw.amountInCash - userRaw.amountSettled,
      _count: undefined,
    },
    currentUser: {
      id: currentUser.id,
      role: currentUser.role,
    },
  });
}
