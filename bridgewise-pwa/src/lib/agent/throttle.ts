/**
 * Per-device sliding-window limiter. In memory, so on serverless it is
 * best-effort per instance. It exists to stop a runaway client, not to be
 * a billing control (set a spend cap on the Gemini key as well).
 */
export function createThrottle(limit: number, windowMs: number, maxKeys = 5000) {
  const hits = new Map<string, number[]>();
  return function allow(key: string, now = Date.now()): boolean {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > maxKeys) {
      for (const [k, v] of hits) {
        if (v.every((t) => now - t >= windowMs)) hits.delete(k);
        if (hits.size <= maxKeys) break;
      }
    }
    return true;
  };
}
