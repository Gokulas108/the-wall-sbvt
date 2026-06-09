import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { prisma } from "@/lib/db/prisma";

// GET /api/admin/reconciliation/breakdowns?by=volunteer|block|day
export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const by = req.nextUrl.searchParams.get("by") ?? "volunteer";

  if (by === "volunteer") {
    const groups = await prisma.contribution.groupBy({
      by: ["collectedByUserId"],
      where: { collectedByUserId: { not: null } },
      _sum: { expectedPaise: true, matchedPaise: true },
      _count: { _all: true },
    });
    const ids = groups.map((g) => g.collectedByUserId!).filter((x) => x != null);
    const users = ids.length
      ? await prisma.donorFormUser.findMany({
          where: { id: { in: ids } },
          select: { id: true, username: true, amountInCash: true, amountSettled: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const rows = groups
      .map((g) => {
        const u = byId.get(g.collectedByUserId!);
        return {
          volunteerId: g.collectedByUserId,
          username: u?.username ?? `#${g.collectedByUserId}`,
          count: g._count._all,
          expectedPaise: g._sum.expectedPaise ?? 0,
          receivedPaise: g._sum.matchedPaise ?? 0,
          cashCollectedPaise: (u?.amountInCash ?? 0) * 100,
          cashSettledPaise: (u?.amountSettled ?? 0) * 100,
          cashPendingPaise: Math.max(0, (u?.amountInCash ?? 0) - (u?.amountSettled ?? 0)) * 100,
        };
      })
      .sort((a, b) => b.expectedPaise - a.expectedPaise);
    return NextResponse.json({ by, rows });
  }

  if (by === "block") {
    const groups = await prisma.contribution.groupBy({
      by: ["blockId"],
      where: { blockId: { not: null } },
      _sum: { expectedPaise: true, matchedPaise: true, qty: true },
      _count: { _all: true },
    });
    const rows = groups
      .map((g) => ({
        blockId: g.blockId,
        count: g._count._all,
        qty: g._sum.qty ?? 0,
        expectedPaise: g._sum.expectedPaise ?? 0,
        receivedPaise: g._sum.matchedPaise ?? 0,
      }))
      .sort((a, b) => (a.blockId ?? "").localeCompare(b.blockId ?? ""));
    return NextResponse.json({ by, rows });
  }

  if (by === "day") {
    // No date_trunc in groupBy — bucket in JS over a lean projection.
    const all = await prisma.contribution.findMany({
      where: { contributedAt: { not: null } },
      select: { contributedAt: true, expectedPaise: true, matchedPaise: true },
    });
    const buckets = new Map<string, { count: number; expectedPaise: number; receivedPaise: number }>();
    for (const c of all) {
      const day = c.contributedAt!.toISOString().slice(0, 10);
      const b = buckets.get(day) ?? { count: 0, expectedPaise: 0, receivedPaise: 0 };
      b.count += 1;
      b.expectedPaise += c.expectedPaise;
      b.receivedPaise += c.matchedPaise;
      buckets.set(day, b);
    }
    const rows = [...buckets.entries()]
      .map(([day, b]) => ({ day, ...b }))
      .sort((a, b) => (a.day < b.day ? 1 : -1));
    return NextResponse.json({ by, rows });
  }

  return NextResponse.json({ error: "by must be volunteer | block | day." }, { status: 400 });
}
