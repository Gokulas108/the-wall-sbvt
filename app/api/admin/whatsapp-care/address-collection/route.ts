import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import {
  getAddressCollectionPage,
  type AddressCollectionFlag,
} from "@/lib/whatsapp-care/address-collection";

const VALID_FLAGS: AddressCollectionFlag[] = [
  "okay",
  "needsReview",
  "invalid",
  "manyDonors",
  "invalidPhone",
  "unverified",
  "multipleDonors",
  "conflicts",
];

// GET /api/admin/whatsapp-care/address-collection?page=&pageSize=&q=&flags=&messaged=&replied=
// Paginated + searchable + filterable per-number rollup for the "Address Collection" tab.
// `flags` is a comma-separated subset of
// needsReview|invalid|manyDonors|invalidPhone|unverified|multipleDonors|conflicts (OR-matched);
// `messaged` / `replied` are tri-state ("yes" | "no"). Admin-only.
export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const page = Number(sp.get("page") ?? "1") || 1;
  const pageSize = Number(sp.get("pageSize") ?? "25") || 25;
  const q = sp.get("q") ?? "";

  const flags = (sp.get("flags") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is AddressCollectionFlag =>
      VALID_FLAGS.includes(s as AddressCollectionFlag),
    );
  const messaged = sp.get("messaged");
  const replied = sp.get("replied");

  const result = await getAddressCollectionPage({
    page,
    pageSize,
    q,
    flags,
    messaged: messaged === "yes" || messaged === "no" ? messaged : undefined,
    replied: replied === "yes" || replied === "no" ? replied : undefined,
  });
  return NextResponse.json(result);
}
