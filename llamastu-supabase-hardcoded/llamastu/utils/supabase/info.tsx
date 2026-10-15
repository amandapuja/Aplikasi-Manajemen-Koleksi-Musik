/**
 * Supabase connection details. Only public project values belong in the
 * browser; database access is protected by Row Level Security.
 */

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env ?? {}

const rawUrl = (env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "")
const rawKey = (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || "").trim()

export const projectId = rawUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1] ?? ""
export const publicAnonKey = rawKey
export const supabaseUrl = rawUrl
export const isSupabaseConfigured = Boolean(rawUrl && rawKey)
export const missingSupabaseVariables = [
  ...(!rawUrl ? ["NEXT_PUBLIC_SUPABASE_URL or VITE_SUPABASE_URL"] : []),
  ...(!rawKey
    ? ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY"]
    : []),
]
