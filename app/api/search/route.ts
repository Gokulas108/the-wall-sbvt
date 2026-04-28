import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ query, results: [] });
  const queryLower = query.toLowerCase();

  const nameRows = await prisma.blockName.findMany({
    where: { name: { contains: query, mode: "insensitive" } },
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

  const submissionRows = await prisma.blockSubmission.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { phone: { contains: query, mode: "insensitive" } },
        { whatsapp: { contains: query, mode: "insensitive" } },
        { serialNumber: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  const nameKeys = new Set(
    Array.from(groupedNames.values()).map(
      (r) => `${r.name.toLowerCase()}|${r.block_id}`,
    ),
  );

  const results = [
    ...Array.from(groupedNames.values()).map((r) => ({
      kind: "name",
      label: r.name,
      block_id: r.block_id,
      qty: r.qty,
      created_at: r.created_at,
      subtitle: `Name inscription · ${r.qty} slot${r.qty > 1 ? "s" : ""}`,
      serial_number: null,
      action_type: null,
      phone: null,
      email: null,
    })),
    ...submissionRows.flatMap((r) => {
      const serialNumber =
        r.serialNumber && r.serialNumber.trim().length > 0
          ? r.serialNumber
          : `${r.actionType === "pledge" ? "PLG" : "DON"}-${r.blockId}-${String(r.id).padStart(6, "0")}`;
      const serialLower = serialNumber.toLowerCase();
      const phoneLower = (r.phone || "").toLowerCase();
      const waLower = (r.whatsapp || "").toLowerCase();
      const isSerialHit = serialLower.includes(queryLower);
      const isPhoneHit =
        phoneLower.includes(queryLower) || waLower.includes(queryLower);
      const isNameOnlyHit = !isSerialHit && !isPhoneHit;

      // Skip submission rows whose only match is the name when a grouped
      // BlockName entry already covers the same (name, block) — they're the
      // same inscription seen from two tables.
      if (
        isNameOnlyHit &&
        nameKeys.has(`${r.name.toLowerCase()}|${r.blockId}`)
      ) {
        return [];
      }

      return [
        {
          kind: isSerialHit ? "serial" : isPhoneHit ? "phone" : "name",
          label: r.name,
          block_id: r.blockId,
          qty: r.qty,
          created_at: r.createdAt.toISOString(),
          subtitle: `${isSerialHit ? "Serial" : isPhoneHit ? "Phone/WhatsApp" : "Name"} match · ${r.actionType === "pledge" ? "Pledge" : "Donation"}`,
          serial_number: serialNumber,
          action_type: r.actionType,
          phone: r.phone,
          email: r.email,
        },
      ];
    }),
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
