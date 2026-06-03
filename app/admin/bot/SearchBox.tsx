"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");

  const apply = (next: string) => {
    const sp = new URLSearchParams(params.toString());
    const trimmed = next.trim();
    if (trimmed) sp.set("q", trimmed);
    else sp.delete("q");
    sp.delete("page");
    const qs = sp.toString();
    router.push(`/admin/bot${qs ? `?${qs}` : ""}`);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply(value);
      }}
      className="flex items-center gap-1"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search name or number…"
        className="px-2 py-1 text-xs rounded border border-gray-300 bg-white text-black w-44 focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />
      <button
        type="submit"
        className="px-2 py-1 text-xs rounded border bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 transition-colors"
      >
        Search
      </button>
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            apply("");
          }}
          className="px-2 py-1 text-xs rounded border bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200 transition-colors"
        >
          Clear
        </button>
      )}
    </form>
  );
}
