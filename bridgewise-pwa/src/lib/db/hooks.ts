"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";

const canUseIdb = typeof indexedDB !== "undefined";

export function useSkus() {
  return useLiveQuery(
    () => (canUseIdb ? db.inventory.toArray() : []),
    [],
  );
}

export function useOrders() {
  return useLiveQuery(
    () => (canUseIdb ? db.orders.toArray() : []),
    [],
  );
}

/** `undefined` while loading; `null` when the day has no Dexie row. */
export function useDailyStatement(dateKey: string) {
  return useLiveQuery(
    async () => {
      if (!canUseIdb) return null;
      const row = await db.daily_statements.get(dateKey);
      return row ?? null;
    },
    [dateKey],
  );
}

export function useCustomers() {
  return useLiveQuery(
    () => (canUseIdb ? db.customers.toArray() : []),
    [],
  );
}

export function useSyncQueueCount() {
  return useLiveQuery(
    () => (canUseIdb ? db.sync_queue.count() : 0),
    [],
  );
}

export function useDailyLedger(dateKey: string) {
  return useLiveQuery(
    async () => {
      if (!canUseIdb) return [];
      return db.ledger_entries.where("date_key").equals(dateKey).toArray();
    },
    [dateKey],
  );
}
