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
  const pledgeDueDays = parseInt(body.pledge_due_days, 10);
  const receiptSerialInput = String(body.receipt_serial ?? "").trim();

  if (!name)
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!qty || qty < 1)
    return NextResponse.json({ error: "qty must be ≥ 1" }, { status: 400 });
  if (![25, 35, 45].includes(pledgeDueDays)) {
    return NextResponse.json(
      { error: "pledge_due_days must be 25, 35, or 45" },
      { status: 400 },
    );
  }

  const validInputSerial = /^PLG-[A-J](?:10|[1-9])-\d{6}$/.test(
    receiptSerialInput,
  )
    ? receiptSerialInput
    : "";

  let submission: {
    id: number;
    createdAt: Date;
  } | null = null;

  try {
    await prisma.$transaction(
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
            actionType: "pledge",
            name,
            qty,
            dateOfBirth,
            email,
            phone,
            whatsapp,
            pledgeDueDays,
          },
          select: { id: true, createdAt: true },
        });

        await tx.blockName.create({ data: { blockId, name, qty } });
        submission = createdSubmission;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not process pledge right now.";
    if (message.startsWith("Not enough space.")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Another donation updated this block. Please retry." },
      { status: 409 },
    );
  }

  if (!submission) {
    return NextResponse.json(
      { error: "Could not create pledge." },
      { status: 500 },
    );
  }

  const names = await prisma.blockName.findMany({
    where: { blockId },
    orderBy: { createdAt: "asc" },
  });
  const totalUsed = names.reduce((s, n) => s + n.qty, 0);
  const amount = qty * COST_PER_NAME;

  const createdAt = submission.createdAt;
  const pledgeDueDate = new Date(createdAt.getTime() + pledgeDueDays * 86400000)
    .toISOString()
    .slice(0, 10);

  const serialNumber =
    validInputSerial ||
    `PLG-${blockId}-${String(submission.id).padStart(6, "0")}`;

  try {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE block_submissions ADD COLUMN serial_number TEXT",
    );
  } catch {}
  await prisma.$executeRawUnsafe(
    "UPDATE block_submissions SET serial_number = ? WHERE id = ?",
    serialNumber,
    submission.id,
  );

  const receipt = {
    receipt_type: "pledge",
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
    pledge_due_days: pledgeDueDays,
    pledge_due_date: pledgeDueDate,
    created_at: createdAt.toISOString(),
  };

  eventBus.emit("donor:added", { type: "pledge", blockId, name, qty, amount });

  return NextResponse.json(
    {
      ok: true,
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
      submission: { action: "pledge", name, qty },
      receipt,
    },
    { status: 201 },
  );
}
