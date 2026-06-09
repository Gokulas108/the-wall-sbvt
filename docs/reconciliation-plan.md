# Accounting & Reconciliation Dashboard

> Implementation plan for the cross-channel accounting/reconciliation view.
> Lives in the repo (not in `~/.claude/plans/`) so it stays with the code it
> describes. Host app: **the-wall-next**.

## Context

The fundraising system spans three apps with donor money landing in **four+ places**, and there is no single view that ties them together:

- **birnagar** (Laravel/SQLite) `donations` table — general donations (`source='web'`) and wall-of-legacy-via-gateway (`source='api_*'`, also mirrored to the wall app). `txn_id` = gateway "Transaction ID".
- **the-wall-next** (Next.js/Postgres) `BlockSubmission` — Wall of Legacy donors:
  - `online_donate` (gateway: `paymentMethod="online"`, `paymentReference=txn_id`),
  - `donate` (volunteer `/donor-form`, `paymentMethod="cash"|"upi"`, UPI carries `paymentReference`),
  - `pledge` (committed, unpaid).
  - **Amount is never stored** — it is always `qty × COST_PER_NAME` (₹1000, `lib/mosaic/engine.ts:6`).
- **Two external CSVs** the user exports from bank/gateway dashboards and uploads:
  - **UPI CSV** — join `bankRRN ⇔ BlockSubmission.paymentReference` (volunteer UPI).
  - **Gateway CSV** — join `Transaction ID ⇔ BlockSubmission.paymentReference` (online) **and** `birnagar.donations.txn_id`.

**Goal:** one admin dashboard that shows every donor/contribution from every channel, reconciled against the two bank/gateway CSVs, with all the money edge cases handled (split payments, over/under-payment, orphans, refunds, pledges, cash). It must later feed the existing WhatsApp bot + pdf-server receipt/certificate flow.

### Decisions (confirmed with user)
1. **Host app:** `the-wall-next` (owns the wall DB on Postgres; has admin/auth/export scaffolding; already wired to WhatsApp bot + pdf-server).
2. **Birnagar general donations:** **live API call** on every dashboard refresh/reconcile — no background cron, always current. A thin cache keyed by birnagar's donation id is kept only so manual match links stay stable across refreshes.
3. **Scope:** build the **full system in one go** — ingestion + automatic reference matching + **manual reconciliation workbench** + breakdowns. (Receipt/certificate *sending* stays a designed forward-hook, per "later stage.")
4. **Auth:** **server-validated admin login** — reuse the donor-form PIN session (`lib/auth/donor-form.ts`), with an audit trail. Not the client-side password gate.

---

## Architecture

Hybrid: **persisted raw CSV mirrors + a persisted match table + a materialized canonical "contribution ledger" rebuilt by a batch reconciler.** Not a query-time SQL union (too expensive/unmaintainable across heterogeneous sources; reconciliation is naturally a point-in-time batch; manual overrides must persist independently).

```
birnagar (Laravel)  ──LIVE JSON API (on refresh)──►  BirnagarDonation (thin cache, stable ids)  ┐
BlockSubmission (existing, CANONICAL for wall)                                                   ├─► Reconciler ─► Contribution (materialized ledger)
DonorFormUser / CashSettlement (cash truth)                                                     ┘        │
GatewayTransaction (raw CSV)  ┐                                                                          ├─► ContributionMatch (auto + MANUAL, persisted)
UpiTransaction (raw CSV)      ┴─uploaded─► CsvUploadBatch (metadata)                                     └─► ReconcileRun (audit)
```

The ledger is a **rebuildable cache, not a source of truth** — always regenerable from raw sources + the persisted (manual) match table. All money handled internally as **integer paise** to avoid float drift; presented via existing `formatINR`.

**New code locations**
- Models → `prisma/schema.prisma`
- Reconciler → `lib/reconciliation/` (pure functions + `runReconciliation()` orchestrator in a `prisma.$transaction`)
- CSV parsers → `lib/reconciliation/parsers/{gateway,upi}.ts` (add **`papaparse`** — no CSV reader exists today; the headers have typos like `transcationType`/`refundStstus` and comma-bearing name fields)
- API → `app/api/admin/reconciliation/*`
- Pages → `app/admin/reconciliation/*`
- Birnagar bridge → new read-only route in `birnagar/routes/api.php`

