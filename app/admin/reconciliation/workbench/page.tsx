import { redirect } from "next/navigation";

// The workbench is a tab inside the reconciliation shell; keep this path as a stable alias
// that redirects into the canonical `?view=` URL.
export default function WorkbenchPage() {
  redirect("/admin/reconciliation?view=workbench");
}
