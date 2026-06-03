import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { DatabaseAuthWrapper } from "@/app/admin/database/AuthWrapper";
import { formatINR } from "@/lib/mosaic/engine";
import { SendButton } from "./SendButton";
import { SendAllButton } from "./SendAllButton";
import { SearchBox } from "./SearchBox";

const PAGE_SIZE = 100;

type Filters = { sent: string; balance: string; q: string };

const SENT_OPTIONS = [
  { value: "all", label: "All" },
  { value: "yes", label: "Sent" },
  { value: "no", label: "Pending" },
];

const BALANCE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Balance due" },
  { value: "done", label: "Fully received" },
];

function getPagination(currentPage: number, totalPages: number) {
  const pages: (number | string)[] = [];
  const delta = 2;

  if (totalPages <= 1) return pages;

  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 ||
      i === totalPages ||
      (i >= currentPage - delta && i <= currentPage + delta)
    ) {
      pages.push(i);
    } else if (i === currentPage - delta - 1 || i === currentPage + delta + 1) {
      pages.push("...");
    }
  }

  return pages.filter((p, index, arr) => {
    if (p === "..." && arr[index - 1] === "...") return false;
    return true;
  });
}

function buildHref(
  filters: Filters,
  page: number,
  overrides: Partial<Filters & { page: number }> = {},
) {
  const merged = { ...filters, page, ...overrides };
  const sp = new URLSearchParams();
  if (merged.sent && merged.sent !== "all") sp.set("sent", merged.sent);
  if (merged.balance && merged.balance !== "all") sp.set("balance", merged.balance);
  if (merged.q) sp.set("q", merged.q);
  if (merged.page > 1) sp.set("page", String(merged.page));
  const qs = sp.toString();
  return `/admin/bot${qs ? `?${qs}` : ""}`;
}

