/** Reads what the service worker kept from an Android share, then clears it. */

export type SharedItem = { text: string; files: File[] };

export async function takeSharedItem(): Promise<SharedItem | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open("onrecord-share");
    const metaRes = await cache.match("/__share/meta");
    if (!metaRes) return null;
    const meta = (await metaRes.json()) as { text?: string; count?: number };
    const files: File[] = [];
    for (let i = 0; i < Math.min(meta.count ?? 0, 4); i++) {
      const res = await cache.match(`/__share/file/${i}`);
      if (!res) continue;
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get("X-File-Name") ?? `shared-${i}`);
      files.push(new File([blob], name, { type: blob.type }));
    }
    for (const key of await cache.keys()) await cache.delete(key);
    return { text: (meta.text ?? "").trim(), files };
  } catch {
    return null;
  }
}
