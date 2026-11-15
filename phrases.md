# BridgeWise — Implementation Phases

BridgeWise is an offline-first, mobile PWA back-office for WhatsApp social-commerce vendors (Nigeria first). It sits **beside** WhatsApp: capture messy chat, parse it, confirm a sale, then deduct stock and split capital vs profit. The 3-tab shell is **Order Stream**, **Stock Room**, and **Pocket Statement**. Dexie/IndexedDB is the source of truth; Gemini and Supabase are optional online helpers.

**Invariant (HARD):** Parse, paste, share-target, and AI extraction **must not** deduct inventory or write ledger/profit. Only an explicit vendor **Confirm Sale** (atomic Dexie transaction) may mutate stock, `ledger_entries`, and the daily pocket statement. Window shoppers stay `PENDING` with `ledger_committed: false`.

Full product and stack context: see `README.md` (when present) plus:

- `docs/bridgewise_tech_stack_architecture_documentation.md`
- `docs/BridgeWise_Full_System_And_UI_Architecture.pdf`
- `docs/BridgeWise_PWA_Architecture_Blueprint.docx`
- `docs/BridgeWise_Capture_And_State_Architecture.docx`
- `docs/Bridgewise_Company_Foundation_Phase_1(1).docx`

**Out of scope for this product:** WhatsApp Business API, Stripe, maps, Nest, GraphQL. No login wall on the core app.

## Phase index

| # | Phase | Gate |
|---|--------|------|
| 0 | Prerequisites / tooling | Node, Git, Gemini key later |
| 1 | Create Next.js 15 project | Pin `create-next-app@15` |
| 2 | Domain types | Orders, SKUs, ledger, customers |
| 3 | Mobile 3-tab shell | Bottom nav, no business logic yet |
| 4 | Dexie local DB | Stores + deterministic IDs |
| 5 | Atomic transaction engine | **HARD GATE** — confirm-only commits |
| 6 | Stock Room | Green / Yellow / Red |
| 7 | Order Stream | Amber pending vs green confirmed |
| 8 | Pocket Statement | Sales / capital / net profit |
| 9 | Share Target + clipboard capture | OS share + `readText()` |
| 10 | Gemini parse API | `gemini-2.5-flash` server-side only |
| 11 | Customer identity directory | 3-tier name resolution |
| 12 | Expenses + restock | Text (voice-as-text stretch) |
| 13 | WhatsApp receipt share | Web Share, not WA Business API |
| 14 | PWA / service worker / offline queue | `@ducanh2912/next-pwa` |
| 15 | Optional Supabase auth + sync | Add `@supabase/supabase-js` here |
| 16 | 72h archive, RED block, returns, velocity | State-machine completeness |
| 17 | Polish | Mobile UX, Naira, status bar |
| 18 | Testing | Invariant + atomicity tests |
| 19 | Vercel deploy | HTTPS for SW + clipboard |

---

## Phase 0 — Prerequisites / tooling

### Goal

A machine that can scaffold Next.js 15, run a local HTTPS-capable later deploy, and hold secrets without committing them.

### Prerequisites

- Linux/macOS or WSL; Git; a browser (Chrome recommended for PWA/share-target testing).
- Node.js 20 LTS (or 22). npm ships with Node.

### Concrete steps

1. Confirm tooling:

   ```bash
   node -v   # v20+
   npm -v
   git --version
   ```

2. Create a Google AI Studio key for **Gemini** (used only from Phase 10). Do **not** put it in client code.
3. Optional: create a Supabase project (used only in Phase 15).
4. Work in `/home/vahalla/Desktop/Bridge_wise_app` (or a `bridgewise-pwa/` subfolder if you prefer a clean scaffold).
5. Plan `.env.local` (create empty later; never commit):

   ```env
   GEMINI_API_KEY=
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   ```

### Definition of done

Node/npm work; you know where secrets will live; you have **not** installed WhatsApp Business, Stripe, or a second backend.

### Maps to

Tech stack §5 env vars; Company Foundation Phase 1 (SaaS identity, simplicity); PWA blueprint “zero download friction.”

---

## Phase 1 — Create Next.js 15 project (“next5.js”)

### Goal

A **Next.js 15** App Router app with TypeScript, Tailwind, ESLint, and `src/`.

### Prerequisites

Phase 0.

### Concrete steps

