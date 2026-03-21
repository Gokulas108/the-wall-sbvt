import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { NAMES_PER_BLOCK, COST_PER_NAME } from "@/lib/mosaic/engine";
import { eventBus } from "@/lib/events/emitter";
import { Prisma } from "@prisma/client";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const blockId = id.toUpperCase();
  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const qty = parseInt(body.qty, 10);
  const dateOfBirth = String(body.date_of_birth ?? "").trim();
  const email = String(body.email ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const whatsapp = String(body.whatsapp ?? "").trim();
  const receiptSerialInput = String(body.receipt_serial ?? "").trim();

  if (!name)
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!qty || qty < 1)
    return NextResponse.json({ error: "qty must be ≥ 1" }, { status: 400 });
  if (!phone)
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  if (!whatsapp)
    return NextResponse.json(
      { error: "whatsapp is required" },
      { status: 400 },
    );

  const validInputSerial = /^DON-[A-J](?:10|[1-9])-\d{6}$/.test(
    receiptSerialInput,
  )
    ? receiptSerialInput
    : "";

  let submission: {
    id: number;
    createdAt: Date;
    serialNumber: string | null;
  };

  try {
    submission = await prisma.$transaction(
      async (tx) => {
        const used = await tx.blockName.aggregate({
          where: { blockId },
          _sum: { qty: true },
        });
        const currentUsed = used._sum.qty ?? 0;

        if (currentUsed + qty > NAMES_PER_BLOCK) {
          throw new Error(
            `Not enough space. ${NAMES_PER_BLOCK - currentUsed} slots remaining.`,
          );
        }

        const createdSubmission = await tx.blockSubmission.create({
          data: {
            blockId,
            actionType: "donate",
            name,
            qty,
            dateOfBirth,
            email,
            phone,
            whatsapp,
          },
          select: {
            id: true,
            createdAt: true,
          },
        });

        await tx.blockName.create({ data: { blockId, name, qty } });

        const serialNumber =
          validInputSerial ||
          `DON-${blockId}-${String(createdSubmission.id).padStart(6, "0")}`;

        return tx.blockSubmission.update({
          where: { id: createdSubmission.id },
          data: { serialNumber },
          select: {
            id: true,
            createdAt: true,
            serialNumber: true,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not process donation right now.";
    if (message.startsWith("Not enough space.")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Another donation updated this block. Please retry." },
      { status: 409 },
    );
  }

  const names = await prisma.blockName.findMany({
    where: { blockId },
    orderBy: { createdAt: "asc" },
  });
  const totalUsed = names.reduce((s, n) => s + n.qty, 0);
  const amount = qty * COST_PER_NAME;

  const serialNumber =
    submission.serialNumber ||
    `DON-${blockId}-${String(submission.id).padStart(6, "0")}`;

  const receipt = {
    receipt_type: "donate",
    serial_number: serialNumber,
    cross_check_ref: `${blockId}-${submission.id}`,
    submission_id: submission.id,
    block_id: blockId,
    name,
    qty,
    amount,
    currency: "INR",
    date_of_birth: dateOfBirth,
    email,
    phone,
    whatsapp,
    created_at: submission.createdAt.toISOString(),
  };

  // Emit SSE event for living wall
  eventBus.emit("donor:added", {
    type: "donation",
    blockId,
    name,
    qty,
    amount,
  });

  return NextResponse.json(
    {
      block_id: blockId,
      names: names.map((n) => ({
        id: n.id,
        name: n.name,
        qty: n.qty,
        created_at: n.createdAt.toISOString(),
      })),
      total_used: totalUsed,
      remaining: NAMES_PER_BLOCK - totalUsed,
      amount,
      submission: { action: "donate", name, qty },
      receipt,
    },
    { status: 201 },
  );
}
