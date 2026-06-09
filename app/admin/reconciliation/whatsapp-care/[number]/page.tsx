import { redirect } from "next/navigation";

// The per-number detail now renders inline inside the reconciliation shell (sidebar stays
// visible). Old deep links to this path redirect into the canonical inline URL.
export default async function WhatsAppCareNumberPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  redirect(`/admin/reconciliation?view=whatsapp-care&number=${encodeURIComponent(number)}`);
}
