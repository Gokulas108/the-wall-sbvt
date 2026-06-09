import { redirect } from "next/navigation";

// WhatsApp Care is a tab inside the reconciliation shell; keep this path as a stable alias
// that redirects into the canonical `?view=` URL.
export default function WhatsAppCareTabPage() {
  redirect("/admin/reconciliation?view=whatsapp-care");
}
