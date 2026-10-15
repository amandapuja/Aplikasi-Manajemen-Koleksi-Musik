import type { AuthSession, BackendMode, Material } from "../types"

export type UploadMeta = {
  title?: string
  subject?: string
  questionCount?: number
  difficulty?: "easy" | "medium" | "hard"
}

/**
 * A backend driver is a complete, self-contained implementation of the
 * Llamastu API. The UI only ever talks to `src/lib/api.ts`, which forwards to
 * whichever driver is active, so every screen behaves identically whether the
 * Supabase backend is reachable or the on-device backend is in use.
 */
export interface BackendDriver {
  readonly mode: BackendMode
  readonly label: string
  readonly detail: string
  readonly aiConfigured: boolean

  getSession(): Promise<AuthSession | null>
  signUp(email: string, password: string, name: string): Promise<AuthSession>
  signIn(email: string, password: string): Promise<AuthSession>
  signInDemo?(): Promise<AuthSession>
  signOut(): Promise<void>
  /**
   * Reports session changes the driver did not originate, such as a token that
   * expired or a sign-out performed in another tab. Returns an unsubscribe
   * function. Optional: a driver with no external session source omits it.
   */
  onSessionChange?(listener: (session: AuthSession | null) => void): () => void

  request<T>(path: string, options?: RequestInit): Promise<T>

  /** Stores the file with the active backend and runs the full processing pipeline. */
  uploadMaterial(
    file: File,
    meta: UploadMeta,
    onProgress: (value: number, stage: string) => void,
  ): Promise<Material>

  /** Returns a browser-usable URL for the stored original file. */
  resolveFileUrl(material: Material): Promise<string>

  dispose(): void
}
