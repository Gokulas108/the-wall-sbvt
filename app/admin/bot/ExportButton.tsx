"use client";

import { useState } from "react";

type Row = Record<string, unknown>;

export function ExportButton({
  sent,
  balance,
  q,
  totalCount,
}: {
  sent: string;
  balance: string;
  q: string;
  totalCount: number;
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleExport = async () => {
    if (isExporting || totalCount === 0) return;
    setIsExporting(true);
    setProgress(0);

    const pageSize = 1000;
    const totalPages = Math.ceil(totalCount / pageSize);
    let allData: Row[] = [];

    const base = new URLSearchParams();
    if (sent !== "all") base.set("sent", sent);
    if (balance !== "all") base.set("balance", balance);
    if (q) base.set("q", q);

    for (let page = 1; page <= totalPages; page++) {
      try {
        const sp = new URLSearchParams(base);
        sp.set("page", String(page));
        sp.set("pageSize", String(pageSize));
        const res = await fetch(`/api/admin/bot/export?${sp.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Failed to fetch page " + page);
        const json = (await res.json()) as { data: Row[] };
        allData = allData.concat(json.data);
        setProgress(Math.round((page / totalPages) * 100));
      } catch (e) {
        console.error(e);
        alert("Export failed while fetching data.");
        setIsExporting(false);
        return;
      }
    }

    if (allData.length === 0) {
      alert("No data to export");
      setIsExporting(false);
      return;
    }

    const headers = Object.keys(allData[0]);
    const escapeCsv = (val: unknown) => {
      if (val === null || val === undefined) return "";
      const str = typeof val === "object" ? JSON.stringify(val) : String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = [
      headers.map(escapeCsv).join(","),
      ...allData.map((row) => headers.map((h) => escapeCsv(row[h])).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "kkd_collection_export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setIsExporting(false);
    setProgress(0);
  };

  return (
    <div className="flex flex-col items-end gap-1 w-full sm:w-auto">
      <button
        type="button"
        onClick={handleExport}
        disabled={isExporting || totalCount === 0}
        className="w-full sm:w-auto px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
      >
        {isExporting ? `Exporting… ${progress}%` : "Export to CSV"}
      </button>
      {isExporting && (
        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
          <div
            className="bg-green-600 h-1.5 rounded-full transition-all duration-200 ease-out"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      )}
    </div>
  );
}