1. Pin the scaffolder to **15** (do not use unpinned `@latest` if it would pull 16+):

   ```bash
   npx create-next-app@15 bridgewise-pwa --typescript --tailwind --eslint --app --src-dir
   cd bridgewise-pwa
   ```

   If the repo root **is** already the app, scaffold into `.` only when the directory is empty enough for create-next-app, or copy the generated tree in.

2. Core packages (not Supabase yet):

   ```bash
   npm install dexie dexie-react-hooks @ducanh2912/next-pwa lucide-react @google/genai
   ```

3. Create `.env.local` from Phase 0 keys (Gemini can wait until Phase 10). Add `.env*.local` to `.gitignore` if missing.
4. Align with the documented tree (create empty folders now):

   ```text
   src/app/api/parse/
   src/app/share-target/
   src/components/{capture,orders,inventory,finance}/
   src/lib/{db,ai,sync}/
   src/types/
   public/icons/
   ```

5. `npm run dev` and open `http://localhost:3000`.

### Definition of done

`package.json` shows Next **15.x**; App Router under `src/app`; Tailwind works; Dexie/PWA/Gemini/Lucide installed; **no** `@supabase/supabase-js` yet.

### Maps to

Tech stack §2–3, §6 getting started; PWA blueprint Layer 1.

---

## Phase 2 — Domain types

### Goal

TypeScript is the contract for the two-stage state machine: pending never looks like a sale.

### Prerequisites

Phase 1.

### Concrete steps

1. Add `src/types/bridgewise.ts` with at least:

   - `OrderStatus`: `PENDING_INQUIRY` | `READY_TO_CONFIRM` | `CONFIRMED_SALE` | `CANCELLED` | `EXPIRED` | `REFUNDED`
   - `Order`: `order_id`, `customer_name`, `items[]`, `delivery_address`, `status`, `ledger_committed: boolean`, `capture_method`, `date_key`, `seq`, `intent_classification?`, `payment_signal_detected?`
   - `OrderLine`: `product_id`, `product_name`, `quantity`, `unit_cost_price`, `unit_selling_price`
   - `Sku`: `sku_id`, `display_name`, `stock_qty`, `low_stock_threshold`, `unit_cost_price`, `unit_selling_price`, `status_color: 'GREEN' | 'YELLOW' | 'RED'`
   - `LedgerEntry`: `txn_id`, `ref_order_id?`, `entry_type: 'SALE' | 'EXPENSE' | 'RESTOCK' | 'RETURN'`, `gross_amount`, `capital_portion`, `net_profit_portion`
   - `DailyStatement`: `date_key`, `total_sales`, `total_expenses`, `protected_capital`, `net_profit`
   - `Customer`: `customer_id`, `name`, `saved_addresses[]`, `preferences`
   - `ParseResult` matching the capture-doc JSON (`status` always starts pending, `ledger_committed: false`)

2. Document ID rules in comments (implement generators in Phase 4):

   | Store | ID |
   |-------|-----|
   | orders | `[Customer]_[YYYY-MM-DD]_[Seq]` e.g. `Chioma_2026-11-12_Ord004` |
   | inventory | `[Product_Slug]_[Variant]` e.g. `Black_Shoes_Size42` |
   | ledger_entries | `TXN_[YYYY-MM-DD]_[Type]_[Seq]` |
   | daily_statements | `Daily_Summary_[YYYY-MM-DD]` |
   | customers | `CUST_[Phone_or_NameHash]` e.g. `CUST_Chioma_Nwosu` |

3. Export a helper type `ConfirmableOrder` = order with `ledger_committed === false` and status pending/ready.

### Definition of done

No UI required. Types compile; `ledger_committed` is required on orders; parse payloads cannot be typed as committed sales.

### Maps to

Full System §3 data stores; Capture & State §2–3 JSON schema; tech stack TypeScript row.

---

## Phase 3 — Mobile 3-tab shell

### Goal

One-handed mobile chrome: top status/capture strip + **three tabs** + placeholder content. No Dexie writes yet.

### Prerequisites

Phase 2 (types can be imported for tab labels only).

### Concrete steps

