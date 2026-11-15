# BridgeWise PWA — Tech Stack & Engineering Architecture

**Version:** 1.0 (MVP)  
**Target Environment:** Mobile-First Progressive Web App (Android & iOS)  
**Primary Region & Market:** Nigeria (Informal & Social Commerce Vendors)  

---

## 1. Executive Summary
BridgeWise is built as an **offline-first, full-stack Next.js Progressive Web App (PWA)**. The technology stack is intentionally selected to solve four critical constraints faced by small-scale vendors in emerging markets:
1. **Zero-Download Friction:** Instant launch via mobile browser with native "Add to Home Screen" capability.
2. **Low Storage & Memory Footprint:** Lightweight bundle sizes optimized for entry-level and mid-range Android smartphones.
3. **Unreliable Network Resilience:** Local-first storage (`IndexedDB`) ensures order logging, stock checks, and profit calculations work seamlessly with zero internet connectivity.
4. **Secure AI Middleware:** Server-side API routes protect LLM API keys while parsing messy WhatsApp texts and Nigerian Pidgin/slang into structured JSON records.

---

## 2. Core Technology Stack

| Architectural Layer | Technology / Library | Purpose & Justification |
| :--- | :--- | :--- |
| **Core Framework** | **Next.js (App Router)** | Unified React frontend + Node.js server endpoints (`Route Handlers`) for AI parsing and cloud sync without managing a separate backend server. |
| **Language** | **TypeScript** | Enforces strict type safety across order state transitions (`PENDING` vs. `CONFIRMED`), inventory thresholds, and atomic financial splits. |
| **UI & Styling** | **Tailwind CSS + Lucide React** | Rapid, mobile-first responsive layouts, high-contrast status badges (Green/Yellow/Red), and lightweight vector iconography. |
| **PWA & Offline Caching** | **`@ducanh2912/next-pwa` (Serwist)** | Generates service workers to cache the app shell, static assets, and configures the `manifest.json` **Web Share Target API** for WhatsApp capture. |
| **Local Offline Database** | **Dexie.js (IndexedDB Wrapper)** | Provides fast, ACID-compliant local browser storage with atomic read/write transactions (`db.transaction('rw', ...)`). |
| **Cloud Sync & Auth** | **Supabase (PostgreSQL)** | Optional background cloud backup and multi-device recovery when 3G/4G connectivity is available. |
| **AI & NLP Engine** | **Google Gemini API (`gemini-2.5-flash`)** | Low-latency, cost-effective structured JSON extraction for parsing WhatsApp chats, delivery addresses, buyer intent, and quick expense logs. |
| **Hosting & Edge** | **Vercel** | Global CDN edge delivery with automatic HTTPS (a strict browser requirement for Service Workers and Clipboard APIs). |

---

## 3. Recommended Project Directory Structure

```text
bridgewise-pwa/
├── public/
│   ├── icons/                   # PWA home-screen icons (192x192, 512x512)
│   ├── manifest.json            # PWA configuration + Web Share Target registration
│   └── sw.js                    # Auto-generated Service Worker (via next-pwa)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── parse/
│   │   │       └── route.ts     # Server-side AI NLP endpoint (WhatsApp & Expense parser)
│   │   ├── share-target/
│   │   │   └── page.tsx         # Receives incoming text from Android/iOS Share Sheet
│   │   ├── layout.tsx           # Mobile shell, Top Sync Status Bar & Bottom Nav
│   │   └── page.tsx             # Main 3-Tab Workspace (Order Stream, Stock Room, Pocket Statement)
│   ├── components/
│   │   ├── capture/
│   │   │   └── QuickCaptureModal.tsx  # Floating widget / clipboard ingestion drawer
│   │   ├── orders/
│   │   │   ├── OrderStream.tsx        # Amber (Pending) & Green (Confirmed) order feed
│   │   │   └── ReceiptGenerator.tsx   # One-tap formatted WhatsApp receipt sharer
│   │   ├── inventory/
│   │   │   └── StockRoom.tsx          # SKU list with Green/Yellow/Red health badges
│   │   └── finance/
│   │       └── PocketStatement.tsx    # Total Sales, Protected Capital & Net Profit view
│   ├── lib/
│   │   ├── db/
│   │   │   ├── dexie.ts               # IndexedDB schema & deterministic key generators
│   │   │   └── transactions.ts        # Atomic order confirmation & rollback logic
│   │   ├── ai/
│   │   │   └── prompts.ts             # System instructions & JSON schemas for NLP extraction
│   │   └── sync/
│   │       └── syncQueue.ts           # Background delta-sync worker to Supabase
│   └── types/
│       └── bridgewise.ts              # Core TypeScript interfaces (Order, SKU, LedgerEntry)
├── .env.local                         # GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
├── next.config.mjs                    # PWA & Service Worker build configuration
└── package.json
```

---

## 4. Key Technical Integrations

### A. WhatsApp Capture Bridge (`manifest.json` + Clipboard API)
Because mobile operating systems sandbox WhatsApp's private storage, BridgeWise uses two browser-standard mechanisms:
1. **Web Share Target API:** Registered in `public/manifest.json` so BridgeWise appears in the native Android/iOS Share Sheet when a vendor highlights WhatsApp chat bubbles and taps **Share**.
2. **Clipboard Interception:** Uses `navigator.clipboard.readText()` inside the floating quick-capture trigger to ingest copied messages in one tap.

### B. Atomic Local Database (`Dexie.js`)
To guarantee that inventory counts and profit figures never drift out of sync—and that casual "window shoppers" never trigger false deductions—all confirmed sales execute inside an atomic Dexie transaction:
* **`orders` store:** Deterministic ID `[Customer]_[YYYY-MM-DD]_[Seq]` (e.g., `Chioma_2026-11-12_Ord004`).
* **`inventory` store:** Deterministic ID `[Product_Slug]_[Variant]` (e.g., `Black_Shoes_Size42`).
* **`ledger_entries` store:** Deterministic ID `TXN_[YYYY-MM-DD]_[Type]_[Seq]`.
* **`daily_statements` store:** Deterministic ID `Daily_Summary_[YYYY-MM-DD]`.

### C. AI Natural Language Parsing (`src/app/api/parse/route.ts`)
* Receives raw WhatsApp chat text or quick expense strings (e.g., *"Pls send 2 black bags to Lekki Phase 1, transfer sent"* or *"Fuel 5k, nylon 3k"*).
* Uses **Structured Outputs (JSON Schema)** to enforce deterministic fields: customer name, items, quantities, delivery location, intent classification (`PENDING_INQUIRY` vs. `READY_TO_CONFIRM`), and expense categorization.
* **Offline Fallback:** If `navigator.onLine` is `false`, the raw text is saved directly to the local `orders` store as a `PENDING_INQUIRY` draft so the vendor can confirm or edit it immediately without waiting for internet access.

---

## 5. Environment Variables Setup

Create a `.env.local` file in the project root with the following keys:

```env
# AI Parsing Engine
GEMINI_API_KEY=your_google_gemini_api_key

# Optional Cloud Backup & Multi-Device Sync (Supabase)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

---

## 6. Getting Started (Initialization Commands)

```bash
# 1. Initialize Next.js app with TypeScript and Tailwind CSS
npx create-next-app@latest bridgewise-pwa --typescript --tailwind --eslint --app --src-dir

# 2. Navigate into project directory
cd bridgewise-pwa

# 3. Install core dependencies (Offline DB, PWA Service Worker, Icons, AI SDK)
npm install dexie dexie-react-hooks @ducanh2912/next-pwa lucide-react @google/genai

# 4. Run local development server
npm run dev
```