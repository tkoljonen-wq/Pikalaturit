// Service worker — network first (CLAUDE.md PWA-ohjeet).
// Hae aina ensin verkosta; käytä välimuistia vain offline-tilanteessa.
// Näin sovellus päivittyy automaattisesti ilman välimuistin tyhjennystä.

const CACHE = "pikalaturit-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Älä välimuistita Supabase-API-kutsuja (aina tuore data).
  const url = new URL(req.url);
  if (url.hostname.endsWith(".supabase.co")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
