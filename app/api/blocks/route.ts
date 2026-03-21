import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET() {
  const rows = await prisma.blockName.groupBy({
    by: ['blockId'],
    _sum: { qty: true },
    _count: true,
  });
  const blocks: Record<string, { total_qty: number; entry_count: number }> = {};
  for (const r of rows) {
    blocks[r.blockId] = {
      total_qty: r._sum.qty ?? 0,
      entry_count: r._count,
    };
  }
  return NextResponse.json(blocks);
}
