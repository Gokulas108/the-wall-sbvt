@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack & version pinning

- **Next.js 16.2 (App Router) + React 19.2** — APIs, conventions and file structure may differ from older training data. Before writing non-trivial Next/React code, consult `node_modules/next/dist/docs/` per `AGENTS.md`.
- **Prisma 7** with the `@prisma/adapter-pg` driver against **PostgreSQL** (Supabase). `@libsql/client` is also installed but the active adapter is Postgres.
- **Tailwind v4** via `@tailwindcss/postcss` (no `tailwind.config.*` — utilities + theme live in `app/globals.css`).
- **`@chenglou/pretext`** plus a custom binary-search fitter (`lib/mosaic/font-fitter.ts`) drive the mosaic typography.

## Commands

```bash
npm run dev      # next dev — uses .env.local; allowedDevOrigins includes 192.168.8.17 for LAN testing
npm run build    # prisma generate && next build
npm run start    # next start
npm run lint     # eslint (flat config in eslint.config.mjs)
```

There is no test runner configured; the `test-*.js` files at the repo root are ad-hoc scratch scripts run with plain `node`, not part of a suite.

### Database / Prisma

`prisma.config.ts` loads `.env` then overrides with `.env.local`, and routes migrations through `DIRECT_URL` while the runtime client uses pooled `DATABASE_URL`. When running migrations, use `DIRECT_URL` (port 5432); the app itself connects via pgBouncer on 6543.

```bash
npx prisma migrate dev --name <change>
npx prisma migrate deploy
npx prisma studio
```

`prisma generate` runs automatically on `postinstall` and on `build`.

## Architecture

### The mosaic domain model

The product is a **10×10 wall** (`GRID_SIZE = 10`) of blocks named `A1`–`J10` (`blockId(row,col)` / `parseBlockId` in `lib/mosaic/engine.ts`). Each block holds **150 names** (`NAMES_PER_BLOCK`) at **₹1000 per name** (`COST_PER_NAME`), giving a fundraising goal of ₹15,00,00,000. These constants are the source of truth — never hardcode the numbers; import from `lib/mosaic/engine.ts`.

`StencilBlock` renders each cell of `/public/sbvt.jpg` (the underlying portrait) so that filled donor slots reveal the corresponding fragment of the image, while empty slots show greyed mantra text. `MosaicGrid` composes 100 `StencilBlock`s with a single shared image origin so the picture aligns across the grid.

### Surfaces (App Router routes)

- `/` → redirects to `/the-main-screen`
- `/the-main-screen` — public projector view of the wall (password-gated client-side via `PAGE_PASSWORD`)
- `/web-app` — interactive donor experience (search, donate, pledge); the current production surface
- `/wall-frame` — **work-in-progress rewrite of `/web-app`**; new code for the donor-facing experience should land here, not in `/web-app`
- `/donor-form` — in-person volunteer/admin form; PIN auth (see below)
- `/donor-form/admin`, `/donor-form/stats/[user_id]` — back-office for cash settlement and per-volunteer stats
- `/payment/result`, `/complete-pledge`, `/web-app/receipt` — post-payment landing pages
- `/admin/database` — read-only DB browser/exporter, gated by `AuthWrapper.tsx`

### API routes (under `app/api/`)

- `blocks/` — `GET /api/blocks` returns a per-block summary; `[id]/names`, `[id]/donate`, `[id]/pledge` are the per-block read/write endpoints. Mutations run inside `prisma.$transaction(..., { isolationLevel: Serializable })` and re-check capacity against `NAMES_PER_BLOCK` before inserting.
- `events/` — Server-Sent Events stream. `GET` opens a `ReadableStream`, sends a 30 s heartbeat, and forwards `donor:added` events from the global `eventBus`.
- `donor-form/{login,logout,me,users}/` — PIN session auth (see *Auth*).
- `payment/{prepare,initiate,confirm,result-lookup,pending}/` — see *Payment flow*.
- `webhooks/payment/route.ts` — server-to-server webhook from `birnagar.org`; the only place `online_donate` rows are created.
- `admin/database/export/` — CSV dump for the database browser page.
- `donors/`, `search/`, `font-cache/` — lookup utilities used by the public surfaces.

### Live updates

`lib/events/emitter.ts` is a **process-global singleton event bus** stashed on `globalThis` so it survives Next's hot reloads in dev. Any mutation that should appear live must `eventBus.emit('donor:added', …)`. Browsers subscribe through `hooks/useSSE.ts`, which reconnects with a 3 s back-off on error and ignores comment-only heartbeat frames. Note: this only works within a single Node process — if you ever scale beyond one instance, swap the emitter for an external pub/sub.

