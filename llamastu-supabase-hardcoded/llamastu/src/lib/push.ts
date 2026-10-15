/**
 * Service worker, notifications and Web Push.
 *
 * Everything here degrades gracefully: if the browser lacks a feature the
 * caller gets a clear reason instead of an exception, and the in-app
 * notification centre keeps working regardless.
 *
 * The VAPID *private* key is never handled by this module or the frontend. The
 * server exposes only its public key, which is exactly what
 * `pushManager.subscribe` needs.
 */

export type PushSupport = {
  serviceWorker: boolean
  notifications: boolean
  push: boolean
  permission: NotificationPermission | "unsupported"
  secureContext: boolean
}

export function pushSupport(): PushSupport {
  const hasWindow = typeof window !== "undefined"
  const secureContext = hasWindow && window.isSecureContext
  return {
    serviceWorker: hasWindow && "serviceWorker" in navigator,
    notifications: hasWindow && "Notification" in window,
    push: hasWindow && "PushManager" in window,
    permission: hasWindow && "Notification" in window ? Notification.permission : "unsupported",
    secureContext,
  }
}

/** Registers the app-shell / push service worker once. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  const support = pushSupport()
  if (!support.serviceWorker || !support.secureContext) return null
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" })
  } catch {
    return null
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index)
  return output
}

/**
 * Subscribes this browser to push using the public key supplied by the backend.
 * Returns null (with a reason) when push cannot be used here.
 */
export async function subscribeToPush(
  vapidPublicKey: string,
): Promise<{ endpoint: string; keys: { p256dh: string; auth: string } } | null> {
  const support = pushSupport()
  if (!support.push || !support.serviceWorker) return null
  if (!support.secureContext) return null

  const permission =
    support.permission === "granted" ? "granted" : await Notification.requestPermission()
  if (permission !== "granted") return null

  const registration = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker())
  if (!registration) return null

  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
    }))

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }
}

export type ArmResult = {
  /** True only when a push subscription now exists AND was stored. */
  ok: boolean
  /** Whether the browser now permits notifications, whatever else happened. */
  permitted: boolean
  /** Short, user-facing description of what actually happened. */
  message: string
  endpoint?: string
}

/**
 * The complete "enable reminders on this device" flow.
 *
 * Permission, the service worker, the push subscription and the server-side
 * record are four separate things and each can fail on its own, so the caller is
 * told which of them succeeded instead of being given one blanket success. Until
 * this ran there was no code path anywhere that called `subscribeToPush`, so a
 * subscription could never be created and background delivery could not work at
 * all.
 */
export async function armPushForDevice(
  loadPublicKey: () => Promise<{ configured: boolean; publicKey?: string | null }>,
  persist: (subscription: {
    endpoint: string
    keys: { p256dh: string; auth: string }
  }) => Promise<void>,
): Promise<ArmResult> {
  const support = pushSupport()
  if (!support.notifications) {
    return {
      ok: false,
      permitted: false,
      message: "This browser cannot show desktop notifications.",
    }
  }
  if (!support.secureContext) {
    return {
      ok: false,
      permitted: false,
      message: "Notifications need a secure (https or localhost) page.",
    }
  }

  const permission =
    support.permission === "granted" ? "granted" : await Notification.requestPermission()
  if (permission !== "granted") {
    return {
      ok: false,
      permitted: false,
      message: "Notifications are blocked for this site in your browser settings.",
    }
  }

  if (!support.push) {
    return {
      ok: false,
      permitted: true,
      // Permission is granted, so in-app and foreground alerts still work.
      message: "Notifications allowed. This browser has no push service, so alerts arrive while Llamastu is open.",
    }
  }

  const registration =
    (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker())
  if (!registration) {
    return {
      ok: false,
      permitted: true,
      message: "Notifications allowed, but the service worker could not be registered, so background push is unavailable.",
    }
  }

  let publicKey = ""
  try {
    const info = await loadPublicKey()
    publicKey = info?.publicKey ?? ""
  } catch {
    publicKey = ""
  }
  if (!publicKey) {
    return {
      ok: false,
      permitted: true,
      message:
        "Notifications allowed. Background push still needs a VAPID public key configured on the backend, so reminders arrive while Llamastu is open.",
    }
  }

  let subscription: { endpoint: string; keys: { p256dh: string; auth: string } } | null = null
  try {
    subscription = await subscribeToPush(publicKey)
  } catch {
    subscription = null
  }
  if (!subscription) {
    return {
      ok: false,
      permitted: true,
      message: "Notifications allowed, but this browser refused a push subscription.",
    }
  }

  try {
    await persist(subscription)
  } catch {
    return {
      ok: false,
      permitted: true,
      endpoint: subscription.endpoint,
      // The browser subscription exists but the server does not have it, so it
      // must not be reported as armed.
      message: "The push subscription could not be saved on the server, so background delivery is not armed.",
    }
  }

  return {
    ok: true,
    permitted: true,
    endpoint: subscription.endpoint,
    message: "Reminders are armed on this device, including while Llamastu is closed.",
  }
}

/** Removes this device's push subscription, in the browser and on the server. */
export async function disarmPushForDevice(
  forget: (endpoint: string) => Promise<void>,
): Promise<{ ok: boolean; message: string }> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) return { ok: true, message: "This device had no push subscription." }
    const endpoint = subscription.endpoint
    await subscription.unsubscribe()
    try {
      await forget(endpoint)
    } catch {
      // The browser side is already unsubscribed; the server row is harmless.
    }
    return { ok: true, message: "Push notifications are off on this device." }
  } catch {
    return { ok: false, message: "The push subscription could not be removed." }
  }
}

/** Best-effort desktop notification; falls back to the worker transport. */
export async function showReminder(title: string, body: string): Promise<boolean> {
  const support = pushSupport()
  if (!support.notifications || support.permission !== "granted") return false
  try {
    new Notification(title, { body, icon: "/favicon.ico" })
    return true
  } catch {
    const registration = await navigator.serviceWorker?.getRegistration()
    if (registration) {
      registration.active?.postMessage({ type: "notify", title, body })
      return true
    }
    return false
  }
}
