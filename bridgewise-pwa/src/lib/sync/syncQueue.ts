import { applyParseToPendingOrder } from "@/lib/db/transactions";
import { db } from "@/lib/db/dexie";
import type {
  CaptureMethod,
  ParseResult,
  SyncQueueRow,
} from "@/types/bridgewise";

export type EnqueueParseInput = {
  order_id: string;
  raw_text: string;
  capture_method: CaptureMethod;
};

let flushing: Promise<void> | null = null;

/**
 * Queue a failed / offline /api/parse job. Idempotent on `order_id`.
 * Flush never calls commitConfirmedOrder — Confirm Sale stays a tap.
 */
export async function enqueueParse(input: EnqueueParseInput): Promise<void> {
  const order_id = input.order_id.trim();
  const raw_text = input.raw_text.trim();
  if (!order_id || !raw_text) return;

  const existing = await db.sync_queue
    .filter((row) => row.kind === "parse" && row.order_id === order_id)
    .first();
  if (existing) return;

  const row: SyncQueueRow = {
    id: crypto.randomUUID(),
    kind: "parse",
    order_id,
    raw_text,
    capture_method: input.capture_method,
    created_at: Date.now(),
    attempts: 0,
  };
  await db.sync_queue.add(row);
}

export async function flushParseQueue(): Promise<void> {
  if (flushing) return flushing;
  flushing = flushParseQueueNow().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function flushParseQueueNow(): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  const rows = (await db.sync_queue.where("kind").equals("parse").toArray()).sort(
    (a, b) => a.created_at - b.created_at,
  );

  for (const row of rows) {
    const parsed = await requestParse(row);
    if (!parsed) {
      await db.sync_queue.update(row.id, { attempts: row.attempts + 1 });
      continue;
    }

    if (parsed.kind === "expense" || parsed.kind === "restock") {
      await db.sync_queue.delete(row.id);
      continue;
    }

    try {
      await applyParseToPendingOrder(row.order_id, parsed);
      await db.sync_queue.delete(row.id);
    } catch {
      await db.sync_queue.update(row.id, { attempts: row.attempts + 1 });
    }
  }
}

async function requestParse(row: SyncQueueRow): Promise<ParseResult | null> {
  try {
    const response = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: row.raw_text,
        capture_method: row.capture_method,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) return null;
    const parsed = (await response.json()) as ParseResult;
    if (parsed.ledger_committed || parsed.status !== "PENDING_INQUIRY") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
