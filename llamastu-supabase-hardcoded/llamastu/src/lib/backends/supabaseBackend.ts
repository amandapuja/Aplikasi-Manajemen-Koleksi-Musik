import type { AuthSession, Material } from "../../types"
import type { BackendDriver, UploadMeta } from "../backend"
import { toAssistantReply, type AssistantWire } from "../assistantReply"
import {
  describeAcceptedTypes,
  extractText,
  isAcceptedFile,
  isTextExtractable,
  MAX_UPLOAD_BYTES,
  unsupportedReason,
} from "../extract"
import { DEMO_EMAIL, DEMO_PASSWORD } from "../demo"
import {
  getSupabase,
  isSupabaseConfigured,
  materialsBucket,
  serverUrl,
  supabaseAnonKey,
} from "../supabase"

type HealthPayload = {
  status?: string
  service?: string
  version?: number
  ai?: boolean
}

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

export class SupabaseBackend implements BackendDriver {
  readonly mode = "supabase" as const
  readonly label = "Ready"
  readonly detail = "Your learning data is saved automatically."
  aiConfigured = false

  private token: string | null = null

  /** Checks that the Edge Function is deployed and answering. */
  static async probe(timeoutMs = 7000): Promise<{ ok: boolean; ai: boolean; reason?: string }> {
    if (!isSupabaseConfigured) {
      return { ok: false, ai: false, reason: "Cloud sync is not set up on this installation." }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const client = getSupabase()
      const { data } = await client.auth.getSession()
      const response = await fetch(`${serverUrl}/health`, {
        headers: {
          apikey: supabaseAnonKey,
          ...(data.session?.access_token
            ? { Authorization: `Bearer ${data.session.access_token}` }
            : { Authorization: `Bearer ${supabaseAnonKey}` }),
        },
        signal: controller.signal,
      })
      if (!response.ok) {
        return {
          ok: false,
          ai: false,
          reason: `The service did not respond correctly (${response.status}).`,
        }
      }
      const payload = (await response.json()) as HealthPayload
      if (payload.status !== "ok") {
        return { ok: false, ai: false, reason: "The service did not respond correctly." }
      }
      return { ok: true, ai: Boolean(payload.ai) }
    } catch (reason) {
      return {
        ok: false,
        ai: false,
        reason:
          reason instanceof Error && reason.name === "AbortError"
            ? "The request took too long. Please try again."
            : "The service could not be reached.",
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /* ---------------- auth ---------------- */

  async getSession(): Promise<AuthSession | null> {
    const client = getSupabase()
    const { data, error } = await client.auth.getSession()
    if (error) throw new Error(error.message)
    const session = data.session
    if (!session) {
      this.token = null
      return null
    }
    this.token = session.access_token
    return {
      userId: session.user.id,
      email: session.user.email ?? "",
      accessToken: session.access_token,
      expiresAt: (session.expires_at ?? 0) * 1000 || null,
    }
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const client = getSupabase()
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) throw new Error(error.message)
    if (!data.session) throw new Error("Sign in did not return a session. Please try again.")
    this.token = data.session.access_token
    await this.request("/bootstrap").catch(() => undefined)
    return {
      userId: data.user?.id ?? data.session.user.id,
      email: data.user?.email ?? "",
      accessToken: data.session.access_token,
      expiresAt: (data.session.expires_at ?? 0) * 1000 || null,
    }
  }

  async signInDemo(): Promise<AuthSession> {
    return this.signIn(DEMO_EMAIL, DEMO_PASSWORD)
  }

  async signUp(email: string, password: string, name: string): Promise<AuthSession> {
    const client = getSupabase()
    const cleanEmail = email.trim().toLowerCase()
    const { data, error } = await client.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { full_name: name.trim() } },
    })
    if (error) throw new Error(error.message)
    if (!data.session) {
      // If immediate session wasn't returned, sign in directly with the same credentials
      const signInRes = await client.auth.signInWithPassword({
        email: cleanEmail,
        password,
      })
      if (signInRes.data?.session) {
        data.session = signInRes.data.session
        data.user = signInRes.data.user
      } else {
        throw new Error(
          "Akun berhasil dibuat. Silakan masuk menggunakan email dan password Anda.",
        )
      }
    }
    this.token = data.session.access_token
    await this.request("/bootstrap").catch(() => undefined)
    return {
      userId: data.user?.id ?? data.session.user.id,
      email: data.user?.email ?? "",
      accessToken: data.session.access_token,
      expiresAt: (data.session.expires_at ?? 0) * 1000 || null,
    }
  }

  async signOut(): Promise<void> {
    const client = getSupabase()
    const { error } = await client.auth.signOut()
    this.token = null
    if (error) throw new Error(error.message)
  }

  /**
   * Supabase Auth owns the session, so it is also the authority on when that
   * session changes — a refresh, a revocation from the dashboard, or a sign-out
   * in another tab. Every such event is pushed to the application instead of
   * being discovered on the next request.
   */
  onSessionChange(listener: (session: AuthSession | null) => void): () => void {
    const client = getSupabase()
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      this.token = session?.access_token ?? null
      listener(
        session
          ? {
              userId: session.user.id,
              email: session.user.email ?? "",
              accessToken: session.access_token,
              expiresAt: (session.expires_at ?? 0) * 1000 || null,
            }
          : null,
      )
    })
    return () => data.subscription.unsubscribe()
  }

  dispose(): void {
    this.token = null
  }

  /* ---------------- transport ---------------- */

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token
    const session = await this.getSession()
    if (!session?.accessToken) {
      throw new ApiError("Your session has expired. Sign in again to continue.", 401)
    }
    return session.accessToken
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (path === "/assistant" && (options.method ?? "GET").toUpperCase() === "POST") {
      return (await this.askAssistant(options)) as T
    }
    return this.send<T>(path, options)
  }

  /**
   * The assistant is the one route whose failures are part of the answer shape:
   * the server reports missing_key / rate_limited / timeout as statuses, and the
   * interface shows each of them honestly. Everything else keeps throwing.
   */
  private async askAssistant(options: RequestInit) {
    let materialId: string | null = null
    try {
      materialId = (JSON.parse(String(options.body ?? "{}")) as { materialId?: string | null }).materialId ?? null
    } catch {
      materialId = null
    }
    const id = crypto.randomUUID()
    try {
      const token = await this.ensureToken()
      const response = await fetch(`${serverUrl}/assistant`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
        },
      })
      let wire: AssistantWire | null = null
      try {
        wire = (await response.json()) as AssistantWire
      } catch {
        wire = null
      }
      if (response.status === 401) {
        this.token = null
        throw new ApiError("Your session has expired. Sign in again to continue.", 401)
      }
      return toAssistantReply(response.status, wire, materialId, id)
    } catch (reason) {
      if (reason instanceof ApiError) throw reason
      return toAssistantReply(
        0,
        {
          status: "unreachable",
          detail: "The assistant could not be reached. Check your connection and try again.",
        },
        materialId,
        id,
      )
    }
  }

  private async send<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await this.ensureToken()
    let response: Response
    try {
      response = await fetch(`${serverUrl}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
          ...(options.headers ?? {}),
        },
      })
    } catch {
      throw new Error(
        "Cannot reach Llamastu right now. Check your connection and try again.",
      )
    }

    if (response.status === 204) return undefined as T

    const raw = await response.text()
    let payload: unknown = null
    if (raw) {
      try {
        payload = JSON.parse(raw)
      } catch {
        payload = null
      }
    }

    if (!response.ok) {
      const message =
        (payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error: unknown }).error)
          : null) ||
        (response.status === 401
          ? "Your session has expired. Sign in again to continue."
          : response.status === 403
            ? "You do not have permission to do that."
            : "The request could not be completed. Please try again.")
      if (response.status === 401) this.token = null
      throw new ApiError(message, response.status)
    }

    return payload as T
  }

  /* ---------------- upload ---------------- */

  async uploadMaterial(
    file: File,
    meta: UploadMeta,
    onProgress: (value: number, stage: string) => void,
  ): Promise<Material> {
    if (!isAcceptedFile(file)) {
      throw new Error(`Unsupported file. Accepted formats: ${describeAcceptedTypes()}.`)
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error("Files must be smaller than 25 MB.")
    }

    const session = await this.getSession()
    if (!session) throw new Error("Your session has expired. Sign in again to continue.")

    onProgress(6, "Uploading your file…")
    const materialId = crypto.randomUUID()
    const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(-120)
    const storagePath = `${session.userId}/${materialId}/${safeName}`

    const client = getSupabase()
    const { error: uploadError } = await client.storage
      .from(materialsBucket)
      .upload(storagePath, file, {
        cacheControl: "3600",
        contentType: file.type || "application/octet-stream",
        upsert: false,
      })
    if (uploadError) {
      throw new Error(
        "The file could not be uploaded. Please check your connection and try again.",
      )
    }
    onProgress(45, "Reading the document…")

    let extracted = ""
    let extractionError: string | null = null
    if (isTextExtractable(file)) {
      try {
        const result = await extractText(file)
        extracted = result.text
        if (extracted.trim().length < 60) {
          extractionError = unsupportedReason(file)
        }
      } catch (reason) {
        extractionError =
          reason instanceof Error ? reason.message : "Text extraction failed for this file."
      }
    } else {
      extractionError = unsupportedReason(file)
    }

    onProgress(62, "Creating the material record…")
    const created = await this.request<Material>("/materials", {
      method: "POST",
      body: JSON.stringify({
        id: materialId,
        name: file.name,
        title: meta.title?.trim() || file.name.replace(/\.[^.]+$/, ""),
        subject: meta.subject?.trim() || null,
        type: file.type || "application/octet-stream",
        size: file.size,
        storagePath,
        status: extractionError ? "needs_text" : "processing",
        errorMessage: extractionError,
        extractedText: extracted || null,
      }),
    })

    if (extractionError) {
      onProgress(100, extractionError)
      return created
    }

    onProgress(78, "Generating summary, flashcards and challenges…")
    const result = await this.request<{ material: Material }>(
      `/materials/${materialId}/process`,
      {
        method: "POST",
        body: JSON.stringify({
          questionCount: meta.questionCount ?? 10,
          difficulty: meta.difficulty ?? "medium",
          text: extracted,
        }),
      },
    )
    onProgress(100, "Your study world is ready")
    return result.material
  }

  async resolveFileUrl(material: Material): Promise<string> {
    if (!material.storagePath) {
      throw new Error("This material has no stored file.")
    }
    const client = getSupabase()
    const { data, error } = await client.storage
      .from(materialsBucket)
      .createSignedUrl(material.storagePath, 60 * 30)
    if (error || !data?.signedUrl) {
      throw new Error(
        "This file could not be opened. Please try again.",
      )
    }
    return data.signedUrl
  }
}
