"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SendButton({
  whatsapp,
  name,
  alreadySent,
}: {
  whatsapp: string;
  name: string;
  alreadySent: boolean;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<"idle" | "sent" | "failed">("idle");

  const label = alreadySent ? "Send again" : "Send";

  const handleSend = async () => {
    if (sending) return;
    setSending(true);
    setStatus("idle");
    try {
      const url = `/api/kkd-wf?whatsapp=${encodeURIComponent(
        whatsapp,
      )}&name=${encodeURIComponent(name)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        setStatus("failed");
        return;
      }
      setStatus("sent");
      router.refresh();
    } catch {
      setStatus("failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleSend}
      disabled={sending}
      className={`px-3 py-1 rounded text-xs font-medium border transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${
        alreadySent
          ? "bg-white text-indigo-600 border-indigo-300 hover:bg-indigo-50"
          : "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
      }`}
    >
      {sending
        ? "Sending…"
        : status === "sent"
          ? "Sent ✓"
          : status === "failed"
            ? "Failed — retry"
            : label}
    </button>
  );
}
