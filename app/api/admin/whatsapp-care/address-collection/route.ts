import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import {
  getAddressCollectionPage,
  parseAddressCollectionFilters,
} from "@/lib/whatsapp-care/address-collection";

// GET /api/admin/whatsapp-care/address-collection?page=&pageSize=&q=&flags=&messaged=&replied=
// Paginated + searchable + filterable per-number rollup for the "Address Collection" tab.
// `flags` is a comma-separated subset of the AddressCollectionFlag set (OR-matched);
// `messaged` / `replied` are tri-state ("yes" | "no"). Admin-only.
export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const page = Number(sp.get("page") ?? "1") || 1;
  const pageSize = Number(sp.get("pageSize") ?? "25") || 25;

  const result = await getAddressCollectionPage({
    page,
    pageSize,
    ...parseAddressCollectionFilters(sp),
  });
  return NextResponse.json(result);
}
