import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table") || "block_submissions";
  const pageStr = searchParams.get("page") || "1";
  const pageSizeStr = searchParams.get("pageSize") || "1000";

  const page = parseInt(pageStr, 10);
  const pageSize = parseInt(pageSizeStr, 10);

  if (isNaN(page) || page < 1 || isNaN(pageSize) || pageSize < 1) {
    return NextResponse.json({ error: "Invalid pagination parameters" }, { status: 400 });
  }

  let data: any[] = [];

  try {
    if (table === "block_submissions") {
      data = await prisma.blockSubmission.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
    } else if (table === "donor_form_users") {
      data = await prisma.donorFormUser.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
    } else if (table === "cash_settlements") {
      data = await prisma.cashSettlement.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
    } else {
      return NextResponse.json({ error: "Invalid table name" }, { status: 400 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Export API error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
