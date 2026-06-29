import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import {
  getAddressCollectionExport,
  parseAddressCollectionFilters,
} from "@/lib/whatsapp-care/address-collection";

// GET /api/admin/whatsapp-care/address-collection/export?q=&flags=&messaged=&replied=
// Every number matching the same filters as the list (no pagination), flattened to
// { number, names, totals } so the client's "Select all filtered" can add the whole
// matching set to its selection at once. Admin-only.
export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await getAddressCollectionExport(
    parseAddressCollectionFilters(req.nextUrl.searchParams),
  );
  return NextResponse.json(result);
}