1. `src/app/layout.tsx`: full-viewport column, `max-w-md mx-auto`, safe-area padding, `min-h-dvh`.
2. `src/app/page.tsx`: client workspace with tab state (`order` | `stock` | `statement`).
3. Bottom nav (Lucide: e.g. `Inbox`, `Warehouse`, `Wallet`): **Order Stream**, **Stock Room**, **Pocket Statement**.
4. Top bar placeholders: offline/online dot, app name **BridgeWise**, empty capture button (wire in Phase 9).
5. Stub components:

   - `src/components/orders/OrderStream.tsx`
   - `src/components/inventory/StockRoom.tsx`
   - `src/components/finance/PocketStatement.tsx`
   - `src/components/capture/QuickCaptureModal.tsx` (closed by default)

6. Tailwind: high-contrast, thumb-reach bottom nav, no desktop sidebar.

### Definition of done

On a ~390px viewport, all three tabs switch instantly; layout matches Full System §2 (3-section workspace). No fake stock deductions in stubs.

### Maps to

Full System §2 UI; PWA blueprint mobile ergonomics; tech stack `layout.tsx` / `page.tsx`.

---

## Phase 4 — Dexie local DB

### Goal

IndexedDB is the only persistence for MVP. Cloud does not exist yet.

### Prerequisites

Phases 2–3.

### Concrete steps

1. `src/lib/db/dexie.ts`:

   ```ts
   // Version 1 stores:
   // orders, inventory, ledger_entries, daily_statements, customers
   // (sync_queue can wait until Phase 14/15)
   ```

2. Indexes: `order_id`, `status`, `date_key`, `ledger_committed`; inventory `sku_id`, `status_color`; ledger `txn_id`, `date`, `entry_type`; statements `date_key`; customers `customer_id`, `name`.
3. Deterministic key helpers in the same module (`nextOrderId`, `skuId`, `nextTxnId`, `statementId`, `customerId`).
4. Seed **dev-only** SKUs (e.g. `Black_Shoes_Size42`, `Blue_Handbag_Std`, `Red_Velvet_Cake_8in`) with cost/sell and `low_stock_threshold` default **4** (or 20% of last restock batch later).
5. Use `dexie-react-hooks` (`useLiveQuery`) in a tiny hook `src/lib/db/hooks.ts`.
6. Never call Gemini from this layer.

### Definition of done

DevTools → Application → IndexedDB shows stores; seed SKUs survive refresh; no Supabase client.

### Maps to

Tech stack §4B Dexie; Full System §3; Capture & State §4 “offline-first local IndexedDB.”

---

## Phase 5 — Atomic transaction engine (HARD GATE)

### Goal

**Confirm-only ledger/stock.** This phase is the product’s integrity core. Do not proceed to Stock Room / Order Stream / Statement as “done” until this exists and is tested by hand.

### Prerequisites

Phase 4. Types from Phase 2.

### Concrete steps

1. Create `src/lib/db/transactions.ts` with **one** write path for sales:

   - `commitConfirmedOrder(orderId)`
   - Must use `db.transaction('rw', [orders, inventory, ledger_entries, daily_statements], …)`
   - **Idempotency:** if `!order || order.ledger_committed` → no-op
   - For each line: load SKU, `stock_qty = Math.max(0, stock_qty - qty)`, set `status_color` (`RED` if 0, `YELLOW` if `<= low_stock_threshold`, else `GREEN`)
   - Sum `totalRevenue` / `totalCapital`; `netProfit = totalRevenue - totalCapital`
   - Insert `ledger_entries` `entry_type: 'SALE'`
   - Set order `status = CONFIRMED_SALE`, `ledger_committed = true`
   - `recalculateDailyPocketStatement(date_key)`: sum today’s SALE/EXPENSE/RESTOCK/RETURN

2. Also implement (used later, but keep atomic here):

   - `createPendingOrder(partial)` → **only** `orders` insert, `ledger_committed: false`, **zero** inventory/ledger writes
   - `cancelOrArchiveOrder(orderId)` → status only; **no** stock/ledger change
   - `processReturn(orderId)` (stub OK until Phase 16): reverse qty + reverse ledger in one transaction

3. **Forbidden:** any `inventory.put` or `ledger_entries.add` inside parse helpers, capture UI, or API routes.

4. Manual proof in the console or a throwaway button:

   - Insert pending order for 2 units → stock unchanged, statement unchanged
   - Confirm → stock −2, SALE row, statement updates
   - Confirm again → no second deduction

### Definition of done

Parse/create-pending cannot move stock. Double-confirm is safe. Window-shopper rule is code, not a comment.

### Maps to

Full System §5 atomic engine (the `commitConfirmedOrder` listing); Capture & State §2 four-state FSM; PWA blueprint “automatic stock deduction” **only after confirm**.

