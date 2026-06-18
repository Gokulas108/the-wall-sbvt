import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { resolveDoubletick } from "@/lib/whatsapp/doubletick";
import { sendAllResends, sendResend, templateForTag } from "@/lib/wol/resend";

// Re-send campaign trigger, driven ONLY by the /admin/wol-test dashboard. Admin-gated.
//   mode "test" → send one tag's template to a single number (preview before the bulk run).
//   mode "all"  → send to every row in resend-list.csv, routed by its tag.
// There is no public surface for this; both modes require an admin donor-form session.
export async function POST(req: NextRequest) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    mode?: unknown;
    tag?: unknown;
    phone?: unknown;
    correctName?: unknown;
    correctAddress?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const cfg = resolveDoubletick();
  if (!cfg) {
    return NextResponse.json({ error: "Missing DOUBLETICK_API_KEY" }, { status: 500 });
  }

  const mode = typeof body.mode === "string" ? body.mode : "";

  if (mode === "all") {
    const summary = await sendAllResends(cfg);
    return NextResponse.json({ ok: summary.failed === 0, mode: "all", ...summary });
  }

  if (mode === "test") {
    const tag = typeof body.tag === "string" ? body.tag : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!tag || !templateForTag(tag)) {
      return NextResponse.json(
        { error: `Unknown or missing tag "${tag}"` },
        { status: 400 },
      );
    }
    if (!phone) {
      return NextResponse.json({ error: "phone is required" }, { status: 400 });
    }
    const result = await sendResend(
      {
        phone,
        tag,
        correctName: typeof body.correctName === "string" ? body.correctName : "",
        correctAddress:
          typeof body.correctAddress === "string" ? body.correctAddress : "",
      },
      cfg,
    );
    return NextResponse.json(
      { ok: result.ok, mode: "test", result },
      { status: result.ok ? 200 : 502 },
    );
  }

  return NextResponse.json(
    { error: "mode must be 'test' or 'all'" },
    { status: 400 },
  );
}
