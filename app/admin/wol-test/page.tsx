import { DatabaseAuthWrapper } from "@/app/admin/database/AuthWrapper";
import { WolTestForm } from "./WolTestForm";
import { ResendPanel } from "./ResendPanel";

// Internal testing dashboard for the Wall-of-Legacy WhatsApp flow. Sends a real opening
// template to a donor number; the typed amount is a test override (persisted as
// testAmount on the intake) that drives the PAN branch. Continue the conversation on the
// donor's phone to exercise the LLM name/address/PAN/receipt collection.
export default function WolTestPage() {
  return (
    <DatabaseAuthWrapper>
      <main className="min-h-screen w-full bg-gray-50 text-gray-900 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-xl font-bold mb-1">WoL Flow Tester</h1>
          <p className="text-sm text-gray-500 mb-6">
            Sends a real Wall-of-Legacy opening template to a donor number. Donor details
            come from <code>block_submissions</code>; the amount is a test override that
            drives the PAN branch (&gt; ₹10,000). Continue the conversation on the donor&apos;s
            phone.
          </p>
          <WolTestForm />

          <hr className="my-8 border-gray-200" />

          <ResendPanel />
        </div>
      </main>
    </DatabaseAuthWrapper>
  );
}
