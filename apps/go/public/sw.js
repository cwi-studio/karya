// Karya Go service worker: the app shell works on a bad connection; the API is never cached.
// SPDX-License-Identifier: AGPL-3.0-only
const CACHE = "karya-go-v2";
const SHELL = ["/go/", "/go/manifest.webmanifest", "/go/icon.svg", "/go/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("karya-go-v") && k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Share sheet (Android): "Share → Karya Go" on a screenshot posts it here. Park the files, open the app.
async function receiveShare(request) {
  const form = await request.formData();
  const cache = await caches.open("karya-go-share");
  await Promise.all((await cache.keys()).map((k) => cache.delete(k)));
  const files = form.getAll("files").filter((f) => typeof f !== "string");
  await Promise.all(
    files
      .slice(0, 10)
      .map((file, i) =>
        cache.put(
          `/go/__shared/${i}`,
          new Response(file, { headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) } })
        )
      )
  );
  const text = [form.get("title"), form.get("text"), form.get("url")].filter(Boolean).join(" ").trim();
  if (text) await cache.put("/go/__shared/text", new Response(text));
  return Response.redirect("/go/?shared=1", 303);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/go/share") {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith("/go/")) return;

  // Hashed build files never change: cache first.
  if (url.pathname.startsWith("/go/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone();
            if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
    return;
  }

  // The page and small files: network first so a release shows at once, cache when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        if (response.ok)
          caches.open(CACHE).then((cache) => cache.put(request.mode === "navigate" ? "/go/" : request, copy));
        return response;
      })
      .catch(() => caches.match(request.mode === "navigate" ? "/go/" : request))
  );
});