### Payment flow (online)

1. Client calls `POST /api/payment/prepare` with `{block_id, name, amount, raw_key}`. Server returns an HMAC `token` over `block|name|amount|ts` and a `key_hash = HMAC(raw_key, PAYMENT_HMAC_SECRET)`. The raw key stays in `sessionStorage`; only the hash travels in the redirect URL as `api_<key_hash>`.
2. A `PendingTransaction` row is recorded (see `payment/pending`) keyed on the raw `apiKey`.
3. Client redirects to the external gateway hosted at `birnagar.org` (proxied through `POST /api/payment/initiate`).
4. After payment, the gateway POSTs to `/api/webhooks/payment` with `{api_key, txn_id, status}`. The webhook:
   - Rejects requests whose host/origin isn't in `ALLOWED_ORIGINS` (localhost is exempt for dev).
   - Looks up the matching pending row by re-HMAC'ing each stored `apiKey` and comparing to the received hash.
   - Atomically (`Serializable`) creates `BlockSubmission` + `BlockName`, marks the pending row `completed`, and emits `donor:added`.
   - Treats already-completed `txn_id`s as success for **idempotency** — the gateway may retry.

`PAYMENT_HMAC_SECRET` is required in the environment; the fallback string in code is for local dev only and must not be relied on in production.

### Auth (donor-form)

`lib/auth/donor-form.ts` implements PIN-based sessions:

- 4-digit PINs, SHA-256 hashed (no bcrypt — by design for low-friction in-person use).
- Sessions stored in `donor_form_sessions` with a 12 h TTL; session token in cookie `kc-donor-form-session` (`httpOnly`, `sameSite=lax`, `secure` in production).
- `ensureDefaultAdminUser()` seeds an admin from `DONOR_FORM_DEFAULT_ADMIN_USERNAME` / `DONOR_FORM_DEFAULT_ADMIN_PIN` only when the users table is empty.
- Use `getCurrentUserFromRequest(req)` in route handlers and `requireAdminFromRequest(req)` for admin-only endpoints.
- Volunteer cash totals (`amountInCash`, `amountTotal`, `amountSettled`) are incremented on each `donate` and reconciled through `CashSettlement` rows.

### Client data layer

`hooks/useBlockData.ts` is the single client-side store for the wall: it bulk-fetches `/api/blocks`, hydrates each block's names with bounded concurrency (`LOAD_CONCURRENCY = 8`), and exposes `addName`, `deleteName`, `submitDonation`, `submitPledge`, `findSuggested`, etc. Mutations replace the per-block entry in a `Map<string, BlockData>` to keep React renders cheap. SSE pushes from `/api/events` should call back into this hook (typically via `fetchBlock(id)`) to refresh the affected block.

## Environment

Required env vars (loaded from `.env.local` in dev; `prisma.config.ts` reads both `.env` and `.env.local`):

- `DATABASE_URL` — pooled Supabase connection (port 6543, `pgbouncer=true`); used at runtime.
- `DIRECT_URL` — direct connection (port 5432); used by Prisma migrations.
- `PAYMENT_HMAC_SECRET` — required for payment token + webhook signature verification.
- `DONOR_FORM_DEFAULT_ADMIN_USERNAME`, `DONOR_FORM_DEFAULT_ADMIN_PIN` — seed values for the first admin (only used when the user table is empty).
- `GROQ_API_KEY` — Groq API key for the WoL WhatsApp intake LLM (`lib/whatsapp/groq.ts`): name/address/PAN/receipt-choice extraction + intent classification + grounded `birnagar.md` Q&A. If unset, extraction degrades to politely re-asking (the flow never breaks).
- `GROQ_MODEL` — optional; defaults to `llama-3.1-8b-instant`.

## Conventions worth knowing

- Path alias `@/*` maps to the repo root (`tsconfig.json`).
- Currency is rendered via `formatINR` (Indian digit grouping); always go through it instead of `toLocaleString` ad-hoc.
- All wall capacity checks must guard against `NAMES_PER_BLOCK` *inside* the Prisma transaction — concurrent in-person and online donations can race.
- Treat the global `eventBus` and the global `prisma` client (`lib/db/prisma.ts`) as deliberate singletons; both are reattached to `globalThis` to survive Next's dev hot-reload.
