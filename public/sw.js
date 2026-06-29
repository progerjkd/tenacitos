const CACHE = "mc-v3";

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(clients.claim()); });

self.addEventListener("fetch", e => {
  let url;
  try {
    url = new URL(e.request.url);
  } catch {
    // Malformed URL — let the browser handle it
    return;
  }

  // Only handle http/https — skip chrome-extension://, blob:, data:, etc.
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // API calls: network-first, fall back to cache
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Static assets: cache-first, then network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Only cache successful same-origin responses
        if (!res || res.status !== 200 || res.type === "opaque") return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      });
    })
  );
});