---

## Data model (new Prisma models)

All amounts `*Paise Int`. Full field lists in design; key shape below.

- **GatewayTransaction** — raw gateway CSV row. `@@unique([transactionId])` (idempotent re-upload), index `rrn`, `customerMobile`, `transactionDate`. Stores `amountPaise` (gross "Transaction Amount"), `chargesPaise`, `netAmountPaise`, `status`, `reconciliationStatus`, `originalTransactionId` (refund back-pointer), computed `isSuccess`/`isRefund`, `rawRow Json`, `uploadBatchId`.
- **UpiTransaction** — raw UPI CSV row. `@@unique([merchantTranId])` (idempotency), **index `bankRRN`** (match key, not unique — an RRN can recur). Stores `amountPaise`, `status`, `refundStatus`, `customerVPA`, `contactNumber`, `payerName`, `isSuccess`/`isRefund`, `rawRow`, `uploadBatchId`.
- **BirnagarDonation** — thin cache of the live pull. `@@unique([birnagarId])` (upsert by Laravel PK so manual links stay stable), index `txnId`,`source`,`status`,`phone`. `amountPaise` (decimal rupees ×100). **Only `source='web'` rows become contributions; `source='api_*'` rows are kept only for cross-checking the wall online_donate (never promoted → no double-count).**
- **CsvUploadBatch** — `kind ('gateway'|'upi'|'birnagar_live')`, `uploadedById`, row counts, `errors Json`, `status`, `periodStart/End` (distinguishes UNVERIFIED "CSV not uploaded for this date" from "wrong ref typed").
- **Contribution** — materialized ledger, one row per contribution line. Soft pointers `blockSubmissionId @unique` / `birnagarDonationId @unique` / `cashVolunteerId`. Denormalized donor snapshot (`donorName/phone/email`, `blockId`, `serialNumber`, `qty`, `collectedByUserId`, `contributedAt`), `paymentChannel ('online'|'upi'|'cash'|'none')`, `paymentReference`. Money: `expectedPaise`, `matchedPaise`, `variancePaise`. Result: `status` (taxonomy below), `receiptEligible`, `reconciledAt`, `reconcileRunId`. Indexes: `paymentReference`, `status`, `collectedByUserId`, `blockId`, `contributedAt`.
- **ContributionMatch** — links a contribution to a CSV txn. `contributionId` nullable (null + a CSV side = **ORPHAN**). `gatewayTxnId @unique` / `upiTxnId @unique` (a CSV txn attributes to one group; idempotent). `matchType ('auto_reference'|'manual'|'auto_fuzzy_suggested')`, `amountPaise`, `confidence`, `note`, `createdById`. **Reconciler deletes/recreates only `auto_*` rows; `manual` rows are always honored.**
- **ReconcileRun** — audit: `triggeredById`, `countsByStatus Json`, `totalExpectedPaise`, `totalMatchedPaise`, timestamps.
- Add `csvUploads CsvUploadBatch[]` relation to `DonorFormUser`. `BlockSubmission` is untouched (read by id only — avoids migration risk on the hot path).

Migration: `npx prisma migrate dev --name reconciliation` (uses `DIRECT_URL`).

---

## Reconciliation algorithm (`lib/reconciliation/`)

Internally integer paise. `EXPECTED_PAISE_PER_NAME = COST_PER_NAME * 100` (import the constant — never hardcode 1000). Tolerances in `lib/reconciliation/config.ts`: any positive surplus ⇒ OVERPAID (still valid); `UNDERPAY_TOLERANCE_PAISE = 100` (≤₹1 short rounds to MATCHED). **Tolerance applied per-reference-group on summed amounts**, not per row.

1. **Build canonical set (dedup):**
   - Wall `BlockSubmission` → contributions; `expectedPaise = qty × EXPECTED_PAISE_PER_NAME`; channel from `actionType`/`paymentMethod`.
   - `BirnagarDonation where source='web'` → `general` contributions; **skip any whose `txnId` equals a wall `online_donate.paymentReference`** (defensive dedup on top of the source filter).
   - Cash: emit one `cash_bucket` contribution per volunteer (`expected = amountInCash×100`, `matched = amountSettled×100`, status `CASH`); per-row cash `donate` submissions are tagged `CASH` and **excluded from received sums** (their money is represented by the bucket+settlements — avoids cash double-count).
