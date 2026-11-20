import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/dexie";
import { POST } from "@/app/api/agent/route";
import { parseNdjson, type ModelTransport } from "@/lib/agent/loop";
import { playTurn, seedPending, seedShop } from "@/lib/agent/eval/harness";
import { SAMPLES } from "@/lib/agent/eval/samples";

/**
 * Opt-in: RUN_LIVE_AGENT=1 with GEMINI_API_KEY set. Sends the synthetic
 * sample messages to the real model and checks what it did on a fake shop.
 */
const live = process.env.RUN_LIVE_AGENT === "1" && !!process.env.GEMINI_API_KEY;

const transport: ModelTransport = async function* (req) {
  const res = await POST(
    new Request("http://local/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-onrecord-device": `eval-${Math.random()}` },
      body: JSON.stringify(req),
    }),
  );
  if (!res.ok || !res.body) throw new Error(`agent ${res.status}`);
  yield* parseNdjson(res.body);
};

describe.skipIf(!live)("live model on the sample messages", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedShop();
  });
  afterEach(async () => {
    await db.delete();
  });

  for (const s of SAMPLES) {
    it(`${s.group}: ${s.id}`, { timeout: 120_000, retry: 1 }, async () => {
      for (const seed of s.seed ?? []) await seedPending(seed.customer, seed.product, seed.qty);
      const out = await playTurn(s.text, transport);
      const problem = s.check(out);
      console.log(`[${s.id}] ${problem ?? "ok"} :: calls=${out.cards.map((c) => c.proposal?.tool ?? c.kind).join(",")} :: ${out.result.text.slice(0, 140).replace(/\n/g, " ")}`);
      expect(problem).toBeNull();
    });
  }
});
