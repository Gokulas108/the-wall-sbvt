import { redirect } from "next/navigation";

// The transaction detail now renders inline inside the reconciliation shell (sidebar stays
// visible). Old deep links to this path redirect into the canonical inline URL.
export default async function LedgerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/reconciliation?view=ledger&id=${encodeURIComponent(id)}`);
}