---

## Phase 6 — Stock Room

### Goal

Live SKU matrix. Vendors do **not** type a new count when a sale happens; counts change only via confirm / restock / return.

### Prerequisites

Phase 5.

### Concrete steps

1. Implement `StockRoom.tsx` with `useLiveQuery(() => db.inventory.toArray())`.
2. Each row: display name, `sku_id`, `stock_qty`, cost, sell, badge **GREEN • SAFE / YELLOW • LOW / RED • CRITICAL**.
3. Rules (Full System §4):

   - GREEN: `stock_qty > low_stock_threshold`
   - YELLOW: `0 < stock_qty ≤ low_stock_threshold`
   - RED: `stock_qty === 0`

4. Actions this phase: add/edit SKU (name, variant, cost, sell, threshold, **initial** qty). Do **not** add a “adjust qty after sale” control that bypasses the engine.
5. Placeholder `[+ Log Supplier Restock]` → Phase 12.
6. Optional: pin YELLOW/RED to the top of the list.

### Definition of done

Seed SKUs render; confirming an order in the console/engine updates badges live; editing a sale qty in the UI is impossible except through confirm/return.

### Maps to

Full System §2 Section 2 + §4 inventory health; PWA blueprint color-coded alerts; Capture Stock Room paragraph.

---

## Phase 7 — Order Stream

### Goal

Operational inbox: amber pending vs green confirmed; confirm is the only path into the engine.

### Prerequisites

Phases 5–6.

### Concrete steps

1. `OrderStream.tsx`: live query orders, newest first; split or badge by state.
2. Amber card: customer, items, delivery snippet, intent, **0 stock deducted** copy, `[Tap to Confirm Sale]`.
3. Green card: **Stock Deducted • Profit Logged**, placeholder `[Share Receipt]` (Phase 13).
4. Confirm calls `commitConfirmedOrder` only. Disable/hide if already `ledger_committed`.
5. Cancel/archive on pending only (`cancelOrArchiveOrder`).
6. Temporary **manual “New inquiry”** form (name, SKU select, qty) writing via `createPendingOrder` so you can test without Gemini. Remove or hide behind “dev” once Phase 9–10 work.

### Definition of done

Pending card does not change Stock Room or Pocket Statement. Confirm updates both in one tap. Ready-to-confirm can be a stronger CTA later (Phase 10 intent).

### Maps to

Full System §2 Section 1 + order commitment indicators; Capture §2–4; PWA workflow steps 01–03 (03 only after confirm).

---

## Phase 8 — Pocket Statement

### Goal

Anti-commingling daily snapshot: three numbers, not a spreadsheet.

### Prerequisites

Phase 5–7 (needs committed sales).

### Concrete steps

1. `PocketStatement.tsx` reads `daily_statements` for **today** (`Daily_Summary_YYYY-MM-DD`).
2. Show:

   - **Total Sales Collected** (gross confirmed revenue)
   - **Protected Restock Capital** (“Do Not Spend”)
   - **Safe Net Profit** (sales − capital − expenses)

3. Recalc function must include expenses/restock when those exist (zeros until Phase 12).
4. Empty day: ₦0 all buckets, not a crash.
5. Format Naira (`₦`), no Stripe.

### Definition of done

One confirmed sale (e.g. cost 8k sell 15k qty 1) → sales 15k, capital 8k, profit 7k. Pending inquiries change nothing.

### Maps to

Full System §2 Section 3; PWA blueprint capital vs profit; Capture example ₦30k / ₦16k / ₦14k.

---

## Phase 9 — Share Target + clipboard capture

### Goal

Get raw WhatsApp text into a pending draft **without** the Business API.

### Prerequisites

Phases 3, 4, 7. PWA manifest can be minimal here; full SW in Phase 14.

### Concrete steps

1. `public/manifest.json`: `share_target` POST (or GET) to `/share-target` with `text` / `title` / `url` params. `display: standalone`, name BridgeWise, icons 192 and 512 (placeholder PNGs OK).
2. Link manifest from `src/app/layout.tsx` metadata.
3. `src/app/share-target/page.tsx`: read shared text from query or `FormData`; call `createPendingOrder` with raw body as notes if parse API is not ready; never confirm.
4. `QuickCaptureModal.tsx`: `navigator.clipboard.readText()` behind a user gesture; HTTPS/localhost only. On failure, show paste `<textarea>`.
5. Offline: if `navigator.onLine === false`, still save pending draft locally (Full System offline indicator; tech stack §4C fallback).
6. Do **not** scrape WhatsApp; OS share + clipboard only.

