"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type AuthUser = { id: number; username: string; role: "admin" | "volunteer" };

// Sign-in for the accounting dashboard. Reuses the donor-form PIN auth API, but only
// admins may proceed — a volunteer login is rejected and its session cleared so no
// dangling cookie is left behind. On an admin login we refresh the server component,
// which re-reads the session cookie and renders the dashboard in place.
export function ReconciliationLogin() {
  const router = useRouter();
  const pinRef = useRef<HTMLInputElement | null>(null);
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submitLogin(nextUsername: string, nextPin: string) {
    if (loading) return;
    setError("");

    const u = nextUsername.trim();
    if (!u || !/^\d{4}$/.test(nextPin)) {
      setError("Enter username and a 4-digit PIN.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/donor-form/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: nextPin }),
      });
      const data = (await res.json()) as { user?: AuthUser; error?: string };
      if (!res.ok || !data.user) {
        setError(data.error || "Unable to sign in.");
        setPin("");
        return;
      }
      if (data.user.role !== "admin") {
        // Login succeeded but this isn't an admin — drop the session we just created.
        await fetch("/api/donor-form/logout", { method: "POST" });
        setError("This account doesn't have admin access.");
        setPin("");
        return;
      }

      (document.activeElement as HTMLElement | null)?.blur();
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitLogin(username, pin);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4 text-gray-900">
      <form
        onSubmit={handleSubmit}
        autoComplete="off"
        className="w-full max-w-sm rounded-xl border border-gray-200 bg-white shadow-sm"
      >
        {/* Slate header echoes the dashboard sidebar. */}
        <div className="rounded-t-xl bg-slate-900 px-6 py-5">
          <div className="text-sm font-semibold text-white">SBVT Donor Care and Accounts</div>
          <div className="text-[11px] text-slate-400">Birnagar Temple Project</div>
        </div>

        <div className="flex flex-col gap-3 p-6">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Admin sign in</h1>
            <p className="mt-0.5 text-xs text-gray-500">Enter your username and 4-digit PIN.</p>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoCapitalize="none"
              autoComplete="username"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            PIN
            <input
              type="password"
              value={pin}
              ref={pinRef}
              onChange={(e) => {
                const next = e.target.value.replace(/\D/g, "").slice(0, 4);
                setPin(next);
                if (next.length === 4) {
                  pinRef.current?.blur();
                  void submitLogin(username, next);
                }
              }}
              placeholder="4-digit PIN"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm tracking-widest text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </label>

          {error && <p className="text-xs font-medium text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? "Checking…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
