import type { AuthSession, BackendInfo, Material } from "../types"
import type { BackendDriver, UploadMeta } from "./backend"
import { LocalBackend } from "./backends/localBackend"
import { ApiError, SupabaseBackend } from "./backends/supabaseBackend"
import { DEMO_EMAIL, DEMO_PASSWORD } from "./demo"
import { isSupabaseConfigured, supabaseConfigProblem } from "./supabase"

/**
 * The single entry point the UI uses to talk to the backend.
 *
 * A configured Supabase project remains the source of truth even when its Edge
 * Function is temporarily unavailable. Falling back to IndexedDB in that case
 * makes a signed-in user's data appear to reset on another device.
 */

export type BackendStatus = BackendInfo & {
  supabaseAvailable: boolean
  /** True when the build includes Supabase configuration. */
  configured: boolean
  /** Human-readable reason cloud sync is unavailable, when applicable. */
  reason?: string
}

let driver: BackendDriver | null = null
let status: BackendStatus | null = null
let initialising: Promise<BackendStatus> | null = null

function localStatus(reason: string): BackendStatus {
  return {
    mode: "local",
    label: "Device only",
    detail: "Data is stored in this browser and is not synced across devices.",
    aiConfigured: true,
    supabaseAvailable: false,
    configured: isSupabaseConfigured,
    reason,
  }
}

export async function initBackend(force = false): Promise<BackendStatus> {
  if (status && !force) return status
  if (initialising && !force) return initialising

  initialising = (async () => {
    if (!isSupabaseConfigured) {
      driver = new LocalBackend()
      status = localStatus(
        supabaseConfigProblem() ??
          "Cloud sync is not set up on this installation.",
      )
      return status
    }

    const probe = await SupabaseBackend.probe()
    const supabase = new SupabaseBackend()
    supabase.aiConfigured = probe.ai
    driver = supabase
    status = {
      mode: "supabase",
      label: probe.ok ? supabase.label : "Cloud unavailable",
      detail: probe.ok
        ? supabase.detail
        : "Your data will stay in Supabase. Reconnect to continue loading and saving it.",
      aiConfigured: probe.ai,
      supabaseAvailable: probe.ok,
      configured: true,
      ...(probe.reason ? { reason: probe.reason } : {}),
    }
    if (!probe.ok) {
      console.warn(
        "[Llamastu] Supabase Edge Function is unavailable; keeping Supabase selected to prevent device-only data.",
        probe.reason,
      )
    }
    return status
  })()

  try {
    return await initialising
  } finally {
    initialising = null
  }
}

export async function currentStatus(): Promise<BackendStatus> {
  return status ?? initBackend()
}

export function statusSync(): BackendStatus | null {
  return status
}

/** Switches to the Supabase backend if it has become reachable since boot. */
export async function retrySupabase(): Promise<BackendStatus> {
  if (driver?.mode === "supabase" && status?.supabaseAvailable) return status
  driver?.dispose()
  driver = null
  status = null
  return initBackend(true)
}

async function active(): Promise<BackendDriver> {
  if (!driver) await initBackend()
  if (!driver) throw new Error("The app could not start. Please reload the page.")
  return driver
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const backend = await active()
  return backend.request<T>(path, options)
}

export async function uploadMaterial(
  file: File,
  meta: UploadMeta = {},
  onProgress: (value: number, stage: string) => void = () => undefined,
): Promise<Material> {
  const backend = await active()
  return backend.uploadMaterial(file, meta, onProgress)
}

export async function resolveMaterialFileUrl(material: Material): Promise<string> {
  const backend = await active()
  return backend.resolveFileUrl(material)
}

export async function getSession(): Promise<AuthSession | null> {
  const backend = await active()
  return backend.getSession()
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  const backend = await active()
  return backend.signIn(email, password)
}

export async function signInDemo(): Promise<AuthSession> {
  const backend = await active()
  if (backend.signInDemo) {
    return backend.signInDemo()
  }
  return backend.signIn(DEMO_EMAIL, DEMO_PASSWORD)
}

export async function signUp(
  email: string,
  password: string,
  name: string,
): Promise<AuthSession> {
  const backend = await active()
  return backend.signUp(email, password, name)
}

export async function signOut(): Promise<void> {
  const backend = await active()
  return backend.signOut()
}

/**
 * Mirrors backend session changes into the running application, so a session
 * that ends elsewhere — signed out in another tab, revoked, or expired — is
 * reflected here without a reload. Returns an unsubscribe function.
 */
export async function subscribeToSession(
  listener: (session: AuthSession | null) => void,
): Promise<() => void> {
  const backend = await active()
  if (!backend.onSessionChange) return () => undefined
  return backend.onSessionChange(listener)
}

export function isUnauthorised(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

export { ApiError }
