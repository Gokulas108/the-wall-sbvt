import { prisma } from "@/lib/db/prisma";
import Link from "next/link";
import { ExportCSVButton } from "./ExportCSVButton";
import { DatabaseAuthWrapper } from "./AuthWrapper";

function getPagination(currentPage: number, totalPages: number) {
  const pages: (number | string)[] = [];
  const delta = 2; // how many pages beside current page

  if (totalPages <= 1) return pages;

  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 ||
      i === totalPages ||
      (i >= currentPage - delta && i <= currentPage + delta)
    ) {
      pages.push(i);
    } else if (
      (i === currentPage - delta - 1) ||
      (i === currentPage + delta + 1)
    ) {
      pages.push("...");
    }
  }

  return pages.filter((p, index, arr) => {
    if (p === "..." && arr[index - 1] === "...") {
      return false;
    }
    return true;
  });
}

export default async function AdminDatabasePage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await props.searchParams;
  const table = typeof searchParams.table === "string" ? searchParams.table : "block_submissions";
  const pageStr = typeof searchParams.page === "string" ? searchParams.page : "1";
  let page = parseInt(pageStr, 10);
  if (isNaN(page) || page < 1) {
    page = 1;
  }
  const pageSize = 100;

  let data: any[] = [];
  let totalCount = 0;

  try {
    if (table === "block_submissions") {
      [data, totalCount] = await Promise.all([
        prisma.blockSubmission.findMany({
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.blockSubmission.count(),
      ]);
    } else if (table === "donor_form_users") {
      [data, totalCount] = await Promise.all([
        prisma.donorFormUser.findMany({
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.donorFormUser.count(),
      ]);
    } else if (table === "cash_settlements") {
      [data, totalCount] = await Promise.all([
        prisma.cashSettlement.findMany({
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.cashSettlement.count(),
      ]);
    }
  } catch (error) {
    console.error("Error fetching data:", error);
  }

  const totalPages = Math.ceil(totalCount / pageSize);
  const paginationPages = getPagination(page, totalPages);
  const tables = ["block_submissions", "donor_form_users", "cash_settlements"];

  return (
    <DatabaseAuthWrapper>
      <div className="mx-auto p-2 sm:p-4 text-black min-h-screen bg-white">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 pb-2 border-b gap-3">
          <div>
            <h1 className="text-xl font-bold text-indigo-900">
              Database Viewer
            </h1>
            <p className="text-gray-500 text-xs mt-1">
              Viewing {totalCount} records ({pageSize} per page)
            </p>
          </div>
          <div className="w-full sm:w-auto">
            <ExportCSVButton table={table} totalCount={totalCount} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {tables.map((t) => (
            <Link
              key={t}
              href={`/admin/database?table=${t}`}
              className={`px-3 py-1 text-xs rounded border transition-colors ${
                t === table
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300"
              }`}
            >
              {t.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")}
            </Link>
          ))}
        </div>

        <div className="border border-gray-400 overflow-x-auto bg-gray-50 max-h-[70vh] shadow-sm">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead className="bg-gray-200 sticky top-0 z-10 shadow-sm border-b-2 border-gray-400">
              <tr>
                {data.length > 0 ? (
                  Object.keys(data[0]).map((key) => (
                    <th
                      key={key}
                      className="p-1 px-2 border-r border-gray-400 font-semibold whitespace-nowrap"
                    >
                      {key}
                    </th>
                  ))
                ) : (
                  <th className="p-2 border-r border-gray-400 font-semibold text-center text-gray-500">
                    Select a table or make sure table has records
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr
                  key={row.id || i}
                  className="hover:bg-indigo-50 border-b border-gray-300 transition-colors odd:bg-white even:bg-gray-50"
                >
                  {Object.values(row).map((val: any, j) => (
                    <td
                      key={j}
                      className="p-1 px-2 border-r border-gray-300 max-w-[150px] sm:max-w-[200px] whitespace-nowrap overflow-hidden text-ellipsis"
                      title={
                        val instanceof Date
                          ? val.toLocaleString()
                          : typeof val === "object" && val !== null
                          ? JSON.stringify(val)
                          : String(val)
                      }
                    >
                      {val instanceof Date
                        ? val.toLocaleString()
                        : typeof val === "object" && val !== null
                        ? JSON.stringify(val)
                        : String(val)}
                    </td>
                  ))}
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td className="p-4 text-center text-gray-500 italic border-gray-300">
                    No records found in the "{table}" table.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 0 && (
          <div className="flex flex-col sm:flex-row justify-between items-center mt-4 p-2 bg-gray-50 border border-gray-300 rounded text-xs gap-4 shadow-sm">
            
            <div className="flex items-center gap-1 overflow-x-auto max-w-full pb-1 sm:pb-0 scrollbar-hide">
              <Link
                href={`/admin/database?table=${table}&page=1`}
                className={`px-2 py-1 rounded border whitespace-nowrap transition-colors ${
                  page <= 1
                    ? "opacity-50 cursor-not-allowed bg-gray-200 pointer-events-none border-gray-300 text-gray-500"
                    : "bg-white hover:bg-gray-100 border-gray-300 text-indigo-600"
                }`}
                aria-disabled={page <= 1}
                tabIndex={page <= 1 ? -1 : undefined}
              >
                First
              </Link>
              <Link
                href={`/admin/database?table=${table}&page=${page > 1 ? page - 1 : 1}`}
                className={`px-2 py-1 rounded border whitespace-nowrap transition-colors mr-1 ${
                  page <= 1
                    ? "opacity-50 cursor-not-allowed bg-gray-200 pointer-events-none border-gray-300 text-gray-500"
                    : "bg-white hover:bg-gray-100 border-gray-300 text-indigo-600"
                }`}
                aria-disabled={page <= 1}
                tabIndex={page <= 1 ? -1 : undefined}
              >
                Prev
              </Link>

              {paginationPages.map((p, idx) => 
                p === "..." ? (
                  <span key={`ellipsis-${idx}`} className="px-2 py-1 text-gray-500">...</span>
                ) : (
                  <Link
                    key={p}
                    href={`/admin/database?table=${table}&page=${p}`}
                    className={`px-2 py-1 rounded border min-w-[28px] text-center transition-colors ${
                      p === page
                        ? "bg-indigo-600 text-white border-indigo-600 font-bold"
                        : "bg-white hover:bg-gray-100 border-gray-300 text-gray-700"
                    }`}
                  >
                    {p}
                  </Link>
                )
              )}

              <Link
                href={`/admin/database?table=${table}&page=${page < totalPages ? page + 1 : totalPages}`}
                className={`px-2 py-1 rounded border whitespace-nowrap transition-colors ml-1 ${
                  page >= totalPages
                    ? "opacity-50 cursor-not-allowed bg-gray-200 pointer-events-none border-gray-300 text-gray-500"
                    : "bg-white hover:bg-gray-100 border-gray-300 text-indigo-600"
                }`}
                aria-disabled={page >= totalPages}
                tabIndex={page >= totalPages ? -1 : undefined}
              >
                Next
              </Link>
              <Link
                href={`/admin/database?table=${table}&page=${totalPages}`}
                className={`px-2 py-1 rounded border whitespace-nowrap transition-colors ${
                  page >= totalPages
                    ? "opacity-50 cursor-not-allowed bg-gray-200 pointer-events-none border-gray-300 text-gray-500"
                    : "bg-white hover:bg-gray-100 border-gray-300 text-indigo-600"
                }`}
                aria-disabled={page >= totalPages}
                tabIndex={page >= totalPages ? -1 : undefined}
              >
                Last
              </Link>
            </div>
            
            <div className="text-gray-600 whitespace-nowrap font-medium">
              Page {page} of {totalPages}
            </div>
          </div>
        )}
      </div>
    </DatabaseAuthWrapper>
  );
}