### Definition of done

Paste/share creates an **amber** order; stock unchanged. Clipboard button works on localhost.

### Maps to

Tech stack §4A; Capture §1 A–B; PWA blueprint inbound clipboard/share sheet.

---

## Phase 10 — Gemini parse API

### Goal

Server-side NLP only. Client never holds `GEMINI_API_KEY`. Model: **`gemini-2.5-flash`**. Structured JSON. Parser **cannot** commit the ledger.

### Prerequisites

Phases 2, 7, 9. Gemini key in `.env.local`.

### Concrete steps

1. `src/lib/ai/prompts.ts`: system instructions for Nigerian informal English/Pidgin; extract customer, items, qty, location, payment signals; classify intent (`PENDING_INQUIRY` vs `READY_TO_CONFIRM` / high purchase intent).
2. JSON schema aligned with Capture sample payload; **force** `"status": "PENDING_INQUIRY"` and `"ledger_committed": false` in the route after the model returns (do not trust the model for commit flags).
3. `src/app/api/parse/route.ts`:

   - `import { GoogleGenAI } from '@google/genai'`
   - Use `gemini-2.5-flash`
   - POST `{ text, capture_method }`
   - Return parsed object; **do not** open Dexie on the server (IndexedDB is browser-only)
   - Client then `createPendingOrder(parsed)`

4. Client: if parse fetch fails or offline, save raw text as pending draft (tech stack offline fallback).
5. UI: inquiry signals → amber; payment signals (`transfer sent`, etc.) → still pending, but CTA **Confirm & Deduct Stock**.
6. Never import `@google/genai` in client components.

### Definition of done

Example: *“Pls send 2 black bags to Lekki Phase 1, transfer sent”* → structured pending order, stock untouched until confirm. Key not in bundle.

### Maps to

Tech stack §4C; PWA blueprint NLP; Capture §3 intent + sample JSON; Full System Layer 2.

---

## Phase 11 — Customer identity directory

### Goal

Vendors should not retype names. 3-tier resolution, then a directory.

### Prerequisites

Phases 4, 10.

### Concrete steps

1. Implement resolution in `src/lib/ai` or `src/lib/db/customers.ts`:

   | Tier | Source | Example |
   |------|--------|---------|
   | 1 | WhatsApp multi-bubble header | `[10:14 AM] Chioma Nwosu: I want 2 cakes` |
   | 2 | In-text self-ID | `this is Tunde from Ikeja` |
   | 3 | Fallback | `Walk-in / Inquiry #014` + 1-tap picker |

2. Upsert `customers` (`CUST_Chioma_Nwosu`), merge `saved_addresses` from delivery lines.
3. Order Stream: if name is walk-in, show dropdown of recent customers.
4. Optional preferences (sizes, cake flavors) as a string list on `Customer`.

### Definition of done

Repeat Chioma messages reuse the same `customer_id`; walk-in never blocks capture.

### Maps to

Capture §1C identity pipeline; Full System customers store.

---

## Phase 12 — Expenses + restock (+ voice-as-text stretch)

### Goal

Log “Fuel 5k, nylon 3k” and “Restocked 20 Ankara @ ₦40k” without sales confusion. Restock increments qty **and** records cost; expenses hit net profit only.

### Prerequisites

Phases 5, 6, 8, 10.

### Concrete steps

1. Extend parse prompt: `kind: 'order' | 'expense' | 'restock'`.
2. Atomic helpers:

   - `commitExpense({ amount, category, note, date_key })` → `ledger_entries` EXPENSE + statement recalc; **no** inventory
   - `commitRestock({ sku_id, qty, total_cost })` → inventory += qty, optional unit cost update, RESTOCK ledger, recalc

3. Stock Room: restock sheet (SKU, qty, amount).
4. Pocket Statement: expenses reduce **Safe Net Profit**; restock increases stock and may increase protected capital policy as documented (at minimum: record restock cash out in `total_expenses` or a clear restock line so commingling stays honest).
5. **Stretch:** `SpeechRecognition` / browser voice → same textarea as capture → still text into `/api/parse`. No extra vendor speech API required. Voice is **as-text**, not a second backend.

### Definition of done

