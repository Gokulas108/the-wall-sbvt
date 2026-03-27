"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { COST_PER_NAME } from "@/lib/mosaic/engine";

type UserStats = {
  id: number;
  username: string;
  role: string;
  isActive: boolean;
  amountInCash: number;
  amountPledge: number;
  amountTotal: number;
  amountSettled: number;
  donorsApproached: number;
  pendingToSettle: number;
};

type Submission = {
  id: number;
  name: string;
  qty: number;
  actionType: string;
  blockId: string;
  serialNumber: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  pledgeDueDays: number | null;
  createdAt: string;
};

type Settlement = {
  id: number;
  amount: number;
  note: string | null;
  createdAt: string;
  admin: { id: number; username: string };
};

type CurrentUser = { id: number; role: string };

export default function UserStatsClient({
  userId,
}: {
  userId: number;
}) {
  const [user, setUser] = useState<UserStats | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Submissions infinite scroll
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Settlement
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [pendingToSettle, setPendingToSettle] = useState(0);
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [settleAmount, setSettleAmount] = useState("");
  const [settleNote, setSettleNote] = useState("");
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState("");

  const fmt = useMemo(() => new Intl.NumberFormat("en-IN"), []);

  // Load user stats
  const loadUserStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/donor-form/users/${userId}/stats`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        setError("You must be logged in to view this page.");
        return;
      }
      if (res.status === 403) {
        setError("You don't have permission to view this page.");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Unable to load user stats.");
        return;
      }
      setUser(data.user);
      setCurrentUser(data.currentUser);
      setPendingToSettle(data.user.pendingToSettle);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Load submissions page
  const loadSubmissions = useCallback(
    async (cursor?: number | null) => {
      setLoadingMore(true);
      try {
        const url = cursor
          ? `/api/donor-form/users/${userId}/submissions?cursor=${cursor}`
          : `/api/donor-form/users/${userId}/submissions`;
        const res = await fetch(url, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) return;
        setSubmissions((prev) =>
          cursor ? [...prev, ...data.items] : data.items,
        );
        setNextCursor(data.nextCursor);
      } catch {
        // silent
      } finally {
        setLoadingMore(false);
        setInitialLoadDone(true);
      }
    },
    [userId],
  );

  // Load settlements
  const loadSettlements = useCallback(async () => {
    try {
      const res = await fetch(`/api/donor-form/users/${userId}/settle`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      setSettlements(data.settlements);
      setPendingToSettle(data.pendingToSettle);
    } catch {
      // silent
    }
  }, [userId]);

  useEffect(() => {
    void loadUserStats();
    void loadSubmissions();
  }, [loadUserStats, loadSubmissions]);

  // Load settlements when user data is ready and current user is admin
  useEffect(() => {
    if (currentUser?.role === "admin") {
      void loadSettlements();
    }
  }, [currentUser, loadSettlements]);

  // Infinite scroll observer
  useEffect(() => {
    if (!sentinelRef.current || !nextCursor || loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextCursor && !loadingMore) {
          void loadSubmissions(nextCursor);
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [nextCursor, loadingMore, loadSubmissions]);

  // Settle handler
  async function handleSettle() {
    const amount = parseInt(settleAmount, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      setSettleError("Enter a valid amount.");
      return;
    }
    if (amount > pendingToSettle) {
      setSettleError(`Amount exceeds pending balance (₹${fmt.format(pendingToSettle)}).`);
      return;
    }

    setSettling(true);
    setSettleError("");
    try {
      const res = await fetch(`/api/donor-form/users/${userId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, note: settleNote }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSettleError(data.error || "Settlement failed.");
        return;
      }
      setShowSettleModal(false);
      setSettleAmount("");
      setSettleNote("");
      // Refresh data
      await Promise.all([loadUserStats(), loadSettlements()]);
    } catch {
      setSettleError("Network error.");
    } finally {
      setSettling(false);
    }
  }

  if (loading) {
    return (
      <div style={pageStyle}>
        <p style={{ color: "#fff5e7", textAlign: "center", paddingTop: 80 }}>
          Loading...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: 480, margin: "0 auto", paddingTop: 60, textAlign: "center" }}>
          <p style={{ color: "#f8c6c1", fontSize: 15, marginBottom: 16 }}>{error}</p>
          <a href="/donor-form" style={linkBtnStyle}>Go to Form</a>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const isAdmin = currentUser?.role === "admin";

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <div style={{ marginBottom: 16, display: "flex", gap: "12px" }}>
          <a href="/donor-form" style={linkBtnStyle}>← Back to Form</a>
          {isAdmin && (
            <a href="/donor-form/admin" style={linkBtnStyle}>Admin Panel</a>
          )}
        </div>
        {/* Header Card */}
        <div style={cardStyle}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: 12, marginBottom: 16,
          }}>
            <h1 style={{
              fontSize: 22, fontWeight: 800, color: "#fff5e7", margin: 0,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 12,
            }}>
              {user.username}
            </h1>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
              <span style={badgeStyle(undefined)}>{user.role}</span>
              <span style={badgeStyle(user.isActive ? "#cff3d8" : "#f8c6c1")}>
                {user.isActive ? "Active" : "Inactive"}
              </span>
            </div>
          </div>

          {/* Stats Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <StatCard label="Cash Collected" value={`₹${fmt.format(user.amountInCash)}`} />
            <StatCard label="Pledge Amount" value={`₹${fmt.format(user.amountPledge)}`} />
            <StatCard label="Total Collected" value={`₹${fmt.format(user.amountTotal)}`} />
            <StatCard label="Donors Approached" value={String(user.donorsApproached)} />
          </div>

          {/* Grand Total */}
          <div style={{
            background: "rgba(255,246,233,0.04)", border: "1px dashed rgba(228,180,121,0.3)",
            borderRadius: 12, padding: "12px 16px", textAlign: "center", marginBottom: isAdmin ? 12 : 0,
          }}>
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: "rgba(255,230,198,0.72)", display: "block", marginBottom: 4 }}>
              Grand Total (Donation + Pledge)
            </span>
            <span style={{ fontSize: 24, fontWeight: 900, color: "#e0b860" }}>
              ₹{fmt.format(user.amountTotal + user.amountPledge)}
            </span>
          </div>

          {/* Cash Settlement Section (Admin only) */}
          {isAdmin && (
            <div style={{
              background: "rgba(255,246,233,0.06)", border: "1px solid rgba(228,180,121,0.15)",
              borderRadius: 12, padding: "12px 14px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, color: "rgba(255,230,198,0.72)" }}>
                  Cash Settlement
                </span>
                <span style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 6, fontWeight: 700,
                  background: pendingToSettle > 0 ? "rgba(248,198,193,0.15)" : "rgba(207,243,216,0.15)",
                  color: pendingToSettle > 0 ? "#f8c6c1" : "#cff3d8",
                }}>
                  {pendingToSettle > 0 ? "Pending" : "Settled"}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                <div>
                  <span style={{ fontSize: 10, color: "rgba(255,230,198,0.55)", display: "block" }}>Settled</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "#cff3d8" }}>₹{fmt.format(user.amountSettled)}</span>
                </div>
                <div>
                  <span style={{ fontSize: 10, color: "rgba(255,230,198,0.55)", display: "block" }}>Pending</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: pendingToSettle > 0 ? "#f8c6c1" : "#cff3d8" }}>₹{fmt.format(pendingToSettle)}</span>
                </div>
              </div>

              {pendingToSettle > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSettleAmount(String(pendingToSettle));
                    setSettleNote("");
                    setSettleError("");
                    setShowSettleModal(true);
                  }}
                  style={{
                    width: "100%", padding: "10px 0", borderRadius: 10, border: "none", cursor: "pointer",
                    background: "linear-gradient(135deg, #c96b1b, #e0b860)", color: "#fff",
                    fontSize: 13, fontWeight: 700,
                  }}
                >
                  Settle Cash
                </button>
              )}

              {/* Settlement History */}
              {settlements.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: "rgba(255,230,198,0.5)", display: "block", marginBottom: 6 }}>
                    Settlement History
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {settlements.map((s) => {
                      const d = new Date(s.createdAt);
                      return (
                        <div key={s.id} style={{
                          background: "rgba(255,246,233,0.04)", border: "1px solid rgba(228,180,121,0.1)",
                          borderRadius: 8, padding: "8px 10px",
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#cff3d8" }}>₹{fmt.format(s.amount)}</span>
                            <span style={{ fontSize: 10, color: "rgba(255,230,198,0.45)" }}>
                              {d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} {d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                            </span>
                          </div>
                          <p style={{ fontSize: 10, color: "rgba(255,230,198,0.5)", margin: "2px 0 0" }}>
                            by {s.admin.username}
                            {s.note ? ` · ${s.note}` : ""}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Donors List */}
        <div style={{ ...cardStyle, padding: "16px 12px" }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#fff5e7", margin: "0 0 4px 4px" }}>
            Donors Collected ({user.donorsApproached})
          </h2>

          {initialLoadDone && submissions.length === 0 && (
            <p style={{ color: "rgba(255,230,198,0.5)", fontSize: 13, textAlign: "center", padding: "24px 0", margin: 0 }}>
              No donors collected yet.
            </p>
          )}

          {submissions.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {submissions.map((s) => (
                <DonorCard key={s.id} submission={s} fmt={fmt} />
              ))}
            </div>
          )}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} style={{ height: 1 }} />

          {loadingMore && (
            <p style={{ color: "rgba(255,230,198,0.5)", fontSize: 12, textAlign: "center", padding: "12px 0", margin: 0 }}>
              Loading more...
            </p>
          )}

          {initialLoadDone && !nextCursor && submissions.length > 0 && (
            <p style={{ color: "rgba(255,230,198,0.35)", fontSize: 11, textAlign: "center", padding: "12px 0 4px", margin: 0 }}>
              All donors loaded
            </p>
          )}
        </div>


      </div>

      {/* Settle Modal */}
      {showSettleModal && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 50, display: "flex",
            alignItems: "center", justifyContent: "center", padding: 16,
            background: "rgba(14,7,4,0.7)", backdropFilter: "blur(8px)",
          }}
          onClick={() => setShowSettleModal(false)}
        >
          <div
            style={{
              width: "100%", maxWidth: 380, borderRadius: 16, padding: "20px 16px",
              background: "linear-gradient(145deg, #2a150b, #3c1f0f 52%, #4a2610)",
              border: "1px solid rgba(228,180,121,0.35)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.46)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 18, fontWeight: 800, color: "#fff4e3", margin: "0 0 4px" }}>
              Settle Cash
            </h3>
            <p style={{ fontSize: 13, color: "rgba(244,224,197,0.75)", margin: "0 0 16px" }}>
              Settling cash from <strong style={{ color: "#fff5e7" }}>{user.username}</strong>
            </p>

            <label style={labelStyle}>Amount (₹)</label>
            <input
              type="text"
              inputMode="numeric"
              value={settleAmount}
              onChange={(e) => setSettleAmount(e.target.value.replace(/\D/g, ""))}
              style={inputStyle}
            />

            <label style={{ ...labelStyle, marginTop: 10 }}>Note (optional)</label>
            <input
              type="text"
              value={settleNote}
              onChange={(e) => setSettleNote(e.target.value)}
              maxLength={100}
              placeholder="e.g. Received at office"
              style={inputStyle}
            />

            {settleError && (
              <p style={{ fontSize: 12, color: "#f8c6c1", margin: "8px 0 0" }}>{settleError}</p>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setShowSettleModal(false)}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 10, border: "1px solid rgba(228,180,121,0.2)",
                  background: "rgba(255,246,233,0.1)", color: "#ffe9cc", fontSize: 13,
                  fontWeight: 600, cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSettle()}
                disabled={settling}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 10, border: "none",
                  background: "linear-gradient(135deg, #c96b1b, #e0b860)", color: "#fff",
                  fontSize: 13, fontWeight: 700, cursor: "pointer",
                  opacity: settling ? 0.65 : 1,
                }}
              >
                {settling ? "Processing..." : "Confirm Settlement"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: "rgba(255,246,233,0.06)", border: "1px solid rgba(228,180,121,0.15)",
      borderRadius: 10, padding: "10px 12px",
    }}>
      <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500, color: "rgba(255,230,198,0.65)", display: "block", marginBottom: 4 }}>
        {label}
      </span>
      <span style={{ fontSize: 16, fontWeight: 800, color: "#fff5e7" }}>{value}</span>
    </div>
  );
}

