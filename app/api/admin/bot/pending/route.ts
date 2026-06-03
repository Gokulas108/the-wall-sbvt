import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

// Lists every kkd_collection row that has never been messaged. Backs the
// "Send All" control on /admin/bot, which fans out to /api/kkd-wf per row.
export async function GET() {
  const rows = await prisma.kkdCollection.findMany({
    where: { messageSent: false },
    select: { id: true, whatsapp: true, name: true },
    orderBy: { id: "asc" },
  });

  return NextResponse.json({ rows });
}