Fuel 5k drops net profit 5k without touching SKU qty. Restock 20 units moves GREEN/YELLOW and does not create a SALE.

### Maps to

PWA blueprint expense/restock; Full System restock CTA; tech stack “Fuel 5k, nylon 3k.”

---

## Phase 13 — WhatsApp receipt share

### Goal

One-tap outbound invoice via the **Web Share API** (share into WhatsApp). Not the WhatsApp Business API.

### Prerequisites

Phase 7 confirmed cards; Phase 8 numbers.

### Concrete steps

1. `src/components/orders/ReceiptGenerator.tsx`: plain-text (and optional image later) receipt: vendor-facing item lines, qty, sell prices, total, delivery location, thank-you line.
2. Confirmed cards only: `navigator.share({ text, title: 'BridgeWise receipt' })` with `navigator.clipboard.writeText` fallback.
3. Do not mark shared receipts as a second ledger event.

### Definition of done

After confirm, share sheet opens with itemized text; cancelling share does not roll back the sale.

### Maps to

PWA blueprint outbound receipts; Full System green card CTA; engine workflow step 05.

---

## Phase 14 — PWA / service worker / offline queue

### Goal

Installable app shell, offline UI, queue for **online** work (parse, later sync). HTTPS will be real on Vercel (Phase 19).

### Prerequisites

Phases 1, 3, 9.

### Concrete steps

1. Wire `@ducanh2912/next-pwa` in `next.config.mjs` (or `next.config.ts`) per library docs (Serwist-based).
2. Cache app shell + static assets; **do not** cache Gemini responses as source of truth.
3. `public/icons/` 192 and 512; maskable if possible.
4. Top bar: `OFFLINE SAVED` vs `SYNCED` from `navigator.onLine` and `sync_queue.length` (Full System §4).
5. `src/lib/sync/syncQueue.ts`: Dexie `sync_queue` store — enqueue failed `/api/parse` (and later Supabase pushes). Flush on `online` event. Queue must **not** auto-confirm orders.
6. Android: Add to Home Screen; verify share-target still registered in installed mode.

### Definition of done

Airplane mode: open shell, paste order, pending saved locally. Back online: parse queue flushes if you enqueued it. No login wall.

### Maps to

Tech stack PWA row + directory `sw.js`; Full System Layer 3 + offline indicator; PWA blueprint offline-first.

---

## Phase 15 — Optional Supabase auth + sync

### Goal

Background backup and multi-device recovery. **Dexie remains source of truth while offline.** Core app still works with empty Supabase env. **No login wall.**

### Prerequisites

Phase 14 queue. Optional cloud project.

### Concrete steps

1. **Now** install:

   ```bash
   npm install @supabase/supabase-js
   ```

2. `src/lib/sync/supabase.ts`: create client only if URL + anon key exist; otherwise no-ops.
3. Mirror tables: orders, inventory, ledger_entries, daily_statements, customers — same IDs.
4. Auth is **optional** (anonymous or magic link later). Never block Order Stream on session.
5. Delta sync worker: push `sync_queue` rows; pull on launch when online; last-write policy: prefer **ledger_committed** server rows over stale pending if you must conflict-resolve (document the rule in code comments).
6. Do not run Gemini in Postgres; do not move atomic confirm to the server as the only path (confirm still local-first).

### Definition of done

App usable with keys missing. With keys, confirmed sales appear on a second browser after sync. Unauthenticated users are not kicked to a login page.

### Maps to

Tech stack Supabase row + env; Full System Layer 3 cloud store; PWA “sync when 3G/4G returns.”

---

## Phase 16 — 72h archive, RED block, returns, velocity

### Goal

Finish the state machine and stock safety nets from the system spec.

### Prerequisites

Phases 5–8, 12.

### Concrete steps

1. **72h archive:** pending with `ledger_committed === false` older than 72h → `EXPIRED` / archive. Stock still untouched. Run on load + interval.
2. **RED block:** if any line SKU is `stock_qty === 0` (or would go negative), `commitConfirmedOrder` **aborts** the whole transaction and the UI warns before confirm (“out of stock — restock first”).
3. **Returns:** implement `processReturn` fully — restore qty, `entry_type: 'RETURN'`, reverse daily sales/capital/profit, order `REFUNDED`. Idempotent.
4. **Velocity:** for YELLOW SKUs, suggest restock qty from **7-day** confirmed sales velocity (simple sum of committed line qty / 7).
5. Reorder threshold: keep default > 4 units or > 20% of last restock batch if batch size is stored.

