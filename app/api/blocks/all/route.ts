import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { GRID_SIZE, NAMES_PER_BLOCK, blockId as bid } from '@/lib/mosaic/engine';

type BulkName = {
  id: number;
  name: string;
  qty: number;
  created_at: string;
};

type BulkBlock = {
  block_id: string;
  names: BulkName[];
  total_used: number;
  remaining: number;
};

/**
 * GET /api/blocks/all
 *
 * Returns every block keyed by id with its names list. Replaces the old
 * "fetch /api/blocks then 100x /api/blocks/[id]/names" load flow with a single
 * round-trip + a single DB query.
 */
export async function GET() {
  const rows = await prisma.blockName.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, blockId: true, name: true, qty: true, createdAt: true },
  });

  const blocks: Record<string, BulkBlock> = {};
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const id = bid(r, c);
      blocks[id] = { block_id: id, names: [], total_used: 0, remaining: NAMES_PER_BLOCK };
    }
  }

  for (const n of rows) {
    const block = blocks[n.blockId];
    if (!block) continue;
    block.names.push({
      id: n.id,
      name: n.name,
      qty: n.qty,
      created_at: n.createdAt.toISOString(),
    });
    block.total_used += n.qty;
  }

  for (const block of Object.values(blocks)) {
    block.remaining = NAMES_PER_BLOCK - block.total_used;
  }

  return NextResponse.json(
    { blocks },
    {
      headers: {
        // Tell intermediaries this response is per-request fresh — no shared caching.
        'Cache-Control': 'no-store',
      },
    },
  );
}
