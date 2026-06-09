import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { prisma } from "@/lib/db/prisma";

// POST /api/admin/reconciliation/birnagar-pull
//
// Live, on-demand pull of the birnagar (Laravel) donations table into the thin
// BirnagarDonation cache, upserting by birnagarId so manual match links stay stable.
// No cron — this runs when the dashboard refreshes, so it is always current.
const BIRNAGAR_BASE = process.env.BIRNAGAR_BASE_URL ?? "https://birnagar.org";
const EXPORT_PATH = "/api/export/donations";
const MAX_PAGES = 1000;

interface BirnagarRow {
  id: number;
  source: string | null;
  txn_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  amount: string | null;
  status: string | null;
  created_at: string | null;
}

function rupeesToPaise(amount: string | null): number {
  const n = parseFloat(String(amount ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const exportKey = process.env.WALL_EXPORT_KEY;
  if (!exportKey) {
    return NextResponse.json(
      { error: "WALL_EXPORT_KEY is not configured on the wall server." },
      { status: 500 },
    );
  }

  let after = 0;
  let pages = 0;

  try {
    // Collect every page first, THEN swap the cache in one bulk transaction. This
    // keeps the pull fast (no per-row round-trips) and never leaves the cache
    // half-replaced if a page fetch fails — we only touch the DB once all pages load.
    const rows: { birnagarId: number; source: string; txnId: string | null; name: string; email: string | null; phone: string | null; amountPaise: number; status: string; donatedAt: Date | null }[] = [];
    const seen = new Set<number>();

    while (pages < MAX_PAGES) {
      const res = await fetch(`${BIRNAGAR_BASE}${EXPORT_PATH}?after=${after}`, {
        headers: { "X-Export-Key": exportKey, Accept: "application/json" },
        cache: "no-store",
      });
      if (res.status === 401) {
        return NextResponse.json({ error: "Birnagar rejected the export key." }, { status: 502 });
      }
      if (!res.ok) {
        return NextResponse.json({ error: `Birnagar export failed (${res.status}).` }, { status: 502 });
      }

      const json = (await res.json()) as { donations?: BirnagarRow[]; nextAfter?: number | null };
      const donations = json.donations ?? [];

      for (const d of donations) {
        if (seen.has(d.id)) continue; // guard against any pagination overlap
        seen.add(d.id);
        rows.push({
          birnagarId: d.id,
          source: d.source ?? "",
          txnId: d.txn_id?.trim() || null,
          name: d.name ?? "",
          email: d.email?.trim() || null,
          phone: d.phone?.trim() || null,
          amountPaise: rupeesToPaise(d.amount),
          status: d.status ?? "",
          donatedAt: d.created_at ? new Date(d.created_at) : null,
        });
      }

      pages += 1;
      if (json.nextAfter == null) break;
      after = json.nextAfter;
    }

    const chunkSize = 1000;
    const batch = await prisma.$transaction(
      async (tx) => {
        await tx.birnagarDonation.deleteMany({});
        for (let i = 0; i < rows.length; i += chunkSize) {
          await tx.birnagarDonation.createMany({ data: rows.slice(i, i + chunkSize) });
        }
        return tx.csvUploadBatch.create({
          data: {
            kind: "birnagar_live",
            uploadedById: admin.id,
            rowsTotal: rows.length,
            rowsInserted: rows.length,
            status: "completed",
          },
          select: { id: true },
        });
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    return NextResponse.json({ ok: true, pages, donations: rows.length, batchId: batch.id });
  } catch (e) {
    console.error("[birnagar-pull]", e);
    return NextResponse.json(
      { error: "Could not reach the birnagar export endpoint." },
      { status: 502 },
    );
  }
}