2. **Index CSV side:** `gatewayByTxn` (by `transactionId`), `upiByRRN` (multimap by `bankRRN`); load `manual` matches first.
3. **Group by reference, match by (channel, reference)** — online matches only `GatewayTransaction`, UPI only `UpiTransaction` (guards against a gateway txnId == a UPI RRN string collision). For each group: `expectedSum = Σ expected`; find CSV txn; then:
   - no CSV + outside every batch window → **UNVERIFIED** ("CSV not uploaded yet").
   - no CSV + inside window → **UNVERIFIED** + flag `ref_not_in_csv` (wrong ref / abandoned).
   - CSV refund or failed status → **FAILED_REFUNDED** (excluded from received).
   - UPI RRN maps to >1 row / conflicting → **AMBIGUOUS** (manual).
   - else compare `matchedSum` vs `expectedSum`: `variance==0 → MATCHED`; `>0 → OVERPAID` (track surplus); `≤ tolerance short → MATCHED`; else `UNDERPAID`. **Apportion `matchedSum` across the N donor rows pro-rata by expected** (remainder to the largest row) — handles "₹4000 = 4 names share one reference".
   - record `ContributionMatch(auto_reference)`.
   - null-reference contributions: `pledge → PLEDGE`; cash `donate → CASH`; online/upi with null ref → UNVERIFIED `missing_reference`.
4. **ORPHAN detection:** any success, non-refund CSV txn not consumed above → `ContributionMatch(contributionId=null)` → surfaces in workbench. Join orphan gateway txns to `PendingTransaction(pending|failed)` by `txnId` to label "abandoned/initiated-never-completed" vs truly unknown.
5. **Idempotent rebuild** in `prisma.$transaction`: preserve `manual` matches → upsert `Contribution` by soft key → delete+recreate `auto_*` matches → recompute status/variance → write `ReconcileRun`. Re-run on same inputs = identical output; re-upload CSV = upsert (no dupes).

**Status taxonomy:** `MATCHED | OVERPAID | UNDERPAID | UNVERIFIED | CASH | PLEDGE | FAILED_REFUNDED | ORPHAN | AMBIGUOUS`.

**Money rollups (cards):** Received(gross) = Σ matched of MATCHED/OVERPAID/UNDERPAID + cash settled; Net = gross − charges (toggle); Expected(wall); Pledged(unpaid); Surplus (Σ +variance); Shortfall (Σ −variance); Unverified ₹; Orphan ₹; Abandoned count. **Closure invariant** (strongest end-to-end check): `Σ CSV success money = Σ matched(matched groups) + Σ orphan money`.

