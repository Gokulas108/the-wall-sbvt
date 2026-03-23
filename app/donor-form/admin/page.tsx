"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

type AuthUser = {
  id: number;
  username: string;
  role: "admin" | "volunteer";
};

type ManagedUser = {
  id: number;
  username: string;
  role: "admin" | "volunteer";
  isActive: boolean;
  amountInCash: number;
  amountPledge: number;
  amountTotal: number;
};

export default function DonorFormAdminPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [status, setStatus] = useState("");

  const [newUsername, setNewUsername] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "volunteer">("volunteer");
  const [creating, setCreating] = useState(false);
  const [newUserCopied, setNewUserCopied] = useState(false);
  const [recentlyCreatedCredential, setRecentlyCreatedCredential] = useState<{
    username: string;
    password: string;
  } | null>(null);

  const [roleDrafts, setRoleDrafts] = useState<
    Record<number, "admin" | "volunteer">
  >({});
  const [pinDrafts, setPinDrafts] = useState<Record<number, string>>({});
  const [copiedUserId, setCopiedUserId] = useState<number | null>(null);

  const totalCollected = useMemo(
    () => users.reduce((sum, user) => sum + user.amountTotal, 0),
    [users],
  );
  const totalCash = useMemo(
    () => users.reduce((sum, user) => sum + user.amountInCash, 0),
    [users],
  );
  const totalPledge = useMemo(
    () => users.reduce((sum, user) => sum + user.amountPledge, 0),
    [users],
  );
  const currencyFormatter = useMemo(() => new Intl.NumberFormat("en-IN"), []);

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      const res = await fetch("/api/donor-form/users", { cache: "no-store" });
      const data = (await res.json()) as {
        users?: ManagedUser[];
        error?: string;
      };
      if (!res.ok || !data.users) {
        setStatus(data.error || "Unable to load users.");
        return;
      }
      setUsers(data.users);
      setRoleDrafts(
        Object.fromEntries(
          data.users.map((user) => [user.id, user.role]),
        ) as Record<number, "admin" | "volunteer">,
      );
    } catch {
      setStatus("Network error while loading users.");
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    const run = async () => {
      try {
        const meRes = await fetch("/api/donor-form/me", { cache: "no-store" });
        if (!meRes.ok) return;
        const meData = (await meRes.json()) as { user?: AuthUser };
        if (!meData.user) return;
        setAuthUser(meData.user);

        if (meData.user.role === "admin") {
          await loadUsers();
        }
      } finally {
        setAuthChecked(true);
      }
    };

    void run();
  }, []);

  async function handleLogout() {
    await fetch("/api/donor-form/logout", { method: "POST" });
    window.location.href = "/donor-form";
  }

  async function handleCreateUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("");

    const username = newUsername.trim();
    if (!username) {
      setStatus("Enter username.");
      return;
    }

    const password = generatePinValue();

    setCreating(true);
    try {
      const res = await fetch("/api/donor-form/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role: newRole }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatus(data.error || "Unable to create user.");
        return;
      }
      setNewUsername("");
      setNewRole("volunteer");
      setRecentlyCreatedCredential({ username, password });
      setNewUserCopied(false);
      setStatus("User created.");
      await loadUsers();
    } catch {
      setStatus("Network error while creating user.");
    } finally {
      setCreating(false);
    }
  }

  async function patchUser(userId: number, body: Record<string, unknown>) {
    setStatus("");
    const res = await fetch(`/api/donor-form/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setStatus(data.error || "Unable to update user.");
      return false;
    }
    await loadUsers();
    return true;
  }

  async function copyToClipboard(text: string) {
    if (typeof window === "undefined") return false;

    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }

      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }

  function generatePinValue() {
    return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  }

  async function handleGeneratePin(user: ManagedUser) {
    const generatedPin = generatePinValue();
    const ok = await patchUser(user.id, { password: generatedPin });
    if (!ok) return;

    setPinDrafts((prev) => ({
      ...prev,
      [user.id]: generatedPin,
    }));
    setCopiedUserId(null);
    setStatus(`PIN generated for ${user.username}.`);
  }

  async function handleCopyCredentials(user: ManagedUser) {
    const pin = pinDrafts[user.id] ?? "";
    if (!/^\d{4}$/.test(pin)) {
      setStatus("Generate PIN first.");
      return;
    }

    try {
      const copied = await copyToClipboard(
        `Username: ${user.username}\nPIN: ${pin}`,
      );
      if (!copied) {
        setStatus("Unable to copy credentials. Please copy manually.");
        return;
      }
      setCopiedUserId(user.id);
      setStatus(`Credentials copied for ${user.username}.`);
    } catch {
      setStatus("Unable to copy credentials. Please copy manually.");
    }
  }

  async function handleCopyNewUserCredentials() {
    if (!recentlyCreatedCredential) return;

    const copied = await copyToClipboard(
      `Username: ${recentlyCreatedCredential.username}\nPIN: ${recentlyCreatedCredential.password}`,
    );

    if (!copied) {
      setStatus("Unable to copy credentials. Please copy manually.");
      return;
    }

    setNewUserCopied(true);
    setStatus(`Credentials copied for ${recentlyCreatedCredential.username}.`);
  }

  if (!authChecked) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{
          background: "linear-gradient(145deg, #1a0f0a, #2a150c 50%, #1a0f0a)",
          color: "#fff5e7",
        }}
      >
        Checking access...
      </div>
    );
  }

  if (!authUser || authUser.role !== "admin") {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{
          background: "linear-gradient(145deg, #1a0f0a, #2a150c 50%, #1a0f0a)",
          color: "#fff5e7",
        }}
      >
        <div className="text-center">
          <p className="mb-3">Admin access required.</p>
          <a
            href="/donor-form"
            className="px-4 py-2 rounded-lg"
            style={{
              border: "1px solid rgba(228,180,121,0.2)",
              color: "#ffe9cc",
            }}
          >
            Go to donor form
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full px-3 py-4 sm:px-4 sm:py-5"
      style={{
        background: "linear-gradient(145deg, #1a0f0a, #2a150c 50%, #1a0f0a)",
      }}
    >
      <div className="mx-auto w-full max-w-md flex flex-col gap-3">
        <div
          className="sticky top-2 z-40 rounded-xl px-3 py-2.5 flex items-center justify-between"
          style={{
            background: "rgba(36,20,12,0.88)",
            border: "1px solid rgba(170,120,75,0.24)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div className="min-w-0">
            <p
              className="text-sm font-semibold truncate"
              style={{ color: "rgba(255,230,198,0.9)" }}
            >
              {authUser.username}
            </p>
            <p
              className="text-[11px] uppercase tracking-wider"
              style={{ color: "rgba(255,230,198,0.72)" }}
            >
              Donor Admin
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/donor-form"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{
                background: "rgba(255,246,233,0.1)",
                border: "1px solid rgba(228,180,121,0.2)",
                color: "#ffe9cc",
              }}
            >
              Form
            </a>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="px-3 py-1.5 rounded-lg text-xs font-bold"
              style={{
                background: "rgba(255,246,233,0.1)",
                border: "1px solid rgba(228,180,121,0.2)",
                color: "#ffe9cc",
              }}
            >
              Logout
            </button>
          </div>
        </div>

        {status && (
          <p
            className="text-sm rounded-xl px-3 py-2"
            style={{
              color: "#f6d8af",
              background: "rgba(255,246,233,0.08)",
              border: "1px solid rgba(228,180,121,0.2)",
            }}
          >
            {status}
          </p>
        )}

        <div
          className="rounded-2xl p-4"
          style={{
            background:
              "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
            border: "1px solid rgba(170,120,75,0.2)",
          }}
        >
          <h1
            className="text-xl font-black mb-1"
            style={{ fontFamily: '"Cinzel", Georgia, serif', color: "#fff6ea" }}
          >
            Donor Form Admin
          </h1>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div
              className="rounded-xl p-2"
              style={{
                background: "rgba(255,246,233,0.08)",
                border: "1px solid rgba(228,180,121,0.2)",
              }}
            >
              <p
                className="text-[10px] uppercase tracking-wider"
                style={{ color: "rgba(255,230,198,0.72)" }}
              >
                Total
              </p>
              <p className="text-xs font-bold" style={{ color: "#fff5e7" }}>
                ₹{currencyFormatter.format(totalCollected)}
              </p>
            </div>
            <div
              className="rounded-xl p-2"
              style={{
                background: "rgba(255,246,233,0.08)",
                border: "1px solid rgba(228,180,121,0.2)",
              }}
            >
              <p
                className="text-[10px] uppercase tracking-wider"
                style={{ color: "rgba(255,230,198,0.72)" }}
              >
                Cash
              </p>
              <p className="text-xs font-bold" style={{ color: "#fff5e7" }}>
                ₹{currencyFormatter.format(totalCash)}
              </p>
            </div>
            <div
              className="rounded-xl p-2"
              style={{
                background: "rgba(255,246,233,0.08)",
                border: "1px solid rgba(228,180,121,0.2)",
              }}
            >
              <p
                className="text-[10px] uppercase tracking-wider"
                style={{ color: "rgba(255,230,198,0.72)" }}
              >
                Pledge
              </p>
              <p className="text-xs font-bold" style={{ color: "#fff5e7" }}>
                ₹{currencyFormatter.format(totalPledge)}
              </p>
            </div>
          </div>
        </div>

        {!recentlyCreatedCredential ? (
          <form
            onSubmit={handleCreateUser}
            className="rounded-2xl p-4 flex flex-col gap-2"
            style={{
              background:
                "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
              border: "1px solid rgba(170,120,75,0.2)",
            }}
          >
            <p className="text-sm font-semibold" style={{ color: "#fff5e7" }}>
              Add User
            </p>
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Username"
              className="w-full px-3 py-2.5 rounded-xl text-base outline-none"
              style={{
                background: "rgba(255,250,244,0.96)",
                border: "1px solid rgba(222,182,131,0.36)",
                color: "#2a1509",
                fontSize: "16px",
              }}
            />
            <select
              value={newRole}
              onChange={(e) =>
                setNewRole(e.target.value as "admin" | "volunteer")
              }
              className="w-full px-3 py-2.5 rounded-xl text-base outline-none"
              style={{
                background: "rgba(255,250,244,0.96)",
                border: "1px solid rgba(222,182,131,0.36)",
                color: "#2a1509",
                fontSize: "16px",
              }}
            >
              <option value="volunteer">Volunteer</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              className="w-full py-2.5 rounded-xl font-bold text-white"
              style={{
                background: "linear-gradient(135deg, #c96b1b, #e0b860)",
                opacity: creating ? 0.7 : 1,
              }}
              disabled={creating}
            >
              {creating ? "Saving..." : "Add User"}
            </button>
          </form>
        ) : (
          <div
            className="rounded-2xl p-4 flex flex-col gap-2"
            style={{
              background:
                "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
              border: "1px solid rgba(170,120,75,0.2)",
            }}
          >
            <p className="text-sm font-semibold" style={{ color: "#fff5e7" }}>
              New User Credentials
            </p>
            <p className="text-sm" style={{ color: "#ffe9cc" }}>
              Username: {recentlyCreatedCredential.username}
            </p>
            <p className="text-sm" style={{ color: "#ffe9cc" }}>
              PIN: {recentlyCreatedCredential.password}
            </p>
            <button
              type="button"
              className="w-full py-2.5 rounded-xl font-bold"
              style={{
                background: "rgba(255,246,233,0.1)",
                border: "1px solid rgba(228,180,121,0.2)",
                color: "#ffe9cc",
              }}
              onClick={() => void handleCopyNewUserCredentials()}
            >
              {newUserCopied ? "Copied" : "Copy Credentials"}
            </button>
            <button
              type="button"
              className="w-full py-2.5 rounded-xl font-bold text-white"
              style={{
                background: "linear-gradient(135deg, #c96b1b, #e0b860)",
              }}
              onClick={() => {
                setRecentlyCreatedCredential(null);
                setNewUserCopied(false);
                setStatus("");
              }}
            >
              Add Another User
            </button>
          </div>
        )}

        <div className="flex items-center justify-between px-1">
          <p className="text-sm font-semibold" style={{ color: "#fff5e7" }}>
            Users
          </p>
          <p className="text-xs" style={{ color: "rgba(255,230,198,0.72)" }}>
            {users.length} total
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {loadingUsers && (
            <p className="text-sm px-1" style={{ color: "#ffe9cc" }}>
              Loading users...
            </p>
          )}
          {!loadingUsers && users.length === 0 && (
            <p className="text-sm px-1" style={{ color: "#ffe9cc" }}>
              No users found.
            </p>
          )}

          {users.map((user) => (
            <div
              key={user.id}
              className="rounded-2xl p-3 flex flex-col gap-2"
              style={{
                background:
                  "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
                border: "1px solid rgba(170,120,75,0.2)",
              }}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold" style={{ color: "#fff5e7" }}>
                  {user.username}
                </p>
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider"
                    style={{
                      color: "rgba(255,230,198,0.9)",
                      border: "1px solid rgba(228,180,121,0.2)",
                      background: "rgba(255,246,233,0.06)",
                    }}
                  >
                    {user.role}
                  </span>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider"
                    style={{
                      color: user.isActive ? "#cff3d8" : "#f8c6c1",
                      border: "1px solid rgba(228,180,121,0.2)",
                      background: "rgba(255,246,233,0.06)",
                    }}
                  >
                    {user.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>

              <div
                className="text-xs"
                style={{ color: "rgba(255,230,198,0.84)" }}
              >
                <table
                  className="w-full"
                  style={{ borderCollapse: "separate", borderSpacing: "6px" }}
                >
                  <thead>
                    <tr>
                      <th
                        className="text-[11px] text-left"
                        style={{ color: "rgba(255,230,198,0.72)" }}
                      >
                        Donation
                      </th>
                      <th
                        className="text-[11px] text-left"
                        style={{ color: "rgba(255,230,198,0.72)" }}
                      >
                        Pledge
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 700 }}>
                        <span
                          className="text-[11px]"
                          style={{
                            display: "block",
                            color: "rgba(255,230,198,0.72)",
                          }}
                        >
                          Cash
                        </span>
                        <span>
                          ₹{currencyFormatter.format(user.amountInCash)}
                        </span>
                      </td>
                      <td style={{ fontWeight: 700 }}>
                        <span>
                          ₹{currencyFormatter.format(user.amountPledge)}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 700 }}>
                        <span
                          className="text-[11px]"
                          style={{
                            display: "block",
                            color: "rgba(255,230,198,0.72)",
                          }}
                        >
                          Total
                        </span>
                        <span>
                          ₹{currencyFormatter.format(user.amountTotal)}
                        </span>
                      </td>
                      <td />
                    </tr>
                    <tr>
                      <td
                        colSpan={2}
                        style={{
                          paddingTop: 6,
                          borderTop: "1px dashed rgba(228,180,121,0.12)",
                          color: "#fff5e7",
                          fontWeight: 800,
                        }}
                      >
                        Grand total (Donation + Pledge): ₹
                        {currencyFormatter.format(
                          user.amountTotal + user.amountPledge,
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2">
                <select
                  value={roleDrafts[user.id] ?? user.role}
                  onChange={(e) =>
                    setRoleDrafts((prev) => ({
                      ...prev,
                      [user.id]: e.target.value as "admin" | "volunteer",
                    }))
                  }
                  className="flex-1 px-2 py-2 rounded-lg text-sm outline-none"
                  style={{
                    background: "rgba(255,250,244,0.96)",
                    border: "1px solid rgba(222,182,131,0.36)",
                    color: "#2a1509",
                    fontSize: "16px",
                  }}
                >
                  <option value="volunteer">Volunteer</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg text-xs font-bold"
                  style={{
                    background: "rgba(255,246,233,0.1)",
                    border: "1px solid rgba(228,180,121,0.2)",
                    color: "#ffe9cc",
                  }}
                  onClick={() =>
                    void patchUser(user.id, {
                      role: roleDrafts[user.id] ?? user.role,
                    })
                  }
                >
                  Save Role
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-bold"
                  style={{
                    background: "rgba(255,246,233,0.1)",
                    border: "1px solid rgba(228,180,121,0.2)",
                    color: "#ffe9cc",
                  }}
                  onClick={() => void handleGeneratePin(user)}
                >
                  Generate New PIN
                </button>
                <button
                  type="button"
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-bold"
                  style={{
                    background: "rgba(255,246,233,0.1)",
                    border: "1px solid rgba(228,180,121,0.2)",
                    color: "#ffe9cc",
                    opacity: /^\d{4}$/.test(pinDrafts[user.id] ?? "") ? 1 : 0.6,
                  }}
                  disabled={!/^\d{4}$/.test(pinDrafts[user.id] ?? "")}
                  onClick={() => void handleCopyCredentials(user)}
                >
                  {copiedUserId === user.id ? "Copied" : "Copy Credentials"}
                </button>
              </div>

              {/^\d{4}$/.test(pinDrafts[user.id] ?? "") && (
                <p
                  className="text-[11px]"
                  style={{ color: "rgba(255,230,198,0.72)" }}
                >
                  Generated PIN: {pinDrafts[user.id]}
                </p>
              )}

              <button
                type="button"
                className="w-full py-2 rounded-lg text-xs font-bold"
                style={{
                  background: "rgba(255,246,233,0.1)",
                  border: "1px solid rgba(228,180,121,0.2)",
                  color: "#ffe9cc",
                }}
                onClick={() =>
                  void patchUser(user.id, { isActive: !user.isActive })
                }
              >
                {user.isActive ? "Deactivate User" : "Activate User"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
