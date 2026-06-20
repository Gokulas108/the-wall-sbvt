import { NextRequest, NextResponse } from "next/server";
import { requireAdminFromRequest } from "@/lib/auth/donor-form";
import { resolveDoubletick } from "@/lib/whatsapp/doubletick";
import { sendAllResends, sendResend, templateForTag } from "@/lib/wol/resend";

// The bulk run streams progress, so this route must never be cached/buffered.
export const dynamic = "force-dynamic";

// Re-send campaign trigger, driven ONLY by the /admin/wol-test dashboard. Admin-gated.
//   mode "test" → send one tag's template to a single number (preview before the bulk run).
//   mode "all"  → send to every row in resend-list.csv, routed by its tag.
// There is no public surface for this; both modes require an admin donor-form session.
export async function POST(req: NextRequest) {
  // Everything is wrapped so an unexpected throw (auth, DB query, receipt build, fetch)
  // comes back as JSON with the real message — never an HTML 500 the client can't parse.
  try {
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
      // Stream newline-delimited JSON: one {type:"progress"} per completed row, then a
      // final {type:"done"} carrying the full summary. The client reads the body directly
      // (not EventSource — this is a POST) and drives a progress bar + live failure list.
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (obj: unknown) => {
            try {
              controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
            } catch {
              // Client disconnected — the send below will no-op, run continues server-side.
            }
          };
          try {
            const summary = await sendAllResends(cfg, (u) =>
              send({ type: "progress", ...u }),
            );
            send({ type: "done", ok: summary.failed === 0, mode: "all", ...summary });
          } catch (err) {
            console.error("[wol-wf/resend] bulk send failed", err);
            send({
              type: "done",
              ok: false,
              mode: "all",
              error: err instanceof Error ? err.message : String(err),
            });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
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
        // Test previews may target a non-donor number → allow sample amount/date.
        { fallbackPlaceholders: true },
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
  } catch (err) {
    console.error("[wol-wf/resend] unhandled error", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      { status: 500 },
    );
  }
}
