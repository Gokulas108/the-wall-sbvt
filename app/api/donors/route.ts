import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { COST_PER_NAME, GOAL } from '@/lib/mosaic/engine';

export async function GET() {
  const rows = await prisma.blockName.groupBy({
    by: ['name'],
    _sum: { qty: true },
    orderBy: { _sum: { qty: 'desc' } },
  });
  const grandTotal = await prisma.blockName.aggregate({ _sum: { qty: true } });
  const totalNames = grandTotal._sum.qty ?? 0;

  return NextResponse.json({
    donors: rows.map((r) => ({
      name: r.name,
      qty: r._sum.qty ?? 0,
      amount: (r._sum.qty ?? 0) * COST_PER_NAME,
    })),
    total_names: totalNames,
    total_collected: totalNames * COST_PER_NAME,
    goal: GOAL,
  });
}