### Edge cases covered
Split one-payment→many-donors (#group sum + pro-rata) · UPI overpay 1001/1008 (OVERPAID+surplus) · underpay (UNDERPAID) · wall/birnagar gateway double-count (source filter + txnId dedup) · cash no-CSV (bucket+settlements) · pledges (PLEDGE, excluded) · orphan money (ORPHAN) · unverified/wrong-ref (window logic) · failed/refunded (FAILED_REFUNDED, refund back-pointer netting) · duplicate/ambiguous refs (AMBIGUOUS) · re-upload idempotency (unique keys) · gross-vs-net charges (both stored) · abandoned gateway (PendingTransaction join) · phone fuzzy-match on last-10-digits only · paise rounding.

---

## Birnagar live bridge

**Laravel side** (`birnagar/routes/api.php`): add read-only `GET /api/export/donations?since=<iso>&page=` guarded by an `X-Export-Key` header constant-time-compared to a new `.env WALL_EXPORT_KEY`. Returns `{donations:[{id, source, txn_id, name, email, phone, amount, status, created_at}], nextPage}` (cursor on `id`). No writes; one small `DonationExportController`.

**Wall side** (`app/api/admin/reconciliation/birnagar-pull/route.ts`): on dashboard refresh/reconcile, fetch all pages **live**, upsert `BirnagarDonation` by `birnagarId` (rupees→paise), write a `CsvUploadBatch(kind='birnagar_live')`. Reuses the existing outbound-fetch pattern from `app/api/payment/initiate/route.ts`. Always current as of the refresh; no cron.

---

## API routes (App Router) — all `requireAdminFromRequest(req)` gated

`app/api/admin/reconciliation/`:
- `csv/upload` (POST, multipart) — papaparse → upsert raw rows → `CsvUploadBatch`; per-row errors to batch, header-shape mismatch rejects whole file.
- `birnagar-pull` (POST) — live pull (above).
- `run` (POST) — `runReconciliation()`, returns `ReconcileRun` summary.
- `summary` (GET) — card rollups from materialized `Contribution`.
- `ledger` (GET) — paginated unified ledger `?status&channel&volunteerId&blockId&q&from&to&page&pageSize` (same `{data}` shape as `app/api/admin/database/export/route.ts`).
- `ledger/export` (GET) — CSV of current filter (reuse `ExportCSVButton.tsx` page-looping writer).
- `orphans` (GET) — unmatched CSV rows + fuzzy suggestions.
- `suggest` (GET) — fuzzy candidates for an orphan (score = amount-closeness + phone last-10 match + date proximity).
- `match` (POST) — manual link/unlink/override → `ContributionMatch(matchType='manual')`, audited.
- `breakdowns` (GET) — per-volunteer / per-block / per-day `groupBy`.

---

## Dashboard UI (`app/admin/reconciliation/`)

- `page.tsx` — server component (admin-gated, §Auth), summary cards (each links to ledger pre-filtered by status, `formatINR`) + filterable ledger table.
- `workbench/page.tsx` — two-pane manual matcher: left = UNVERIFIED/AMBIGUOUS (money expected, no match), right = ORPHAN (money received, no donor). Select left → `suggest` ranked candidates → one-click "Link" → `match`; also "accept underpaid", "mark refund/duplicate", "flag follow-up".
- Client components mirroring existing ergonomics (`SendAllButton`/`ExportCSVButton`): `UploadPanel.tsx`, `RunReconButton.tsx`, `SummaryCards.tsx`, `LedgerTable.tsx`, `MatchWorkbench.tsx`. Color-coded status badges.
- Breakdown tabs: per-volunteer (expected/collected/settled/pending — reuse donor-form stats shape), per-block (filled slots vs verified money vs `NAMES_PER_BLOCK`), per-day timeline.

---

## Auth (server-validated)

Reuse `lib/auth/donor-form.ts`:
- Every reconciliation **API route**: `const admin = await requireAdminFromRequest(req); if (!admin) return 401;` (pattern from `app/api/donor-form/users/[id]/settle/route.ts`).
- **Pages**: server component checks admin session via cookie; non-admins get an "admin access required → /donor-form" panel (pattern from `app/donor-form/admin/page.tsx`). Optional Next middleware redirect for `/admin/reconciliation/*`.
- All mutations record `*ById = admin.id` (financial audit trail).
- Laravel export endpoint uses the separate static `WALL_EXPORT_KEY` header (server-to-server, no user session).

---

## Forward hook — receipt/certificate (design only, build later)

Reconciler sets `Contribution.receiptEligible = true` **iff** `status ∈ {MATCHED, OVERPAID}` **and** `actionType != 'pledge'` **and** (cash) bucket settled — the single gate that structurally prevents receipting unverified/pledge/orphan money. Refactor the URL builders in `app/api/generate-test-response/route.ts` (`buildCertificateUrl`, `buildReceiptUrl`, `numberToWords`, `formatDateOnly`) into `lib/receipts/urls.ts` (no behavior change) so a future batch "send receipts to newly-eligible contributions" job reuses them + the DoubleTick send helpers. The ledger already carries everything `buildReceiptUrl` needs (name/qty/blockId/serial/phone/email/paymentReference/contributedAt).

---

## Build order

1. Prisma models + migration; add `papaparse`.
2. `lib/reconciliation/` core (build-set, dedup, group, match, taxonomy, totals) + `test-reconcile.js` fixtures (below) — get the engine right first.
3. CSV parsers + `csv/upload` + `UploadPanel`.
4. Birnagar Laravel export route + wall `birnagar-pull`.
5. `run`/`summary`/`ledger`/`ledger/export` + dashboard page + cards + ledger table + server-session auth.
6. `orphans`/`suggest`/`match` + workbench + breakdowns.
7. Receipt seam refactor (`lib/receipts/urls.ts`) + `receiptEligible` (no sender yet).

---

## Verification (no test runner exists; use ad-hoc `node` scripts like the repo's `test-*.js`)

1. **`test-reconcile.js`** over pure functions with fixtures hitting every edge case: 1 ref→4 names=₹4000 (group sum + pro-rata), overpay ₹1008, underpay ₹900, refund row, duplicate RRN (AMBIGUOUS), orphan, unverified (no batch window), pledge, cash bucket, birnagar `web` vs `api_` dedup, paise rounding. Assert taxonomy + totals.
2. **Idempotency:** run reconcile twice → identical `countsByStatus`, no new rows; re-upload same CSV → `rowsUpdated>0, rowsInserted=0`, row count unchanged.
3. **Round-trip:** craft gateway + UPI CSVs with exact (typo-preserving) headers, upload → run → hit `summary`/`ledger`; confirm the ₹4000 group is MATCHED, a missing-ref donor is UNVERIFIED, a money-only row is ORPHAN.
4. **Manual match:** link an orphan to an unverified contribution in the workbench, re-run → manual link survives, pair clears.
5. **Auth:** every route returns 401 without `kc-donor-form-session`, 200 with an admin session.
6. **Closure invariant:** `Σ CSV success money == Σ matched(matched groups) + Σ orphan money` — no money lost or double-counted.

## Implementation notes (as built)

- **Schema applied with `prisma db push`, not `migrate dev`.** This database is not under Prisma Migrate control (`prisma/migrations` is empty; tables were created by `db push`). Running `migrate dev` would offer to reset (drop) the production DB. The 7 new tables were added with `prisma db push` after confirming via `prisma migrate diff --from-config-datasource --to-schema` that the change is additive-only (7 `CREATE TABLE`, zero drops). Use `db push` for future additive changes here too.
- **Two env vars to set** (untracked, both sides share the same secret):
  - `birnagar/.env`: `WALL_EXPORT_KEY=<secret>` (read via `config('services.wall.export_key')`).
  - `the-wall-next/.env.local`: `WALL_EXPORT_KEY=<same secret>`, and optionally `BIRNAGAR_BASE_URL` (defaults to `https://birnagar.org`) for dev.
- **Pure modules are single-file with zero internal imports** (`lib/reconciliation/engine.ts`, `lib/reconciliation/parsers.ts`) so Node's type-stripping can run the root scratch tests directly: `node test-reconcile.ts` (66 assertions) and `node test-parsers.ts` (25 assertions). `papaparse` is the parsers' only external import. `tsconfig.json` excludes `test-*.ts` from the build typecheck.
- **The orchestrator (`lib/reconciliation/run.ts`) is the only place that imports `COST_PER_NAME`** (→ `EXPECTED_PAISE_PER_NAME`) and Prisma; the engine works purely on caller-supplied paise.
- **Pages are server components** gated by `getCurrentUserFromServerCookies()`; every API route is gated by `requireAdminFromRequest`. Light Tailwind theme (not the donor-form dark theme) for table readability.
- **Receipt seam:** URL builders extracted to `lib/receipts/urls.ts` and re-imported by the WhatsApp bot (`app/api/generate-test-response/route.ts`) with no behavior change. `Contribution.receiptEligible` is set by the engine (`status ∈ {MATCHED, OVERPAID}` and not a pledge); no sender wired yet.

## Critical files
- `the-wall-next/prisma/schema.prisma` — new models + migration
- `the-wall-next/lib/mosaic/engine.ts` — `COST_PER_NAME` / `NAMES_PER_BLOCK` (amount authority; import, never hardcode)
- `the-wall-next/lib/auth/donor-form.ts` — `requireAdminFromRequest` reuse (auth)
- `the-wall-next/app/api/donor-form/users/[id]/settle/route.ts` — admin-gated route pattern to mirror
- `the-wall-next/app/api/admin/database/export/route.ts` + `app/admin/database/ExportCSVButton.tsx` — paginated `{data}` + CSV export pattern
- `the-wall-next/app/api/generate-test-response/route.ts` — receipt/cert URL builders to extract (forward hook)
- `the-wall-next/app/api/payment/initiate/route.ts` — outbound server-to-server fetch pattern (birnagar pull)
- `birnagar/routes/api.php` + new `DonationExportController` — live export endpoint
