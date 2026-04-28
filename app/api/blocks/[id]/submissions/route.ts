import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { COST_PER_NAME } from '@/lib/mosaic/engine';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const blockId = id.toUpperCase();
  const name = req.nextUrl.searchParams.get('name')?.trim();
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const submissions = await prisma.blockSubmission.findMany({
    where: {
      blockId,
      name: { equals: name, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      serialNumber: true,
      actionType: true,
      name: true,
      qty: true,
      paymentMethod: true,
      paymentReference: true,
      email: true,
      phone: true,
      whatsapp: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    block_id: blockId,
    submissions: submissions.map((s) => ({
      id: s.id,
      serial_number: s.serialNumber,
      action_type: s.actionType,
      name: s.name,
      qty: s.qty,
      amount: s.qty * COST_PER_NAME,
      payment_method: s.paymentMethod,
      payment_reference: s.paymentReference,
      email: s.email,
      phone: s.phone,
      whatsapp: s.whatsapp,
      created_at: s.createdAt.toISOString(),
    })),
  });
}
