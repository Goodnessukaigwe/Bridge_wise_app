import { db, todayDateKey } from "@/lib/db/dexie";
import type { SessionContext } from "@/lib/agent/types";

/** Start-of-session context: today's date, business name and a few counts. Nothing else. */
export async function buildSession(businessName: string): Promise<SessionContext> {
  const [pending, products, customers] = await Promise.all([
    db.orders.where("status").equals("PENDING_INQUIRY").count(),
    db.inventory.count(),
    db.customers.count(),
  ]);
  return {
    date: todayDateKey(),
    business: businessName.slice(0, 80),
    counts: { pending, products, customers },
  };
}
