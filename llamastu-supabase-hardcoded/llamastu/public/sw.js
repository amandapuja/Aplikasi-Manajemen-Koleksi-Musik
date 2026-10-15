/* eslint-env serviceworker */
/**
 * Llamastu service worker.
 *
 * Two responsibilities:
 *
 *  1. Offline app shell — the built HTML/CSS/JS is cached on install so the
 *     platform opens instantly and still loads without a network.
 *  2. Web Push delivery — a deployed backend can POST a push message to this
 *     subscription and the reminder is shown even when no tab is open. The
 *     payload format is { title, body, url? }.
 *
 * Nothing secret lives here: the VAPID *public* key is provided by the backend
 * at subscribe time, and the private key never leaves the server.
 */

/**
 * Bump this whenever the shell or the app bundle changes.
 *
 * A service worker only re-installs when this FILE changes byte-for-byte, so an
 * unchanged cache name keeps serving the previous build's cached assets after a
 * deploy — which is how a browser can show an older screen than the source it is
 * running. Bumping the name forces a clean cache on the next visit; `install`
 * then calls `skipWaiting` and `activate` calls `clients.claim`, so the new
 * worker takes over immediately instead of waiting for every tab to close.
 */
const CACHE = "llamastu-shell-v2"
const SHELL = ["/", "/index.html", "/manifest.webmanifest"]

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // Individually so one missing asset cannot fail the whole install.
      await Promise.all(
        SHELL.map((path) => cache.add(new Request(path, { cache: "reload" })).catch(() => undefined)),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return

  const url = new URL(request.url)
  // Never cache API traffic or Supabase calls — only the local app shell.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/functions/")) return

  // Navigations: network first so deploys are picked up, cache as fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          const cache = await caches.open(CACHE)
          cache.put("/index.html", response.clone())
          return response
        } catch {
          const cache = await caches.open(CACHE)
          return (await cache.match("/index.html")) ?? Response.error()
        }
      })(),
    )
    return
  }

  // Static assets: cache first, then fill the cache in the background.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const cached = await cache.match(request)
      if (cached) return cached
      try {
        const response = await fetch(request)
        if (response.ok && response.type === "basic") cache.put(request, response.clone())
        return response
      } catch {
        return Response.error()
      }
    })(),
  )
})

/* ------------------------------------------------------------------ *
 * Push
 * ------------------------------------------------------------------ */

self.addEventListener("push", (event) => {
  let payload = { title: "Study Reminder", body: "You have an agenda item coming up." }
  if (event.data) {
    try {
      const parsed = event.data.json()
      payload = {
        title: parsed.title || payload.title,
        body: parsed.body || parsed.message || payload.body,
        url: parsed.url,
      }
    } catch {
      payload.body = event.data.text() || payload.body
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: payload.url || "llamastu-reminder",
      data: { url: payload.url || "/" },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || "/"
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      for (const client of clients) {
        if (client.url.includes(target) && "focus" in client) return client.focus()
      }
      return self.clients.openWindow(target)
    })(),
  )
})

// Lets the page ask the worker to show a reminder immediately (used when the
// Notification constructor is blocked but the worker is available).
self.addEventListener("message", (event) => {
  const data = event.data || {}
  if (data.type !== "notify") return
  event.waitUntil(
    self.registration.showNotification(data.title || "Study Reminder", {
      body: data.body || "",
      icon: "/favicon.ico",
      tag: data.tag || "llamastu-inline",
    }),
  )
})
