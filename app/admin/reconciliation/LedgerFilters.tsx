"use client";

import type { ReconciliationSummary } from "@/lib/reconciliation/summary";
import { STATUS_LABEL, statusBadgeClass } from "@/lib/reconciliation/format";
import { ALL_STATUSES } from "@/lib/reconciliation/engine";

// A pill that toggles on/off. When active it stays full-colour with a ring; when
// inactive it's a muted neutral pill.
function Tag({
  active,
  activeClass,
  onClick,
  children,
}: {
  active: boolean;
  activeClass: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
        active
          ? `${activeClass} ring-2 ring-offset-1 ring-gray-900/15`
          : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

// Donation-type + status tag filters for the ledger. Toggling a tag updates the
// shared ledger filter state, so the table below refreshes live.
export function LedgerFilters({
  summary,
  statusFilter,
  typeFilter,
  onToggleStatus,
  onToggleType,
  onClearStatus,
  onClearType,
}: {
  summary: ReconciliationSummary;
  statusFilter: string[];
  typeFilter: string[];
  onToggleStatus: (s: string) => void;
  onToggleType: (t: string) => void;
  onClearStatus: () => void;
  onClearType: () => void;
}) {
  const s = summary;
  const typeActive = (t: string) => typeFilter.includes(t);
  const statusActive = (st: string) => statusFilter.includes(st);

  return (
    <div className="flex flex-col gap-3">
      {/* Donation-type filter tags */}
      <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-gray-800">Donation type</h3>
          <span className="text-[11px] text-gray-400">Click on 1 or more tags to filter</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Tag active={typeFilter.length === 0} activeClass="bg-gray-900 text-white border-gray-900" onClick={onClearType}>
            All
          </Tag>
          <Tag active={typeActive("wall_of_legacy")} activeClass="bg-indigo-100 text-indigo-800 border-indigo-200" onClick={() => onToggleType("wall_of_legacy")}>
            Wall of Legacy · {s.wallOfLegacy.count.toLocaleString("en-IN")}
          </Tag>
          <Tag active={typeActive("general")} activeClass="bg-teal-100 text-teal-800 border-teal-200" onClick={() => onToggleType("general")}>
            General · {s.general.count.toLocaleString("en-IN")}
          </Tag>
        </div>
      </div>

      {/* Status filter tags */}
      <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-gray-800">Status distribution</h3>
          <span className="text-[11px] text-gray-400">Click on 1 or more tags to filter</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Tag active={statusFilter.length === 0} activeClass="bg-gray-900 text-white border-gray-900" onClick={onClearStatus}>
            All
          </Tag>
          {/* ORPHAN is never a contribution status — orphan payments live in the
              workbench (see the Orphan money card), so it's excluded here. */}
          {ALL_STATUSES.filter((st) => st !== "ORPHAN").map((st) => (
            <Tag key={st} active={statusActive(st)} activeClass={statusBadgeClass(st)} onClick={() => onToggleStatus(st)}>
              {STATUS_LABEL[st]} · {(s.statusCounts[st] ?? 0).toLocaleString("en-IN")}
            </Tag>
          ))}
        </div>
      </div>
    </div>
  );
}