function DonorCard({ submission, fmt }: { submission: Submission; fmt: Intl.NumberFormat }) {
  const amount = submission.qty * COST_PER_NAME;
  const isDonation = submission.actionType === "donate";
  const d = new Date(submission.createdAt);
  const dateStr = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

  const paymentLabel =
    submission.paymentMethod === "upi" ? "UPI"
    : submission.paymentMethod === "cash" ? "Cash"
    : isDonation ? "Cash" : "—";

  return (
    <div style={{
      background: "rgba(255,246,233,0.05)", border: "1px solid rgba(228,180,121,0.12)",
      borderRadius: 12, padding: 12,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: "#fff5e7", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {submission.name}
          </p>
          <p style={{ fontSize: 10, color: "rgba(255,230,198,0.5)", margin: "2px 0 0" }}>
            {dateStr} · {timeStr}
          </p>
        </div>
        <span style={{ fontSize: 15, fontWeight: 800, color: isDonation ? "#cff3d8" : "#f6d8af", flexShrink: 0 }}>
          ₹{fmt.format(amount)}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <Tag label={isDonation ? "Donation" : "Pledge"} bg={isDonation ? "rgba(80,180,100,0.15)" : "rgba(230,180,80,0.15)"} color={isDonation ? "#cff3d8" : "#f6d8af"} />
        <Tag label={`Qty: ${submission.qty}`} bg="rgba(255,246,233,0.06)" color="rgba(255,230,198,0.8)" />
        <Tag label={`Block: ${submission.blockId}`} bg="rgba(255,246,233,0.06)" color="rgba(255,230,198,0.8)" />
        {isDonation && (
          <Tag
            label={paymentLabel}
            bg={submission.paymentMethod === "upi" ? "rgba(100,140,220,0.15)" : "rgba(255,246,233,0.06)"}
            color={submission.paymentMethod === "upi" ? "#b8d0f8" : "rgba(255,230,198,0.8)"}
          />
        )}
        {!isDonation && submission.pledgeDueDays && (
          <Tag label={`${submission.pledgeDueDays} days`} bg="rgba(255,246,233,0.06)" color="rgba(255,230,198,0.8)" />
        )}
      </div>

      {submission.paymentMethod === "upi" && submission.paymentReference && (
        <p style={{ fontSize: 10, color: "rgba(184,208,248,0.7)", margin: "6px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Ref: {submission.paymentReference}
        </p>
      )}
      {submission.serialNumber && (
        <p style={{ fontSize: 10, color: "rgba(255,230,198,0.4)", margin: "4px 0 0", fontFamily: "monospace" }}>
          {submission.serialNumber}
        </p>
      )}
    </div>
  );
}

function Tag({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: bg, color, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

// --- Styles ---

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  width: "100%",
  background: "linear-gradient(145deg, #1a0f0a, #2a150c 50%, #1a0f0a)",
  padding: "16px 12px",
  boxSizing: "border-box",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const cardStyle: React.CSSProperties = {
  background: "linear-gradient(160deg, rgba(36,20,12,0.98), rgba(50,24,10,0.96) 46%, rgba(68,34,14,0.94))",
  border: "1px solid rgba(170,120,75,0.2)",
  borderRadius: 16,
  padding: "20px 16px",
  marginBottom: 12,
};

const linkBtnStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "10px 24px",
  borderRadius: 12,
  fontSize: 12,
  fontWeight: 700,
  background: "rgba(255,246,233,0.1)",
  border: "1px solid rgba(228,180,121,0.2)",
  color: "#ffe9cc",
  textDecoration: "none",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "rgba(255,230,198,0.85)",
  display: "block",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(222,182,131,0.36)",
  background: "rgba(255,250,244,0.96)",
  color: "#2a1509",
  fontSize: 16,
  outline: "none",
  boxSizing: "border-box",
};

function badgeStyle(color?: string): React.CSSProperties {
  return {
    fontSize: 10,
    padding: "2px 8px",
    borderRadius: 999,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontWeight: 600,
    color: color ?? "rgba(255,230,198,0.9)",
    border: "1px solid rgba(228,180,121,0.2)",
    background: "rgba(255,246,233,0.06)",
  };
}
