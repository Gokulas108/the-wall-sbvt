import { Suspense } from "react";
import { getCurrentUserFromServerCookies } from "@/lib/auth/donor-form";
import { getReconciliationSummary } from "@/lib/reconciliation/summary";
import { ReconciliationShell } from "./ReconciliationShell";
import { ReconciliationLogin } from "./ReconciliationLogin";
import { DesktopOnly } from "./DesktopOnly";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const user = await getCurrentUserFromServerCookies();
  if (!user || user.role !== "admin")
    return (
      <DesktopOnly>
        <ReconciliationLogin />
      </DesktopOnly>
    );

  const summary = await getReconciliationSummary();

  // The active tab is read client-side from `?view=` via useSearchParams, which needs a
  // Suspense boundary.
  return (
    <DesktopOnly>
      <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
        <ReconciliationShell initialSummary={summary} username={user.username} />
      </Suspense>
    </DesktopOnly>
  );
}
