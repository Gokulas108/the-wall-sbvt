import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth/donor-form";
import { prisma } from "@/lib/db/prisma";

const PAGE_SIZE = 20;

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

  // Volunteers can only see their own submissions
  if (currentUser.role !== "admin" && currentUser.id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cursor = req.nextUrl.searchParams.get("cursor");
  const cursorId = cursor ? parseInt(cursor, 10) : undefined;

  const submissions = await prisma.blockSubmission.findMany({
    where: { collectedByUserId: userId },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(cursorId
      ? {
          cursor: { id: cursorId },
          skip: 1,
        }
      : {}),
    select: {
      id: true,
      name: true,
      qty: true,
      actionType: true,
      blockId: true,
      serialNumber: true,
      paymentMethod: true,
      paymentReference: true,
      pledgeDueDays: true,
      createdAt: true,
    },
  });

  const hasMore = submissions.length > PAGE_SIZE;
  const items = hasMore ? submissions.slice(0, PAGE_SIZE) : submissions;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({ items, nextCursor });
}
