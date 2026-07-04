import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { filtersFromSearchParams, queryLedger } from "@/lib/reconciliation/ledger";

// GET /api/admin/reconciliation/ledger/export — same filters as /ledger, but rows
// are flattened to readable (rupee) values for CSV. The client loops pages and
// builds the file (same pattern as app/admin/database/ExportCSVButton.tsx).
function rupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const filters = filtersFromSearchParams(req.nextUrl.searchParams);
  filters.pageSize = Math.min(500, filters.pageSize ?? 500);
  const { data, total, page, pageSize } = await queryLedger(filters);

  const rows = data.map((r) => ({
    id: r.id,
    donation_type: r.donationType === "general" ? "General" : "Wall of Legacy",
    status: r.status,
    source: r.sourceType,
    channel: r.paymentChannel,
    donor: r.donorName ?? "",
    phone: r.donorPhone ?? "",
    email: r.donorEmail ?? "",
    address: r.address ?? "",
    city: r.city ?? "",
    state: r.state ?? "",
    pincode: r.pincode ?? "",
    pan: r.panNo ?? "",
    donation_category: r.donationCategory ?? "",
    block: r.blockId ?? "",
    serial: r.serialNumber ?? "",
    qty: r.qty,
    reference: r.paymentReference ?? "",
    expected_inr: rupees(r.expectedPaise),
    received_inr: rupees(r.matchedPaise),
    variance_inr: rupees(r.variancePaise),
    receipt_eligible: r.receiptEligible ? "yes" : "no",
    flags: r.flags.join("|"),
    date: r.contributedAt ?? "",
  }));

  return NextResponse.json({ data: rows, total, page, pageSize });
}
