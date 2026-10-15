import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  isSupabaseConfigured,
  missingSupabaseVariables,
  publicAnonKey,
  supabaseUrl,
} from "../../utils/supabase/info"

/**
 * Supabase client configuration.
 *
 * Everything comes from Vite environment variables — the repository contains no
 * project reference and no key. See `.env.example` for the full list.
 *
 * Only the anonymous (public) key is used in the browser. It is protected by
 * Row Level Security. The service-role key exists solely in the Edge Function
 * environment and is never referenced from this bundle.
 */

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env ?? {}

export const functionsName = env.VITE_SUPABASE_FUNCTIONS_NAME || "server"

export const serverUrl = `${supabaseUrl}/functions/v1/${functionsName}`

/**
 * Where the on-device workspace sends assistant questions. An explicit
 * VITE_ASSISTANT_URL wins; otherwise use this project's rate-limited public
 * assistant route. Provider credentials remain server-side.
 */
export const assistantPublicUrl: string | null = (() => {
  const explicit = env.VITE_ASSISTANT_URL?.trim()
  if (explicit) return explicit
  return isSupabaseConfigured ? `${serverUrl}/assistant/public` : null
})()

export const materialsBucket = env.VITE_SUPABASE_MATERIALS_BUCKET || "materials"

export { isSupabaseConfigured, missingSupabaseVariables, supabaseUrl }

export const supabaseAnonKey = publicAnonKey

/**
 * Neutral explanation handed to the caller when the build carries no usable
 * configuration. It names no internal component, because the value can end up
 * in copy that a person reads.
 */
export function supabaseConfigProblem(): string | null {
  return isSupabaseConfigured ? null : "Some parts of the application are not available right now."
}

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error("This feature is not available right now. Please try again.")
  }
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "llamastu.supabase.auth",
      },
    })
  }
  return client
}
