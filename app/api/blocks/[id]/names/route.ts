import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { NAMES_PER_BLOCK } from '@/lib/mosaic/engine';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const blockId = id.toUpperCase();
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const blockId = id.toUpperCase();
  const body = await req.json();
  const name = String(body.name ?? '').trim();
  const qty = parseInt(body.qty, 10);

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!qty || qty < 1) return NextResponse.json({ error: 'qty must be ≥ 1' }, { status: 400 });

  const used = await prisma.blockName.aggregate({
    where: { blockId },
    _sum: { qty: true },
  });
  const currentUsed = used._sum.qty ?? 0;
  if (currentUsed + qty > NAMES_PER_BLOCK) {
    return NextResponse.json({
      error: `Not enough space. ${NAMES_PER_BLOCK - currentUsed} slots remaining.`,
    }, { status: 400 });
  }

  await prisma.blockName.create({ data: { blockId, name, qty } });

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
  }, { status: 201 });
}
