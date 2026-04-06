"use client";

import { useState } from "react";

export function ExportCSVButton({ table, totalCount }: { table: string; totalCount: number }) {
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleExport = async () => {
    if (isExporting || totalCount === 0) return;
    setIsExporting(true);
    setProgress(0);

    const pageSize = 1000;
    const totalPages = Math.ceil(totalCount / pageSize);
    let allData: any[] = [];

    for (let page = 1; page <= totalPages; page++) {
      try {
        const res = await fetch(`/api/admin/database/export?table=${table}&page=${page}&pageSize=${pageSize}`);
        if (!res.ok) throw new Error("Failed to fetch page " + page);
        const json = await res.json();
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

    // Convert to CSV
    const headers = Object.keys(allData[0]);
    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return "";
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = [
      headers.map(escapeCsv).join(","),
      ...allData.map(row => headers.map(h => escapeCsv(row[h])).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${table}_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setIsExporting(false);
    setProgress(0);
  };

  return (
    <div className="flex flex-col items-end gap-1 w-full sm:w-auto">
      <button
        onClick={handleExport}
        disabled={isExporting || totalCount === 0}
        className="w-full sm:w-auto px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
      >
        {isExporting ? `Exporting... ${progress}%` : "Export to CSV"}
      </button>
      {isExporting && (
        <div className="w-full bg-gray-200 rounded-full h-1.5 dark:bg-gray-300 mt-1">
          <div 
            className="bg-green-600 h-1.5 rounded-full transition-all duration-200 ease-out" 
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      )}
    </div>
  );
}
