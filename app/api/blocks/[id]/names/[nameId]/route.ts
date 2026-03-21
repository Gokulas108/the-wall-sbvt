import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { NAMES_PER_BLOCK } from '@/lib/mosaic/engine';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; nameId: string }> }
) {
  const { id, nameId } = await params;
  const blockId = id.toUpperCase();
  await prisma.blockName.deleteMany({
    where: { id: parseInt(nameId, 10), blockId },
  });
  const names = await prisma.blockName.findMany({
    where: { blockId },
    orderBy: { createdAt: 'asc' },
  });
  const totalUsed = names.reduce((s, n) => s + n.qty, 0);
  return NextResponse.json({
    block_id: blockId,
    names: names.map((n) => ({
      id: n.id, name: n.name, qty: n.qty, created_at: n.createdAt.toISOString(),
    })),
    total_used: totalUsed,
    remaining: NAMES_PER_BLOCK - totalUsed,
  });
}