### Definition of done

Ghost leads vanish from the active inbox after 72h without ledger noise. Confirming a 0-stock SKU fails closed. Return restores Stock Room and Pocket Statement together.

### Maps to

Full System §4 (72h, RED unavailable, 7-day velocity); Capture §2 cancelled/expired + refunded/returned.

---

## Phase 17 — Polish

### Goal

Vendor-usable on a mid-range Android phone: contrast, thumbs, Pidgin-friendly copy, empty states.

### Prerequisites

Phases 6–16 feature-complete enough to skin.

### Concrete steps

1. Badges: Amber pending, Green confirmed, GREEN/YELLOW/RED inventory — WCAG-ish contrast.
2. Empty states: “Paste a WhatsApp chat to start”; “Add your first SKU”; “No sales today — ₦0.”
3. Top capture always visible; bottom nav does not hide behind iOS home indicator (`env(safe-area-inset-*)`).
4. Loading/error toasts for parse; never leave a spinner that looks like a confirmed sale.
5. Tagline alignment with company foundation: **Smarter Business. Better Growth.** — use sparingly (splash/header), not instead of operational labels.
6. Remove Phase 7 manual-dev forms from production UI or gate with `NODE_ENV`.

### Definition of done

A vendor can complete capture → confirm → receipt → glance at profit without a tutorial. Bundle stays a PWA, not a native rewrite.

### Maps to

Company Foundation values (simplicity, customer-first); PWA form factor; Full System “eliminate cognitive overload.”

---

## Phase 18 — Testing

### Goal

Prove the invariant and atomicity; regression-lock the engine.

### Prerequisites

Phases 5–16.

### Concrete steps

1. Unit-test `commitConfirmedOrder` / pending create / double confirm / RED abort / return (fake Dexie or fake-indexeddb).
2. Parser contract tests: mocked Gemini JSON always coerced to `ledger_committed: false`.
3. Manual device checklist:

   - [ ] Pending paste does not change stock or ₦
   - [ ] Confirm updates all three tabs
   - [ ] Offline pending save
   - [ ] Share target (installed PWA on Android)
   - [ ] Receipt share
   - [ ] Expense + restock
   - [ ] 72h (time-travel or shortened constant in test)

4. Do **not** add Cypress-only tests that confirm via the parse API as a shortcut.

### Definition of done

Automated tests fail if parse writes inventory. Manual checklist recorded (even as comments in `phrases.md` / QA notes).

### Maps to

Capture window-shopper rule; Full System §5 engine guarantee.

---

## Phase 19 — Vercel deploy

### Goal

Public HTTPS origin so Service Workers, Share Target, and Clipboard APIs work on real phones.

### Prerequisites

Phases 1–18. Git remote. Gemini key in Vercel env (Supabase optional).

### Concrete steps

1. `npm run build` locally must pass.
2. Import project on Vercel; framework Next.js; root directory if using a subfolder.
3. Env: `GEMINI_API_KEY` (server); `NEXT_PUBLIC_SUPABASE_*` only if Phase 15 is live.
4. Deploy production URL (`https://…`).
5. On a phone: open HTTPS → Add to Home Screen → share from WhatsApp → confirm sale offline/online.
6. Confirm **no** WhatsApp Business webhook, **no** Stripe, **no** maps keys.

### Definition of done

Installed PWA on Android captures a chat, pending then confirm, Stock Room and Pocket Statement match, receipt shares back to WhatsApp. HTTPS is on.

### Maps to

Tech stack Hosting & Edge (Vercel + HTTPS for SW/clipboard); PWA zero-download launch via shared link.

---

## Canonical reminders (do not violate while building)

- Next.js **15** (`create-next-app@15`), App Router, TypeScript, Tailwind, `src/`.
- Install: `dexie` `dexie-react-hooks` `@ducanh2912/next-pwa` `lucide-react` `@google/genai`. Add `@supabase/supabase-js` **only** in Phase 15.
- Confirm-only ledger/stock. **Parse never commits.**
- Three tabs only for the product shell.
- Dexie is source of truth; Supabase optional; no login wall.
- Gemini **`gemini-2.5-flash`**, server-side only.
- Vercel HTTPS last.
- No WhatsApp Business API, Stripe, maps, Nest, or GraphQL.
