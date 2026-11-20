import { db } from "@/lib/db/dexie";
import type { ChatMessage } from "@/lib/agent/types";

const KEEP = 300;

export async function loadChat(): Promise<ChatMessage[]> {
  return db.chat_messages.orderBy("at").toArray();
}

export async function saveChatMessage(m: ChatMessage): Promise<void> {
  // Never persist transient state.
  const { progress: _progress, ...rest } = m;
  void _progress;
  await db.chat_messages.put(rest);
  const n = await db.chat_messages.count();
  if (n > KEEP) {
    const old = await db.chat_messages.orderBy("at").limit(n - KEEP).primaryKeys();
    await db.chat_messages.bulkDelete(old);
  }
}

export async function clearChat(): Promise<void> {
  await db.chat_messages.clear();
}
