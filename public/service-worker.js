const CACHE_NAME = "ws-consultoria-v13";
const APP_FILES = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/map-layers.json",
  "/vendor/jszip.min.js",
  "/manifest.webmanifest",
  "/assets/ws-logo.png",
  "/assets/use-logo.gif"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).pathname.startsWith("/api/")) return;
  event.respondWith(fetch(request).catch(() => caches.match(request).then((cached) => cached || caches.match("/"))));
});
