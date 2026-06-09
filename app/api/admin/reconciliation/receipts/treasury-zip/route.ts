import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { buildTreasuryZip, getTreasuryReceiptsByIds } from "@/lib/reconciliation/treasury";

// GET /api/admin/reconciliation/receipts/treasury-zip?ids=1,2,3
// A zip of the rendered receipt PDFs (one per treasury receipt). Admin-only. Fetches each
// PDF from the pdf-server, so this can take a few seconds for a large batch.
export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter(Number.isFinite);
  const receipts = await getTreasuryReceiptsByIds(ids);
  const zip = await buildTreasuryZip(receipts);
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="reciepts_${date}.zip"`,
    },
  });
}
