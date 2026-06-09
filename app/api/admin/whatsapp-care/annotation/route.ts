import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { prisma } from "@/lib/db/prisma";
import { normalizeWhatsappNumber } from "@/lib/whatsapp-care/phone";
import { bustAddressCollectionCache } from "@/lib/whatsapp-care/address-collection";

// POST /api/admin/whatsapp-care/annotation — upsert the manual invalid flag / notes
// for one WhatsApp number. Keyed by phone in the body (normalized server-side) so we
// never touch Next 16's async route params. Writes ONLY the manual fields — the
// Doubletick-inferred fields are left to the delivery-status webhook.
export async function POST(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    phone?: string;
    isInvalid?: boolean;
    notes?: string;
  };

  const key = normalizeWhatsappNumber(String(body.phone ?? ""));
  if (!key) return NextResponse.json({ error: "phone is required" }, { status: 400 });

  const data: { isInvalid?: boolean; notes?: string | null; updatedByUserId: number } = {
    updatedByUserId: admin.id,
  };
  if (typeof body.isInvalid === "boolean") data.isInvalid = body.isInvalid;
  if (body.notes !== undefined) data.notes = body.notes === "" ? null : String(body.notes);

  const annotation = await prisma.whatsAppNumberAnnotation.upsert({
    where: { normalizedPhone: key },
    create: { normalizedPhone: key, ...data },
    update: data,
  });

  bustAddressCollectionCache(); // so the list reflects the flag/notes immediately
  return NextResponse.json({ ok: true, annotation });
}
