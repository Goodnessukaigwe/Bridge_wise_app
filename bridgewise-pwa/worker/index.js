/**
 * OnRecord share target (Android). WhatsApp sends text, photos and voice notes
 * as a POST. The phone keeps them in a short-lived cache on the device and
 * opens the assistant; nothing goes to a server here.
 */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/share-target") return;

  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const cache = await caches.open("onrecord-share");
        for (const key of await cache.keys()) await cache.delete(key);

        const text = ["title", "text", "url"]
          .map((k) => form.get(k))
          .filter((v) => typeof v === "string" && v.trim())
          .join("\n");
        const files = form.getAll("media").filter((f) => typeof f !== "string").slice(0, 4);

        const token = String(Date.now());
        await cache.put(
          "/__share/meta",
          new Response(JSON.stringify({ token, text, count: files.length })),
        );
        for (let i = 0; i < files.length; i++) {
          await cache.put(
            `/__share/file/${i}`,
            new Response(files[i], {
              headers: {
                "Content-Type": files[i].type || "application/octet-stream",
                "X-File-Name": encodeURIComponent(files[i].name || `shared-${i}`),
              },
            }),
          );
        }
        return Response.redirect(`/?share=${token}`, 303);
      } catch {
        return Response.redirect("/", 303);
      }
    })(),
  );
});
