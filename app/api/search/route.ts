import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ query, results: [] });

  const nameRows = await prisma.blockName.findMany({
    where: { name: { contains: query } },
    orderBy: { qty: "desc" },
    take: 20,
  });

  const groupedNames = new Map<
    string,
    { name: string; block_id: string; qty: number; created_at: string }
  >();
  for (const r of nameRows) {
    const key = `${r.name}|${r.blockId}`;
    const existing = groupedNames.get(key);
    if (existing) {
      existing.qty += r.qty;
    } else {
      groupedNames.set(key, {
        name: r.name,
        block_id: r.blockId,
        qty: r.qty,
        created_at: r.createdAt.toISOString(),
      });
    }
  }

  const phoneRows = await prisma.blockSubmission.findMany({
    where: {
      OR: [{ phone: { contains: query } }, { whatsapp: { contains: query } }],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const serialMatch = query
    .toUpperCase()
    .match(/^(DON|PLG)-([A-Z]\d+)-(\d{1,})$/);
  let serialRows: Array<{
    id: number;
    blockId: string;
    name: string;
    qty: number;
    actionType: string;
    phone: string;
    createdAt: Date;
  }> = [];

  if (serialMatch) {
    const numericId = parseInt(serialMatch[3], 10);
    const row = await prisma.blockSubmission.findUnique({
      where: { id: numericId },
    });
    if (row) {
      serialRows = [row];
    }
  }

  const results = [
    ...Array.from(groupedNames.values()).map((r) => ({
      kind: "name",
      label: r.name,
      block_id: r.block_id,
      qty: r.qty,
      created_at: r.created_at,
      subtitle: `Name inscription · ${r.qty} slot${r.qty > 1 ? "s" : ""}`,
    })),
    ...phoneRows.map((r) => ({
      kind: "phone",
      label: r.name,
      block_id: r.blockId,
      qty: r.qty,
      created_at: r.createdAt.toISOString(),
      subtitle: `Phone/WhatsApp match · ${r.phone}`,
      serial_number: `${r.actionType === "pledge" ? "PLG" : "DON"}-${r.blockId}-${String(r.id).padStart(6, "0")}`,
    })),
    ...serialRows.map((r) => ({
      kind: "serial",
      label: r.name,
      block_id: r.blockId,
      qty: r.qty,
      created_at: r.createdAt.toISOString(),
      subtitle: `Serial match · ${r.actionType === "pledge" ? "Pledge" : "Donation"}`,
      serial_number: `${r.actionType === "pledge" ? "PLG" : "DON"}-${r.blockId}-${String(r.id).padStart(6, "0")}`,
    })),
  ];

  const deduped = new Map<string, (typeof results)[number]>();
  for (const item of results) {
    const key = `${item.kind}|${item.block_id}|${item.label}|${item.serial_number ?? ""}`;
    if (!deduped.has(key)) deduped.set(key, item);
  }

  return NextResponse.json({
    query,
    results: Array.from(deduped.values()).slice(0, 25),
  });
}