export default async function AdminBotPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await props.searchParams;
  const sent =
    typeof searchParams.sent === "string" &&
    SENT_OPTIONS.some((o) => o.value === searchParams.sent)
      ? searchParams.sent
      : "all";
  const balance =
    typeof searchParams.balance === "string" &&
    BALANCE_OPTIONS.some((o) => o.value === searchParams.balance)
      ? searchParams.balance
      : "all";
  const q = typeof searchParams.q === "string" ? searchParams.q.trim() : "";
  const filters: Filters = { sent, balance, q };

  let page =
    typeof searchParams.page === "string" ? parseInt(searchParams.page, 10) : 1;
  if (isNaN(page) || page < 1) page = 1;

  const where: Prisma.KkdCollectionWhereInput = {};
  if (sent === "yes") where.messageSent = true;
  else if (sent === "no") where.messageSent = false;
  if (balance === "pending") {
    where.amtReceived = { lt: prisma.kkdCollection.fields.amtCommitted };
  } else if (balance === "done") {
    where.amtReceived = { gte: prisma.kkdCollection.fields.amtCommitted };
  }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { whatsapp: { contains: q } },
    ];
  }

  const [rows, totalCount, pendingCount] = await Promise.all([
    prisma.kkdCollection.findMany({
      where,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy: { id: "asc" },
    }),
    prisma.kkdCollection.count({ where }),
    prisma.kkdCollection.count({ where: { messageSent: false } }),
  ]);

  const whatsappList = rows.map((r) => r.whatsapp);
  const intakes = whatsappList.length
    ? await prisma.whatsAppIntake.findMany({
        where: { phone: { in: whatsappList } },
        select: { phone: true, legalName: true, address: true },
      })
    : [];
  const intakeByPhone = new Map(intakes.map((i) => [i.phone, i]));

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const paginationPages = getPagination(page, totalPages);

  const headers = [
    "Name",
    "WhatsApp",
    "Committed",
    "Received",
    "Messaged",
    "Last Messaged",
    "Legal Name",
    "Address",
    "Action",
  ];

  return (
    <DatabaseAuthWrapper>
      <div className="mx-auto p-2 sm:p-4 text-black min-h-screen bg-white">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 pb-2 border-b gap-3">
          <div>
            <h1 className="text-xl font-bold text-indigo-900">Bot Dashboard</h1>
            <p className="text-gray-500 text-xs mt-1">
              KKD collection tracking · {totalCount} rows · {pendingCount}{" "}
              pending
            </p>
          </div>
          <div className="w-full sm:w-auto">
            <SendAllButton pendingCount={pendingCount} />
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <FilterGroup
              label="Messaged"
              options={SENT_OPTIONS}
              current={sent}
              build={(value) => buildHref(filters, 1, { sent: value, page: 1 })}
            />
            <FilterGroup
              label="Payment"
              options={BALANCE_OPTIONS}
              current={balance}
              build={(value) =>
                buildHref(filters, 1, { balance: value, page: 1 })
              }
            />
            <SearchBox />
          </div>
          {(sent !== "all" || balance !== "all" || q) && (
            <div>
              <Link
                href="/admin/bot"
                className="text-xs text-indigo-600 hover:underline"
              >
                Clear filters
              </Link>
            </div>
          )}
        </div>

        <div className="border border-gray-400 overflow-x-auto bg-gray-50 max-h-[70vh] shadow-sm">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead className="bg-gray-200 sticky top-0 z-10 shadow-sm border-b-2 border-gray-400">
              <tr>
                {headers.map((key) => (
                  <th
                    key={key}
                    className="p-1 px-2 border-r border-gray-400 font-semibold whitespace-nowrap"
                  >
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const intake = intakeByPhone.get(row.whatsapp);
                return (
                  <tr
                    key={row.id}
                    className="hover:bg-indigo-50 border-b border-gray-300 transition-colors odd:bg-white even:bg-gray-50"
                  >
                    <td className="p-1 px-2 border-r border-gray-300 whitespace-nowrap">
                      {row.name}
                    </td>
                    <td className="p-1 px-2 border-r border-gray-300 whitespace-nowrap">
                      {row.whatsapp}
                    </td>
                    <td className="p-1 px-2 border-r border-gray-300 whitespace-nowrap">
                      ₹{formatINR(row.amtCommitted)}
                    </td>
                    <td className="p-1 px-2 border-r border-gray-300 whitespace-nowrap">
                      ₹{formatINR(row.amtReceived)}
                    </td>
                    <td className="p-1 px-2 border-r border-gray-300 whitespace-nowrap">
                      {row.messageSent ? (
                        <span className="text-green-700 font-medium">Yes</span>
                      ) : (
                        <span className="text-gray-400">No</span>
                      )}
                    </td>
                    <td className="p-1 px-2 border-r border-gray-300 whitespace-nowrap">
                      {row.messageSentAt
                        ? row.messageSentAt.toLocaleString()
                        : "—"}
                    </td>
                    <td
                      className="p-1 px-2 border-r border-gray-300 max-w-[150px] sm:max-w-[200px] whitespace-nowrap overflow-hidden text-ellipsis"
                      title={intake?.legalName ?? ""}
                    >
                      {intake?.legalName ?? "—"}
                    </td>
                    <td
                      className="p-1 px-2 border-r border-gray-300 max-w-[150px] sm:max-w-[200px] whitespace-nowrap overflow-hidden text-ellipsis"
                      title={intake?.address ?? ""}
                    >
                      {intake?.address ?? "—"}
                    </td>
                    <td className="p-1 px-2 border-r border-gray-300 whitespace-nowrap">
                      <SendButton
                        whatsapp={row.whatsapp}
                        name={row.name}
                        alreadySent={row.messageSent}
                      />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={headers.length}
                    className="p-4 text-center text-gray-500 italic border-gray-300"
                  >
                    No rows match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 0 && (
          <div className="flex flex-col sm:flex-row justify-between items-center mt-4 p-2 bg-gray-50 border border-gray-300 rounded text-xs gap-4 shadow-sm">
            <div className="flex items-center gap-1 overflow-x-auto max-w-full pb-1 sm:pb-0">
              <Link
                href={buildHref(filters, 1)}
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
                href={buildHref(filters, page > 1 ? page - 1 : 1)}
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
                  <span
                    key={`ellipsis-${idx}`}
                    className="px-2 py-1 text-gray-500"
                  >
                    ...
                  </span>
                ) : (
                  <Link
                    key={p}
                    href={buildHref(filters, p as number)}
                    className={`px-2 py-1 rounded border min-w-[28px] text-center transition-colors ${
                      p === page
                        ? "bg-indigo-600 text-white border-indigo-600 font-bold"
                        : "bg-white hover:bg-gray-100 border-gray-300 text-gray-700"
                    }`}
                  >
                    {p}
                  </Link>
                ),
              )}

              <Link
                href={buildHref(filters, page < totalPages ? page + 1 : totalPages)}
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
                href={buildHref(filters, totalPages)}
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

function FilterGroup({
  label,
  options,
  current,
  build,
}: {
  label: string;
  options: { value: string; label: string }[];
  current: string;
  build: (value: string) => string;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-gray-500 font-medium mr-1">{label}:</span>
      {options.map((o) => (
        <Link
          key={o.value}
          href={build(o.value)}
          className={`px-2 py-1 text-xs rounded border transition-colors ${
            o.value === current
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300"
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
