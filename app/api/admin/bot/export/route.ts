import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  normalizeFilters,
  buildKkdWhere,
  statusLabel,
} from "@/app/admin/bot/filters";

// Paginated export of the kkd_collection table joined with the collected
// legal name / address / pincode / status from whatsapp_intakes. Honors the
// same filters as the /admin/bot page so the CSV matches the current view.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const filters = normalizeFilters(
    sp.get("sent"),
    sp.get("balance"),
    sp.get("q"),
  );
  const where = buildKkdWhere(filters);

  const page = parseInt(sp.get("page") || "1", 10);
  const pageSize = parseInt(sp.get("pageSize") || "1000", 10);
  if (isNaN(page) || page < 1 || isNaN(pageSize) || pageSize < 1) {
    return NextResponse.json(
      { error: "Invalid pagination parameters" },
      { status: 400 },
    );
  }

  const rows = await prisma.kkdCollection.findMany({
    where,
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: { id: "asc" },
  });

  const whatsappList = rows.map((r) => r.whatsapp);
  const intakes = whatsappList.length
    ? await prisma.whatsAppIntake.findMany({
        where: { phone: { in: whatsappList } },
        select: {
          phone: true,
          legalName: true,
          address: true,
          pincode: true,
          status: true,
        },
      })
    : [];
  const byPhone = new Map(intakes.map((i) => [i.phone, i]));

  const data = rows.map((r) => {
    const intake = byPhone.get(r.whatsapp);
    return {
      name: r.name,
      whatsapp: r.whatsapp,
      amt_committed: r.amtCommitted,
      amt_received: r.amtReceived,
      message_sent: r.messageSent,
      message_sent_at: r.messageSentAt ? r.messageSentAt.toISOString() : "",
      legal_name: intake?.legalName ?? "",
      address: intake?.address ?? "",
      pincode: intake?.pincode ?? "",
      status: statusLabel(intake?.status),
    };
  });

  return NextResponse.json({ data });
}
