import { Suspense } from "react";
import { ReceiptContent } from "./ReceiptContent";

function LoadingFallback() {
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center"
      style={{
        background:
          "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
      }}
    >
      <div className="text-center" style={{ color: "rgba(255,221,168,0.82)" }}>
        <p>Loading receipt...</p>
      </div>
    </div>
  );
}

export default function WebAppReceiptPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ReceiptContent />
    </Suspense>
  );
}
