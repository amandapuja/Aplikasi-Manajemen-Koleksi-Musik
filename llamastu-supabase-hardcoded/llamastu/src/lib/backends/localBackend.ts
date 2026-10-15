import type {
  ActivityKind,
  AppPreferences,
  AppData,
  AppNotification,
  AssistantMessage,
  AssistantReply,
  AuthSession,
  CalendarCategory,
  CalendarEvent,
  Character,
  GameProgress,
  Material,
  MaterialStatus,
  Note,
  NoteAccess,
  NoteShareMode,
  NotificationPreferences,
  Profile,
  Question,
  QuizAttempt,
  RepeatRule,
  Schedule,
  SharedNoteView,
  StudyActivity,
  XpTransaction,
} from "../../types"
import type { BackendDriver, UploadMeta } from "../backend"
import { toAssistantReply, type AssistantWire } from "../assistantReply"
import { askGroq } from "../groqDirect"
import { assistantPublicUrl, supabaseAnonKey } from "../supabase"
import { DEFAULT_NOTIFICATION_PREFERENCES, computeReminderAt, dayKey } from "../calendar"
import {
  DEMO_EMAIL,
  DEMO_MATERIALS,
  DEMO_NAME,
  DEMO_SESSION_KEY,
  DEMO_USER_ID,
  demoIdentityFrom,
  type DemoUser,
} from "../demo"
import { generateLearningContent, normalizeText } from "../content"
import {
  describeAcceptedTypes,
  extractText,
  isAcceptedFile,
  isTextExtractable,
  MAX_UPLOAD_BYTES,
  unsupportedReason,
} from "../extract"
import {
  ACHIEVEMENTS,
  DEFAULT_CHARACTER,
  achievementStates,
  activityKey as makeActivityKey,
  computeStudyStreak,
  evaluateAchievements,
  eventKeyAchievement,
  eventKeyCollectible,
  eventKeyGate,
  eventKeyMaterial,
  eventKeyNote,
  eventKeyQuizAnswer,
  eventKeySchedule,
  eventKeyWorld,
  gameKey,
  levelForXp,
  XP,
} from "../rules"

/* ------------------------------------------------------------------ *
 * Stored row shapes
 * ------------------------------------------------------------------ */

type AccountRow = {
  id: string
  email: string
  name: string
  passwordHash: string
  salt: string
  createdAt: string
}
type SessionRow = { token: string; accountId: string; createdAt: string; expiresAt: string }
type ProfileRow = Profile & {
  id: string
  character?: Character
  appPreferences?: AppPreferences
}
type MaterialRow = Material & { userId: string }
type QuestionRow = Question & { materialId: string; userId: string }
type AttemptRow = QuizAttempt & { userId: string }
type NoteRow = Note
type CollaboratorRow = {
  id: string
  noteId: string
  userId: string
  email: string
  permission: "viewer" | "editor"
}
type CalendarRow = CalendarEvent & { id: string; userId: string }
type NotificationRow = AppNotification & { userId: string }
type GameRow = GameProgress & { id: string; userId: string }
type XpEventRow = { id: string; userId: string; eventKey: string; xp: number; createdAt: string }
type DailyActivityRow = { id: string; userId: string; date: string }
type FileRow = { id: string; blob: Blob; name: string; type: string }
type PrefsRow = { id: string; userId: string; preferences: NotificationPreferences }
type MetaRow = { key: string; character?: Character }
type StudyActivityRow = StudyActivity
type AchievementRow = { id: string; userId: string; code: string; unlockedAt: string }
type PushSubRow = {
  id: string
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string
  createdAt: string
}
type DeliveryRow = {
  id: string
  userId: string
  eventId: string
  /** The exact reminder instant this delivery belongs to, so a moved event
   *  produces a new row rather than silently reusing a stale one. */
  reminderAt: string
  channel: "in-app" | "browser" | "push"
  status: "scheduled" | "delivered" | "failed"
  detail: string
  createdAt: string
  deliveredAt: string | null
}

const gameRowId = (userId: string, materialId: string, mapId: string) =>
  `${userId}|${gameKey(materialId, mapId)}`

/* ------------------------------------------------------------------ *
 * IndexedDB plumbing
 * ------------------------------------------------------------------ */

const DB_NAME = "llamastu-platform"
// v2 replaced the standalone `schedules` store with `calendarEvents`, so the
// timetable and the calendar share one source of truth.
// v3 adds the authoritative study-activity ledger, the achievement store and
// the reminder-delivery / push-subscription stores. A version bump is required
// because an existing database never re-runs `onupgradeneeded` otherwise, so the
// new stores would silently not exist for anyone who already has data.
const DB_VERSION = 3
const SESSION_KEY = "llamastu.session.token"

const STORE = {
  accounts: "accounts",
  sessions: "sessions",
  profiles: "profiles",
  materials: "materials",
  questions: "questions",
  attempts: "attempts",
  notes: "notes",
  collaborators: "collaborators",
  calendarEvents: "calendarEvents",
  notifications: "notifications",
  notificationPrefs: "notificationPrefs",
  games: "games",
  xpEvents: "xpEvents",
  dailyActivity: "dailyActivity",
  studyActivity: "studyActivity",
  achievements: "achievements",
  pushSubscriptions: "pushSubscriptions",
  deliveries: "deliveries",
  meta: "meta",
  files: "files",
} as const

type StoreName = (typeof STORE)[keyof typeof STORE]

let dbPromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser cannot save your data. Please try a different browser."))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      const db = request.result
      const ensure = (name: StoreName, keyPath: string) => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath })
      }
      ensure(STORE.accounts, "id")
      ensure(STORE.sessions, "token")
      ensure(STORE.profiles, "id")
      ensure(STORE.materials, "id")
      ensure(STORE.questions, "id")
      ensure(STORE.attempts, "id")
      ensure(STORE.notes, "id")
      ensure(STORE.collaborators, "id")
      ensure(STORE.calendarEvents, "id")
      ensure(STORE.notifications, "id")
      ensure(STORE.notificationPrefs, "id")
      ensure(STORE.games, "id")
      ensure(STORE.xpEvents, "id")
      ensure(STORE.dailyActivity, "id")
      ensure(STORE.studyActivity, "id")
      ensure(STORE.achievements, "id")
      ensure(STORE.pushSubscriptions, "id")
      ensure(STORE.deliveries, "id")
      ensure(STORE.meta, "key")
      ensure(STORE.files, "id")

      // Migrate any legacy schedule rows into the calendar store so no existing
      // entry is lost when the two systems are unified.
      //
      // This only applies to a database that was created at version 1 and still
      // has the old store. A brand-new database reports oldVersion 0 and has no
      // `schedules` store at all, so looking it up unconditionally threw
      // NotFoundError and aborted the whole upgrade, which left the database
      // uncreated. Hence the explicit version test and the guarded lookup: a
      // missing legacy store must never be able to break a first run.
      const previousVersion = (event as IDBVersionChangeEvent).oldVersion
      if (previousVersion >= 1 && previousVersion < 2 && request.transaction) {
        let legacy: IDBObjectStore | null = null
        try {
          legacy = request.transaction.objectStore("schedules")
        } catch {
          legacy = null
        }
        const dropLegacy = () => {
          try {
            if (db.objectStoreNames.contains("schedules")) db.deleteObjectStore("schedules")
          } catch {
            /* the store is already gone */
          }
        }
        if (!legacy) {
          dropLegacy()
        } else {
          const read = legacy.getAll()
          read.onsuccess = () => {
            const target = request.transaction!.objectStore(STORE.calendarEvents)
            for (const row of read.result as Record<string, unknown>[]) {
              const startAt = String(row.startAt ?? "")
              const reminderMinutes = Number(row.reminderMinutes ?? 0)
              target.put({
                id: String(row.id),
                userId: String(row.userId ?? ""),
                title: String(row.course ?? "Class"),
                description: String(row.notes ?? ""),
                category: "class",
                startAt,
                endAt: String(row.endAt ?? startAt),
                location: (row.room as string) ?? null,
                reminderMinutes,
                repeatRule: row.repeatRule === "weekly" ? "weekly" : "none",
                materialId: null,
                reminderAt: computeReminderAt(startAt, reminderMinutes),
                reminderSentAt: null,
                createdAt: String(row.createdAt ?? new Date().toISOString()),
                updatedAt: String(row.updatedAt ?? new Date().toISOString()),
              })
            }
            dropLegacy()
          }
          read.onerror = dropLegacy
        }
      }
    }
    // An older version still open in another tab would otherwise leave this
    // promise pending for ever, so the entry screen would sit on "Memuat…" with
    // nothing to report. Failing here turns that into a clear, retryable message.
    request.onblocked = () =>
      reject(
        new Error(
          "Your saved data is open in another tab. Close the other tab and try again.",
        ),
      )
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("Your saved data could not be opened. Please reload the page."))
  })
  // A failed open must not be replayed for ever: clearing the cached promise lets
  // the next attempt genuinely try again instead of returning the same rejection.
  dbPromise = attempt.catch((reason: unknown) => {
    dbPromise = null
    throw reason
  })
  return dbPromise
}

async function run<T>(
  name: StoreName,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(name, mode)
    const request = work(transaction.objectStore(name))
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () =>
      reject(request.error ?? new Error("Your saved data could not be read. Please reload the page."))
  })
}

const readAll = <T>(name: StoreName) => run<T[]>(name, "readonly", (store) => store.getAll())
const readOne = <T>(name: StoreName, key: string) =>
  run<T | undefined>(name, "readonly", (store) => store.get(key))

const write = <T>(name: StoreName, value: T) =>
  run<IDBValidKey>(name, "readwrite", (store) => {
    const keyPath = store.keyPath
    if (typeof keyPath === "string") {
      const record = value as unknown as Record<string, unknown>
      if (!record || record[keyPath] === undefined || record[keyPath] === null) {
        throw new Error(`Internal error: a record for "${name}" is missing its "${keyPath}" key.`)
      }
    }
    return store.put(value as never)
  })

const drop = (name: StoreName, key: string) =>
  run<undefined>(name, "readwrite", (store) => store.delete(key)).then(() => undefined)

/* ------------------------------------------------------------------ *
 * Crypto
 * ------------------------------------------------------------------ */

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < length; index += 1)
      bytes[index] = Math.floor(Math.random() * 256)
  }
  return bytes
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return Array.from(randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

function fromHex(value: string): Uint8Array {
  const pairs = value.match(/.{1,2}/g) ?? []
  return new Uint8Array(pairs.map((pair) => parseInt(pair, 16)))
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** SHA-256 used only when WebCrypto is unavailable (non-secure origin). */
function sha256(bytes: Uint8Array): Uint8Array {
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const bitLength = bytes.length * 8
  const paddedLength = (((bytes.length + 8) >> 6) + 1) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false)

  const w = new Uint32Array(64)
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const p15 = w[index - 15]
      const p2 = w[index - 2]
      const s0 = ((p15 >>> 7) | (p15 << 25)) ^ ((p15 >>> 18) | (p15 << 14)) ^ (p15 >>> 3)
      const s1 = ((p2 >>> 17) | (p2 << 15)) ^ ((p2 >>> 19) | (p2 << 13)) ^ (p2 >>> 10)
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const choice = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + choice + SHA256_K[index] + w[index]) >>> 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    hash[0] = (hash[0] + a) >>> 0
    hash[1] = (hash[1] + b) >>> 0
    hash[2] = (hash[2] + c) >>> 0
    hash[3] = (hash[3] + d) >>> 0
    hash[4] = (hash[4] + e) >>> 0
    hash[5] = (hash[5] + f) >>> 0
    hash[6] = (hash[6] + g) >>> 0
    hash[7] = (hash[7] + h) >>> 0
  }
  const output = new Uint8Array(32)
  const outputView = new DataView(output.buffer)
  hash.forEach((value, index) => outputView.setUint32(index * 4, value, false))
  return output
}

const PBKDF2_ITERATIONS = 150_000
const FALLBACK_ROUNDS = 12_000

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const salt = fromHex(saltHex)
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    )
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      key,
      256,
    )
    return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(new Uint8Array(bits))}`
  }

  let digest: Uint8Array = new TextEncoder().encode(`${saltHex}::${password}`)
  for (let round = 0; round < FALLBACK_ROUNDS; round += 1) {
    const combined = new Uint8Array(digest.length + salt.length)
    combined.set(digest)
    combined.set(salt, digest.length)
    digest = sha256(combined)
  }
  return `sha256x$${FALLBACK_ROUNDS}$${toHex(digest)}`
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function todayKeyLocal(): string {
  return dayKey(new Date())
}

/**
 * A share token has to be unguessable: it is the only thing protecting a shared
 * link, so it is drawn from the CSPRNG rather than from a counter or a hash of
 * the note id.
 */
function createShareToken(): string {
  return toHex(randomBytes(24))
}

/**
 * Older note rows predate link sharing and versioning, so they are normalised on
 * the way out instead of being assumed to carry the new fields.
 */
function normalizeNote(row: Partial<Note> & { id: string; ownerId: string }): Note {
  return {
    id: row.id,
    ownerId: row.ownerId,
    ownerEmail: row.ownerEmail ?? "",
    title: row.title ?? "Untitled note",
    content: row.content ?? "",
    materialId: row.materialId ?? null,
    collaborators: row.collaborators ?? [],
    shareToken: typeof row.shareToken === "string" && row.shareToken ? row.shareToken : null,
    shareMode:
      row.shareMode === "view" || row.shareMode === "edit" ? row.shareMode : "private",
    version: Number.isFinite(row.version) ? Number(row.version) : 1,
    createdAt: row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updatedAt ?? new Date().toISOString(),
  }
}

/* ------------------------------------------------------------------ *
 * Driver
 * ------------------------------------------------------------------ */

export class LocalBackend implements BackendDriver {
  readonly mode = "local" as const
  readonly label = "Ready"
  readonly detail = "Your learning data is saved automatically."
  readonly aiConfigured = false

  private currentUserId: string | null = null

  /* ---------------- authentication ---------------- */

  async getSession(): Promise<AuthSession | null> {
    if (typeof localStorage === "undefined") return null
    const token = localStorage.getItem(SESSION_KEY)
    if (!token) return null
    const session = await readOne<SessionRow>(STORE.sessions, token)
    if (!session) {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await drop(STORE.sessions, token)
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    const account = await readOne<AccountRow>(STORE.accounts, session.accountId)
    if (!account) {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    this.currentUserId = account.id
    return {
      userId: account.id,
      email: account.email,
      accessToken: token,
      expiresAt: new Date(session.expiresAt).getTime(),
    }
  }

  async signUp(email: string, password: string, name: string): Promise<AuthSession> {
    const normalized = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Enter a valid email address.")
    if (password.length < 8) throw new Error("Use at least 8 characters for your password.")
    const accounts = await readAll<AccountRow>(STORE.accounts)
    if (accounts.some((account) => account.email === normalized)) {
      throw new Error("An account with this email already exists. Sign in instead.")
    }
    const salt = toHex(randomBytes(16))
    const account: AccountRow = {
      id: randomId(),
      email: normalized,
      name: name.trim() || normalized.split("@")[0],
      salt,
      passwordHash: await hashPassword(password, salt),
      createdAt: new Date().toISOString(),
    }
    await write(STORE.accounts, account)
    await write<ProfileRow>(STORE.profiles, {
      id: account.id,
      name: account.name,
      username: account.name.toLowerCase().replace(/\s+/g, "."),
      email: account.email,
      program: "",
      semester: "",
      bio: "",
      character: { ...DEFAULT_CHARACTER },
    })
    await write<PrefsRow>(STORE.notificationPrefs, {
      id: account.id,
      userId: account.id,
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    })
    await this.notify(account.id, {
      title: "Welcome to Llamastu",
      message: "Upload your first course document to generate a study world.",
      kind: "system",
    })
    return this.createSession(account)
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const normalized = email.trim().toLowerCase()
    const accounts = await readAll<AccountRow>(STORE.accounts)
    const account = accounts.find((item) => item.email === normalized)
    if (!account) throw new Error("No account matches this email.")
    const candidate = await hashPassword(password, account.salt)
    if (!timingSafeEqual(candidate, account.passwordHash)) {
      throw new Error("That password is not correct.")
    }
    return this.createSession(account)
  }

  /**
   * Signs in to the shared demo account, creating and seeding it on first use.
   * The account is ordinary: real salt, real PBKDF2 hash, real session, real
   * rows. Seeding only produces data through the same code paths a normal
   * account uses, so nothing in the demo is fabricated at render time.
   */
  async signInDemo(): Promise<AuthSession> {
    return this.enterDemoSession(DEMO_NAME)
  }

  /**
   * Opens the demo workspace from a name alone.
   *
   * Nothing is authenticated and nothing is checked: the workspace is created on
   * first use and seeded so every screen already has content to show. Re-entering
   * with a different name simply renames the same workspace, so the seeded
   * materials, progress and calendar stay where they are.
   */
  async enterDemoSession(input: string): Promise<AuthSession> {
    const identity = demoIdentityFrom(input)
    const account = await this.ensureDemoAccount(identity)
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(identity))
    }
    return this.createSession(account)
  }

  private async ensureDemoAccount(identity: DemoUser = demoIdentityFrom(DEMO_NAME)): Promise<AccountRow> {
    const accounts = await readAll<AccountRow>(STORE.accounts)
    // Either the demo workspace itself, or an installation that already seeded the
    // shared account, so an existing demo is renamed rather than duplicated.
    const existing =
      accounts.find((item) => item.id === DEMO_USER_ID) ??
      accounts.find((item) => item.email === DEMO_EMAIL)
    if (existing) {
      const renamed: AccountRow = { ...existing, name: identity.name, email: identity.email }
      /**
       * Both rows are written on every entry, not only when the account row
       * happens to differ.
       *
       * The old guard compared the ACCOUNT row only. If the account already
       * carried the typed name while the PROFILE row held an older one — which
       * happens as soon as anyone edits their display name in Settings, and on
       * any installation whose profile was written by an earlier build — the
       * guard short-circuited, nothing was written, and the name typed on the
       * login screen was not the name shown after login. Writing both rows
       * unconditionally makes that divergence impossible, because the profile is
       * what every screen actually reads via `getProfile`.
       */
      await write(STORE.accounts, renamed)
      const username = identity.name.toLowerCase().replace(/[^a-z0-9]+/g, ".")
      const profile = await readOne<ProfileRow>(STORE.profiles, existing.id)
      await write<ProfileRow>(STORE.profiles, {
        ...(profile ?? {}),
        id: existing.id,
        name: identity.name,
        username,
        email: identity.email,
        // Only defaults for a profile that did not exist yet.
        program: profile?.program ?? "",
        semester: profile?.semester ?? "",
        bio: profile?.bio ?? "",
      } as ProfileRow)
      return renamed
    }

    const salt = toHex(randomBytes(16))
    const account: AccountRow = {
      id: DEMO_USER_ID,
      email: identity.email,
      name: identity.name,
      salt,
      // A random value that is never shown and never checked; the demo entry point
      // asks for a name, not a credential.
      passwordHash: await hashPassword(`${randomId()}${randomId()}`, salt),
      createdAt: new Date().toISOString(),
    }
    await write(STORE.accounts, account)
    await write<ProfileRow>(STORE.profiles, {
      id: account.id,
      name: identity.name,
      username: identity.name.toLowerCase().replace(/[^a-z0-9]+/g, "."),
      email: identity.email,
      program: "Information Technology",
      semester: "4",
      bio: "Shared demo profile. Everything here was generated from the two course documents below.",
      character: { ...DEFAULT_CHARACTER, model: "female" },
    })
    await write<PrefsRow>(STORE.notificationPrefs, {
      id: account.id,
      userId: account.id,
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    })

    let firstMaterialId = ""
    let firstQuestionIds: string[] = []

    for (const [index, seed] of DEMO_MATERIALS.entries()) {
      const generated = generateLearningContent(seed.text, { questionCount: 10 })
      const materialId = randomId()
      const now = new Date(Date.now() - (index + 1) * 3_600_000).toISOString()

      const questions: QuestionRow[] = generated.questions.map((question, position) => ({
        id: randomId(),
        materialId,
        userId: account.id,
        position,
        question: question.question,
        choices: question.choices,
        answerIndex: question.answerIndex,
        explanation: question.explanation,
        difficulty: question.difficulty,
      }))
      for (const question of questions) await write(STORE.questions, question)

      await write<MaterialRow>(STORE.materials, {
        id: materialId,
        userId: account.id,
        title: seed.title,
        name: seed.name,
        subject: seed.subject,
        type: "text/plain",
        size: new Blob([seed.text]).size,
        storagePath: null,
        status: "ready",
        errorMessage: null,
        summary: generated.summary,
        keyPoints: generated.keyPoints,
        objectives: generated.objectives,
        flashcards: generated.flashcards.map((card) => ({ ...card, id: randomId() })),
        extractedText: seed.text,
        questions: questions.map(({ materialId: _m, userId: _u, ...question }) => question),
        wordCount: generated.wordCount,
        xpAwarded: true,
        processedAt: now,
        createdAt: now,
        updatedAt: now,
      })

      await this.awardXp(account.id, [
        { key: eventKeyMaterial(materialId), xp: XP.materialProcessed },
      ])

      if (index === 0) {
        firstMaterialId = materialId
        firstQuestionIds = questions.map((question) => question.id)
      } else {
        // A finished quiz attempt on the second material, so the history and
        // the quiz statistics have real numbers behind them.
        const score = Math.max(1, questions.length - 2)
        await write<AttemptRow>(STORE.attempts, {
          id: randomId(),
          userId: account.id,
          materialId,
          score,
          total: questions.length,
          xpAwarded: 0,
          answers: Object.fromEntries(
            questions.slice(0, score).map((question) => [question.id, question.answerIndex]),
          ),
          createdAt: now,
        })
        await this.awardXp(
          account.id,
          questions
            .slice(0, score)
            .map((question) => ({
              key: eventKeyQuizAnswer(materialId, question.id),
              xp: XP.quizQuestionCorrect,
            })),
        )
      }
    }

    // A world that is already part-way through, and finished, on map one.
    if (firstMaterialId) {
      const mapId = "obstacle_adventure"
      const opened = firstQuestionIds.slice(0, 4)
      await write<GameRow>(STORE.games, {
        ...emptyGameProgress(firstMaterialId, mapId),
        id: gameRowId(account.id, firstMaterialId, mapId),
        userId: account.id,
        characterId: "female",
        orbTotal: 46,
        openedGates: opened,
        collected: ["orb-start-0", "orb-start-1", "orb-0-c", "orb-1-c", "orb-2-c"],
        checkpoints: ["checkpoint-start", "checkpoint-1", "checkpoint-2"],
        position: 2400,
        finished: true,
        xpAwarded: 0,
        bestTimeSeconds: 214,
      })
      await this.awardXp(account.id, [
        ...opened.map((questionId) => ({
          key: eventKeyGate(firstMaterialId, mapId, questionId),
          xp: XP.gateOpened,
        })),
        ...["orb-start-0", "orb-start-1", "orb-0-c", "orb-1-c", "orb-2-c"].map((orbId) => ({
          key: eventKeyCollectible(firstMaterialId, mapId, orbId),
          xp: XP.collectible,
        })),
        { key: eventKeyWorld(firstMaterialId, mapId), xp: XP.worldFinished },
      ])
    }

    // Calendar: one class and one study session, each with its own reminder.
    const now = new Date()
    const classStart = new Date(now)
    classStart.setDate(classStart.getDate() + 1)
    classStart.setHours(9, 0, 0, 0)
    const classEnd = new Date(classStart.getTime() + 100 * 60_000)
    const classId = randomId()
    await write<CalendarRow>(STORE.calendarEvents, {
      id: classId,
      userId: account.id,
      title: "Struktur Data",
      description: "Weekly lecture.",
      category: "class",
      startAt: classStart.toISOString(),
      endAt: classEnd.toISOString(),
      location: "Lab 3.02",
      reminderMinutes: 30,
      repeatRule: "weekly",
      materialId: null,
      reminderAt: computeReminderAt(classStart.toISOString(), 30),
      reminderSentAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    await this.awardXp(account.id, [{ key: eventKeySchedule(classId), xp: XP.scheduleCreated }])

    const studyStart = new Date(now)
    studyStart.setHours(19, 0, 0, 0)
    if (studyStart.getTime() < now.getTime()) studyStart.setDate(studyStart.getDate() + 1)
    const studyId = randomId()
    await write<CalendarRow>(STORE.calendarEvents, {
      id: studyId,
      userId: account.id,
      title: "Belajar Struktur Data",
      description: "Revise multi linked list traversal before the quiz.",
      category: "study",
      startAt: studyStart.toISOString(),
      endAt: new Date(studyStart.getTime() + 60 * 60_000).toISOString(),
      location: null,
      reminderMinutes: 15,
      repeatRule: "none",
      materialId: firstMaterialId || null,
      reminderAt: computeReminderAt(studyStart.toISOString(), 15),
      reminderSentAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })

    // One note linked to the first material.
    const noteId = randomId()
    await write<NoteRow>(STORE.notes, {
      id: noteId,
      ownerId: account.id,
      ownerEmail: DEMO_EMAIL,
      title: "Multi linked list - revision notes",
      content:
        "<p>A node belongs to <b>two</b> lists at once: a row list and a column list.</p>" +
        "<ul><li>Header nodes are sentinels and carry no data.</li>" +
        "<li>Insertion must update every list the node joins.</li>" +
        "<li>Deletion must unlink from every list before freeing.</li></ul>",
      materialId: firstMaterialId || null,
      collaborators: [],
      shareToken: null,
      shareMode: "private",
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    await this.awardXp(account.id, [{ key: eventKeyNote(noteId), xp: XP.noteCreated }])

    // Seeded study history: the demo workspace already has a processed material,
    // a scored quiz and a finished world, so the days it has a record for are the
    // days it genuinely did those things. Each row is an ordinary activity record
    // with a real kind — nothing here is a counter bolted on afterwards.
    const seededActivity: { kind: ActivityKind; subject: string; daysAgo: number }[] = [
      { kind: "material_processed", subject: firstMaterialId || "seed-material", daysAgo: 2 },
      { kind: "quiz_completed", subject: firstMaterialId || "seed-quiz", daysAgo: 1 },
      { kind: "gate_opened", subject: "seed-gate", daysAgo: 1 },
      { kind: "world_finished", subject: "seed-world", daysAgo: 0 },
    ]
    for (const item of seededActivity) {
      const day = new Date(now)
      day.setDate(day.getDate() - item.daysAgo)
      const activity = makeActivityKey(item.kind, item.subject)
      await write<StudyActivityRow>(STORE.studyActivity, {
        id: `${account.id}:${activity}`,
        userId: account.id,
        kind: item.kind,
        date: dayKey(day),
        activityKey: activity,
        createdAt: day.toISOString(),
      })
    }

    await this.notify(account.id, {
      title: "Welcome to the demo",
      message:
        "Two course documents are already processed. Open one to read its summary, take the quiz, or play its worlds.",
      kind: "system",
    })
    await this.notify(account.id, {
      title: "Material ready",
      message: `${DEMO_MATERIALS[0].title} produced challenges, a summary and flashcards.`,
      kind: "material",
    })

    await this.recomputeProgress(account.id)
    return account
  }

  async signOut(): Promise<void> {
    if (typeof localStorage !== "undefined") {
      const token = localStorage.getItem(SESSION_KEY)
      if (token) await drop(STORE.sessions, token)
      localStorage.removeItem(SESSION_KEY)
      // The remembered demo identity goes too, so the next visit starts at the
      // entry screen instead of silently reopening the workspace.
      localStorage.removeItem(DEMO_SESSION_KEY)
    }
    this.currentUserId = null
  }

  dispose(): void {
    this.currentUserId = null
  }

  /**
   * The session token lives in localStorage, which the browser shares across
   * every tab of the same origin. Watching for a change to that key means a
   * sign-out in another tab ends the session here too, rather than leaving this
   * tab showing an account that is no longer open.
   */
  onSessionChange(listener: (session: AuthSession | null) => void): () => void {
    if (typeof window === "undefined") return () => undefined
    const onStorage = (event: StorageEvent) => {
      // `key === null` is a full clear; either way, re-read the truth.
      if (event.key !== null && event.key !== SESSION_KEY) return
      this.currentUserId = null
      void this.getSession().then(listener)
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }

  private async createSession(account: AccountRow): Promise<AuthSession> {
    const token = `${randomId()}${randomId()}`.replace(/-/g, "")
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
    await write<SessionRow>(STORE.sessions, {
      token,
      accountId: account.id,
      createdAt: new Date().toISOString(),
      expiresAt,
    })
    localStorage.setItem(SESSION_KEY, token)
    this.currentUserId = account.id
    return {
      userId: account.id,
      email: account.email,
      accessToken: token,
      expiresAt: new Date(expiresAt).getTime(),
    }
  }

  /* ---------------- helpers ---------------- */

  private requireUserId(): string {
    if (!this.currentUserId) throw new Error("Your session has expired. Sign in again to continue.")
    return this.currentUserId
  }

  private async awardXp(userId: string, events: { key: string; xp: number }[]): Promise<number> {
    if (!events.length) return 0
    const existing = (await readAll<XpEventRow>(STORE.xpEvents)).filter((event) => event.userId === userId)
    const known = new Set(existing.map((event) => event.eventKey))
    let awarded = 0
    for (const event of events) {
      if (known.has(event.key)) continue
      known.add(event.key)
      awarded += event.xp
      await write<XpEventRow>(STORE.xpEvents, {
        id: randomId(),
        userId,
        eventKey: event.key,
        xp: event.xp,
        createdAt: new Date().toISOString(),
      })
    }
    return awarded
  }

  /**
   * Records ONE qualifying learning activity, idempotently.
   *
   * Only a processed material, a completed recorded quiz, an opened challenge
   * gate and a finished world call this. Opening a page does not, which is what
   * makes the streak reflect study rather than visits.
   *
   * The record is keyed by (activity kind, subject), so a retried request, a
   * double submit or a replayed event cannot add a second row — and because
   * `activityKey(kind, subject)` is also the idempotency key used by the reward
   * ledger, a duplicate can never pay out twice either.
   */
  private async recordActivity(
    userId: string,
    kind: ActivityKind,
    subjectId: string,
  ): Promise<void> {
    const id = `${userId}:${makeActivityKey(kind, subjectId)}`
    const existing = await readOne<StudyActivityRow>(STORE.studyActivity, id)
    if (existing) return
    await write<StudyActivityRow>(STORE.studyActivity, {
      id,
      userId,
      kind,
      date: todayKeyLocal(),
      activityKey: makeActivityKey(kind, subjectId),
      createdAt: new Date().toISOString(),
    })
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("llamastu:data-changed", { detail: { scope: "activity" } }))
    }
  }

  /** Every calendar date on which this account recorded a qualifying activity. */
  private async studyDatesFor(userId: string): Promise<string[]> {
    const [records, legacy] = await Promise.all([
      readAll<StudyActivityRow>(STORE.studyActivity),
      readAll<DailyActivityRow>(STORE.dailyActivity),
    ])
    // `dailyActivity` is the pre-v3 marker store. It is still read so an install
    // that already had a streak keeps it; new activity only writes studyActivity.
    return [
      ...records.filter((row) => row.userId === userId).map((row) => row.date),
      ...legacy.filter((row) => row.userId === userId).map((row) => row.date),
    ]
  }

  private async streakFor(userId: string) {
    return computeStudyStreak(await this.studyDatesFor(userId), todayKeyLocal())
  }

  /** All SP transactions, newest first. The total is always their sum. */
  private async xpLedger(userId: string): Promise<XpEventRow[]> {
    return (await readAll<XpEventRow>(STORE.xpEvents))
      .filter((row) => row.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  private async notify(
    userId: string,
    input: { title: string; message: string; kind: AppNotification["kind"]; eventId?: string },
  ): Promise<void> {
    const preferences = await this.preferencesFor(userId)
    if (!preferences.enabled) return
    if (input.kind === "schedule" && !preferences.agendaReminders) return
    if (input.kind === "game" && !preferences.gameReminders) return
    await write<NotificationRow>(STORE.notifications, {
      id: randomId(),
      userId,
      title: input.title,
      message: input.message,
      kind: input.kind,
      read: false,
      createdAt: new Date().toISOString(),
    })
  }

  private async preferencesFor(userId: string): Promise<NotificationPreferences> {
    const row = await readOne<PrefsRow>(STORE.notificationPrefs, userId)
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(row?.preferences ?? {}) }
  }

  private async characterFor(userId: string): Promise<Character> {
    const profile = await readOne<ProfileRow>(STORE.profiles, userId)
    return { ...DEFAULT_CHARACTER, ...(profile?.character ?? {}) }
  }

  private async profileEmail(userId: string): Promise<string> {
    return (await this.getProfile(userId)).email.toLowerCase()
  }

  private async collaboratorsFor(noteId: string): Promise<CollaboratorRow[]> {
    return (await readAll<CollaboratorRow>(STORE.collaborators)).filter(
      (person) => person.noteId === noteId,
    )
  }

  /** Attaches the invite list and normalises legacy rows. */
  private async hydrateNote(note: NoteRow): Promise<Note> {
    const people = await this.collaboratorsFor(note.id)
    return normalizeNote({
      ...note,
      collaborators: people.map((person) => ({
        id: person.id,
        userId: person.userId,
        email: person.email,
        permission: person.permission,
      })),
    })
  }

  /**
   * What the caller may do with one note. This is the ONLY place access is
   * decided, and every write route re-derives it — a client cannot grant itself
   * edit rights by sending a flag.
   */
  private accessFor(note: Note, userId: string, email: string): NoteAccess {
    if (note.ownerId === userId) return "owner"
    const invited = note.collaborators.find(
      (person) => String(person.email ?? "").toLowerCase() === email,
    )
    if (invited) return invited.permission === "editor" ? "editor" : "viewer"
    if (note.shareMode === "edit") return "link-edit"
    if (note.shareMode === "view") return "link-view"
    return "viewer"
  }

  private withAccess(note: Note, userId: string, email: string): SharedNoteView {
    const access = this.accessFor(note, userId, email)
    return {
      note,
      access,
      canEdit: access === "owner" || access === "editor" || access === "link-edit",
    }
  }

  /** Notes the caller can reach: owned, invited, or reached through a live link. */
  private async notesVisibleTo(userId: string): Promise<Note[]> {
    const email = await this.profileEmail(userId)
    const [notes, collaborators] = await Promise.all([
      readAll<NoteRow>(STORE.notes),
      readAll<CollaboratorRow>(STORE.collaborators),
    ])
    const reachable = notes.filter(
      (note) =>
        note.ownerId === userId ||
        collaborators.some(
          (person) =>
            person.noteId === note.id && String(person.email ?? "").toLowerCase() === email,
        ),
    )
    const hydrated = await Promise.all(reachable.map((note) => this.hydrateNote(note)))
    return hydrated.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * Persists every achievement in the catalogue as unlocked.
   *
   * This writes an achievement ROW, never an SP transaction: the gallery being
   * fully open must not pay out a single point, and must not invent historical
   * study activity. A genuinely earned achievement keeps its real timestamp
   * (taken from its reward event) so the history stays truthful.
   */
  private async syncAchievements(userId: string): Promise<AchievementRow[]> {
    const existing = (await readAll<AchievementRow>(STORE.achievements)).filter(
      (row) => row.userId === userId,
    )
    const byCode = new Map(existing.map((row) => [row.code, row]))
    const earned = (await this.xpLedger(userId)).filter((event) =>
      event.eventKey.startsWith("achievement:"),
    )
    const account = await readOne<AccountRow>(STORE.accounts, userId)
    const wanted = achievementStates(
      earned.map((event) => ({
        code: event.eventKey.slice("achievement:".length),
        unlockedAt: event.createdAt,
      })),
      account?.createdAt ?? new Date().toISOString(),
    )

    const rows: AchievementRow[] = []
    for (const item of wanted) {
      const current = byCode.get(item.code)
      if (current) {
        rows.push(current)
        continue
      }
      const row: AchievementRow = {
        id: `${userId}:${item.code}`,
        userId,
        code: item.code,
        unlockedAt: item.unlockedAt,
      }
      await write(STORE.achievements, row)
      rows.push(row)
    }
    return rows
  }

  private async recomputeProgress(userId: string) {
    const statsPass = async () => {
      const [materials, attempts, notes, events, calendar, games, streakInfo] = await Promise.all([
        readAll<MaterialRow>(STORE.materials),
        readAll<AttemptRow>(STORE.attempts),
        this.notesVisibleTo(userId),
        readAll<XpEventRow>(STORE.xpEvents),
        readAll<CalendarRow>(STORE.calendarEvents),
        readAll<GameRow>(STORE.games),
        this.streakFor(userId),
      ])

      const mine = <T extends { userId: string }>(rows: T[]) => rows.filter((row) => row.userId === userId)
      const myMaterials = mine(materials)
      const myAttempts = mine(attempts)
      const allGames = mine(games)
      const myEvents = mine(events)

      const xp = myEvents.reduce((total, event) => total + event.xp, 0)
      const openedGates = allGames.reduce((total, game) => total + game.openedGates.length, 0)
      const finishedWorlds = allGames.filter((game) => game.finished).length
      const allOrbsCollected = allGames.some(
        (game) => game.orbTotal > 0 && game.collected.length >= game.orbTotal,
      )

      const progress = {
        xp,
        level: levelForXp(xp),
        streak: streakInfo.streak,
        longestStreak: streakInfo.longest,
        quizAttempts: myAttempts.length,
        completedChallenges: openedGates,
        character: await this.characterFor(userId),
      }

      return {
        progress,
        unlocked: evaluateAchievements({
          processedMaterials: myMaterials.filter((item) => item.status === "ready").length,
          quizAttempts: myAttempts.length,
          perfectQuizzes: myAttempts.filter((a) => a.total > 0 && a.score === a.total).length,
          openedGates,
          finishedWorlds,
          allOrbsCollected,
          notes: notes.filter((note) => note.ownerId === userId).length,
          schedules: mine(calendar).length,
          streak: streakInfo.streak,
          level: progress.level,
        }),
      }
    }

    let result = await statsPass()
    // Reward only what was genuinely earned. The gallery is opened for every
    // account, but that is a presentation decision and is not allowed to mint SP.
    const rewards = result.unlocked
      .map((code) => ({
        key: eventKeyAchievement(code),
        xp: ACHIEVEMENTS.find((item) => item.code === code)?.xpReward ?? 0,
      }))
      .filter((event) => event.xp > 0)
    if (rewards.length) {
      await this.awardXp(userId, rewards)
      result = await statsPass()
    }
    await this.syncAchievements(userId)
    return result.progress
  }

  private async getProfile(userId: string): Promise<Profile> {
    const stored = await readOne<ProfileRow>(STORE.profiles, userId)
    if (stored) {
      const {
        id: _ignored,
        character: _character,
        appPreferences: _appPreferences,
        ...profile
      } = stored
      return profile
    }
    const account = await readOne<AccountRow>(STORE.accounts, userId)
    return {
      name: account?.name ?? "Learner",
      username: account?.email.split("@")[0] ?? "",
      email: account?.email ?? "",
      program: "",
      semester: "",
      bio: "",
    }
  }

  private async getAppPreferences(userId: string): Promise<AppPreferences> {
    const profile = await readOne<ProfileRow>(STORE.profiles, userId)
    const darkMode = profile?.appPreferences?.darkMode
    return { darkMode: typeof darkMode === "boolean" ? darkMode : null }
  }

  /** Legacy shape for the timetable screen, derived from calendar events. */
  private toSchedule(row: CalendarRow): Schedule {
    return {
      id: row.id,
      course: row.title,
      lecturer: null,
      startAt: row.startAt,
      endAt: row.endAt,
      room: row.location,
      notes: row.description || null,
      repeatRule: row.repeatRule === "weekly" ? "weekly" : "none",
      reminderMinutes: row.reminderMinutes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  private async buildBootstrap(userId: string, email: string): Promise<AppData> {
    const [
      profile,
      materials,
      notes,
      calendar,
      notifications,
      games,
      questions,
      preferences,
      appPreferences,
    ] = await Promise.all([
      this.getProfile(userId),
      readAll<MaterialRow>(STORE.materials),
      this.notesVisibleTo(userId),
      readAll<CalendarRow>(STORE.calendarEvents),
      readAll<NotificationRow>(STORE.notifications),
      readAll<GameRow>(STORE.games),
      readAll<QuestionRow>(STORE.questions),
      this.preferencesFor(userId),
      this.getAppPreferences(userId),
    ])

    const mine = <T extends { userId: string }>(rows: T[]) => rows.filter((row) => row.userId === userId)
    const progress = await this.recomputeProgress(userId)
    // Achievement status is its own record, independent of the reward ledger, so
    // unlocking the gallery can never be confused with minting SP.
    const achievementRows = (await readAll<AchievementRow>(STORE.achievements)).filter(
      (row) => row.userId === userId,
    )
    const achievements = achievementRows.length
      ? achievementRows.map((row) => ({ code: row.code, unlockedAt: row.unlockedAt }))
      : achievementStates([], new Date().toISOString())

    const myCalendar = mine(calendar)

    return {
      user: { id: userId, email },
      profile,
      preferences: appPreferences,
      progress,
      materials: mine(materials)
        .map((material) => ({
          ...material,
          questions: questions
            .filter((question) => question.materialId === material.id)
            .sort((left, right) => left.position - right.position)
            .map(({ materialId: _m, userId: _u, ...question }) => question),
        }))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      // Already hydrated (invite list attached), normalised and sorted by
      // `notesVisibleTo`.
      notes,
      calendarEvents: myCalendar
        .map(({ userId: _u, ...event }) => event)
        .sort((left, right) => left.startAt.localeCompare(right.startAt)),
      schedules: myCalendar
        .filter((row) => row.category === "class")
        .map((row) => this.toSchedule(row))
        .sort((left, right) => left.startAt.localeCompare(right.startAt)),
      notifications: mine(notifications).sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
      notificationPreferences: preferences,
      achievements,
      games: Object.fromEntries(mine(games).map((game) => [gameKey(game.materialId, game.mapId), game])),
    }
  }

  /* ---------------- upload + processing ---------------- */

  async uploadMaterial(
    file: File,
    meta: UploadMeta,
    onProgress: (value: number, stage: string) => void,
  ): Promise<Material> {
    const userId = this.requireUserId()
    if (!isAcceptedFile(file)) {
      throw new Error(`Unsupported file. Accepted formats: ${describeAcceptedTypes()}.`)
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("Files must be smaller than 25 MB.")

    const materialId = randomId()
    const now = new Date().toISOString()

    onProgress(8, "Storing your file…")
    await write<FileRow>(STORE.files, { id: materialId, blob: file, name: file.name, type: file.type })

    let extracted = ""
    let extractionError: string | null = null

    if (isTextExtractable(file)) {
      onProgress(26, "Reading the document…")
      try {
        const result = await extractText(file)
        extracted = result.text
        if (extracted.trim().length < 60) extractionError = unsupportedReason(file)
      } catch (reason) {
        extractionError =
          reason instanceof Error ? reason.message : "Text extraction failed for this file."
      }
    } else {
      extractionError = unsupportedReason(file)
    }

    const status: MaterialStatus = extractionError ? "needs_text" : "processing"

    const material: MaterialRow = {
      id: materialId,
      userId,
      title: meta.title?.trim() || file.name.replace(/\.[^.]+$/, ""),
      name: file.name,
      subject: meta.subject?.trim() || null,
      type: file.type || "application/octet-stream",
      size: file.size,
      storagePath: `local://${materialId}`,
      status,
      errorMessage: extractionError,
      summary: null,
      keyPoints: [],
      objectives: [],
      flashcards: [],
      extractedText: extracted || null,
      questions: [],
      wordCount: 0,
      xpAwarded: false,
      processedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    await write(STORE.materials, material)

    if (extractionError) {
      await this.notify(userId, {
        title: "Text needed",
        message: `${file.name}: ${extractionError}`,
        kind: "material",
      })
      onProgress(100, extractionError)
      return material
    }

    onProgress(58, "Generating summary, flashcards and challenges…")
    const processed = await this.processMaterial(userId, materialId, {
      questionCount: meta.questionCount,
      difficulty: meta.difficulty,
      text: extracted,
    })
    onProgress(100, "Your study world is ready")
    return processed
  }

  private async processMaterial(
    userId: string,
    materialId: string,
    options: { questionCount?: number; difficulty?: "easy" | "medium" | "hard"; text?: string },
  ): Promise<Material> {
    const material = await readOne<MaterialRow>(STORE.materials, materialId)
    if (!material || material.userId !== userId) throw new Error("Material not found in your library.")

    const source = normalizeText(options.text || material.extractedText || "")
    if (!source.trim()) throw new Error("There is no text to process yet. Add the material text first.")

    material.status = "processing"
    material.errorMessage = null
    material.extractedText = source
    material.updatedAt = new Date().toISOString()
    await write(STORE.materials, material)

    try {
      const generated = generateLearningContent(source, {
        questionCount: options.questionCount,
        difficulty: options.difficulty,
      })

      const previous = (await readAll<QuestionRow>(STORE.questions)).filter(
        (question) => question.materialId === materialId,
      )
      await Promise.all(previous.map((question) => drop(STORE.questions, question.id)))

      const questions: QuestionRow[] = generated.questions.map((question, index) => ({
        id: randomId(),
        materialId,
        userId,
        position: index,
        question: question.question,
        choices: question.choices,
        answerIndex: question.answerIndex,
        explanation: question.explanation,
        difficulty: question.difficulty,
      }))
      for (const question of questions) await write(STORE.questions, question)

      const ready: MaterialRow = {
        ...material,
        status: "ready",
        errorMessage: null,
        summary: generated.summary,
        keyPoints: generated.keyPoints,
        objectives: generated.objectives,
        flashcards: generated.flashcards.map((card) => ({ ...card, id: randomId() })),
        extractedText: source,
        wordCount: generated.wordCount,
        processedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        questions: questions.map(({ materialId: _m, userId: _u, ...question }) => question),
      }
      await write(STORE.materials, ready)

      // A processed material is a validated study activity, so it is what marks
      // the day — not the fact that the learner was on the site.
      await this.recordActivity(userId, "material_processed", materialId)
      await this.awardXp(userId, [{ key: eventKeyMaterial(materialId), xp: XP.materialProcessed }])
      await this.notify(userId, {
        title: "Material ready",
        message: `${ready.title} produced ${questions.length} challenges, a summary and flashcards.`,
        kind: "material",
      })
      await this.recomputeProgress(userId)
      return ready
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Processing failed for an unknown reason."
      await write(STORE.materials, {
        ...material,
        status: "failed",
        errorMessage: message,
        updatedAt: new Date().toISOString(),
      })
      await this.notify(userId, {
        title: "Processing failed",
        message: `${material.name}: ${message}`,
        kind: "material",
      })
      throw new Error(message)
    }
  }

  async resolveFileUrl(material: Material): Promise<string> {
    const row = await readOne<FileRow>(STORE.files, material.id)
    if (!row?.blob) throw new Error("The stored file for this material is no longer available.")
    return URL.createObjectURL(row.blob)
  }

  /* ---------------- request routing ---------------- */

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const method = (options.method || "GET").toUpperCase()
    const payload = (options.body ? JSON.parse(String(options.body)) : {}) as Record<string, unknown>
    const [rawPath, query] = path.split("?")
    const segments = rawPath.split("/").filter(Boolean)
    const now = new Date().toISOString()

    /* ---------------- public routes (no session) ---------------- */

    if (rawPath === "/health") {
      return {
        status: "ok",
        service: "llamastu-local",
        version: 3,
        ai: this.assistantConfigured(),
        push: Boolean(this.vapidPublicKey()),
      } as T
    }

    // Only the PUBLIC half of the VAPID pair is ever exposed. The private key is
    // a server-only secret and is not readable from this module at all.
    if (rawPath === "/push/public-key" && method === "GET") {
      const key = this.vapidPublicKey()
      return {
        configured: Boolean(key),
        publicKey: key,
        missing: key ? undefined : "VITE_VAPID_PUBLIC_KEY",
      } as T
    }

    /**
     * Resolving a share link.
     *
     * The token is the capability: it is checked against the stored token AND
     * against the note still being shared. Revoking sharing clears the token, so
     * an old link stops resolving on the very next request rather than merely
     * being hidden in the UI.
     */
    if (segments[0] === "shared" && segments.length === 2 && method === "GET") {
      const token = segments[1]
      const all = await readAll<NoteRow>(STORE.notes)
      const match = all.find((note) => normalizeNote(note).shareToken === token)
      if (!match) {
        throw Object.assign(new Error("This share link is no longer valid."), {
          code: "SHARE_REVOKED",
          status: 404,
        })
      }
      const note = await this.hydrateNote(match)
      if (note.shareMode === "private" || !note.shareToken) {
        throw Object.assign(new Error("This share link is no longer valid."), {
          code: "SHARE_REVOKED",
          status: 404,
        })
      }
      const access: NoteAccess = note.shareMode === "edit" ? "link-edit" : "link-view"
      const owner = await readOne<AccountRow>(STORE.accounts, note.ownerId)
      // Deliberately minimal: a link holder sees the note, never the owner's
      // profile, email list or other notes.
      return {
        note: { ...note, collaborators: [] },
        access,
        canEdit: access === "link-edit",
        ownerName: owner?.name ?? "A Llamastu learner",
      } as T
    }

    const userId = this.requireUserId()

    const readMine = async <Row extends { userId: string }>(name: StoreName): Promise<Row[]> => {
      const rows = await readAll<Row>(name)
      return rows.filter((row) => row.userId === userId)
    }

    if (rawPath === "/bootstrap" && method === "GET") {
      const account = await readOne<AccountRow>(STORE.accounts, userId)
      return (await this.buildBootstrap(userId, account?.email ?? "")) as T
    }

    if (rawPath === "/profile" && method === "PATCH") {
      const stored = await readOne<ProfileRow>(STORE.profiles, userId)
      const current = await this.getProfile(userId)
      const next: ProfileRow = {
        ...(stored ?? { ...current, id: userId }),
        ...(payload as Partial<Profile>),
        id: userId,
        email: current.email,
      }
      await write(STORE.profiles, next)
      const { id: _ignored, character: _character, ...profile } = next
      return profile as T
    }

    if (rawPath === "/preferences" && method === "PATCH") {
      const body = payload as { darkMode?: unknown }
      if (typeof body.darkMode !== "boolean") {
        throw new Error("A valid appearance preference is required.")
      }
      const stored = await readOne<ProfileRow>(STORE.profiles, userId)
      const base = stored ?? { ...(await this.getProfile(userId)), id: userId }
      const appPreferences = { ...(base.appPreferences ?? {}), darkMode: body.darkMode }
      await write(STORE.profiles, { ...base, id: userId, appPreferences })
      return { darkMode: body.darkMode } as T
    }

    if (rawPath === "/character" && method === "PATCH") {
      const stored = await readOne<ProfileRow>(STORE.profiles, userId)
      const base = stored ?? { ...(await this.getProfile(userId)), id: userId }
      const character: Character = {
        ...DEFAULT_CHARACTER,
        ...(base.character ?? {}),
        ...(payload as Partial<Character>),
      }
      await write(STORE.profiles, { ...base, id: userId, character })
      const progress = await this.recomputeProgress(userId)
      return { character, progress } as T
    }

    if (rawPath === "/progress" && method === "GET") {
      return (await this.recomputeProgress(userId)) as T
    }

    if (rawPath === "/achievements" && method === "GET") {
      const rows = await this.syncAchievements(userId)
      return {
        catalog: ACHIEVEMENTS,
        // The full catalogue is unlocked. Status comes from the achievement store,
        // never from the reward ledger, so opening the gallery mints no SP.
        unlocked: rows.map((row) => ({ code: row.code, unlockedAt: row.unlockedAt })),
        allUnlocked: true,
      } as T
    }

    /* ---- the authoritative activity and SP ledgers ---- */

    if (rawPath === "/study-activity" && method === "GET") {
      return (await readMine<StudyActivityRow>(STORE.studyActivity)).sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ) as unknown as T
    }

    if (rawPath === "/xp-events" && method === "GET") {
      return (await this.xpLedger(userId)) as unknown as T
    }

    if (rawPath === "/study-stats" && method === "GET") {
      const streak = await this.streakFor(userId)
      const ledger = await this.xpLedger(userId)
      const xp = ledger.reduce((total, event) => total + event.xp, 0)
      return { ...streak, xp, level: levelForXp(xp) } as T
    }

    /* ---- notification preferences ---- */

    if (rawPath === "/notification-preferences" && method === "GET") {
      return (await this.preferencesFor(userId)) as T
    }

    if (rawPath === "/notification-preferences" && method === "PATCH") {
      const current = await this.preferencesFor(userId)
      const next: NotificationPreferences = {
        ...current,
        ...(payload as Partial<NotificationPreferences>),
      }
      await write<PrefsRow>(STORE.notificationPrefs, { id: userId, userId, preferences: next })
      return next as T
    }

    /* ---- materials ---- */

    if (rawPath === "/materials" && method === "GET") {
      return (await readMine<MaterialRow>(STORE.materials)) as unknown as T
    }

    if (rawPath === "/materials" && method === "POST") {
      const body = payload as unknown as {
        id?: string
        name: string
        title?: string
        subject?: string
        type?: string
        size?: number
        status?: MaterialStatus
        extractedText?: string
        errorMessage?: string | null
      }
      if (!body?.name) throw new Error("A material name is required.")
      const created: MaterialRow = {
        id: body.id || randomId(),
        userId,
        name: body.name,
        title: body.title?.trim() || body.name.replace(/\.[^.]+$/, ""),
        subject: body.subject?.trim() || null,
        type: body.type || "application/octet-stream",
        size: Number(body.size ?? 0),
        storagePath: null,
        status: body.status ?? "processing",
        errorMessage: body.errorMessage ?? null,
        summary: null,
        keyPoints: [],
        objectives: [],
        flashcards: [],
        extractedText: body.extractedText ? normalizeText(body.extractedText) : null,
        questions: [],
        wordCount: 0,
        xpAwarded: false,
        processedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      await write(STORE.materials, created)
      return created as unknown as T
    }

    if (segments[0] === "materials" && segments.length === 3) {
      const materialId = segments[1]
      const action = segments[2]
      const material = await readOne<MaterialRow>(STORE.materials, materialId)
      if (!material || material.userId !== userId) throw new Error("Material not found.")

      if (action === "process" && method === "POST") {
        const body = payload as unknown as {
          questionCount?: number
          difficulty?: "easy" | "medium" | "hard"
          text?: string
        }
        return { material: await this.processMaterial(userId, materialId, body) } as T
      }

      if (action === "questions" && method === "GET") {
        return (await readAll<QuestionRow>(STORE.questions))
          .filter((question) => question.materialId === materialId)
          .sort((left, right) => left.position - right.position)
          .map(({ materialId: _m, userId: _u, ...question }) => question) as unknown as T
      }

      if (action === "file" && method === "GET") {
        return { url: await this.resolveFileUrl(material), expiresIn: 0 } as T
      }
    }

    if (segments[0] === "materials" && segments.length === 2 && method === "GET") {
      const material = await readOne<MaterialRow>(STORE.materials, segments[1])
      if (!material || material.userId !== userId) throw new Error("Material not found.")
      return material as unknown as T
    }

    if (segments[0] === "materials" && segments.length === 2 && method === "PATCH") {
      const material = await readOne<MaterialRow>(STORE.materials, segments[1])
      if (!material || material.userId !== userId) throw new Error("Material not found.")
      const patch = payload as Partial<Material>
      const next: MaterialRow = { ...material, ...patch, id: material.id, userId, updatedAt: now }
      if (typeof patch.extractedText === "string") next.extractedText = normalizeText(patch.extractedText)
      await write(STORE.materials, next)
      return (await this.withQuestions(next)) as unknown as T
    }

    if (segments[0] === "materials" && segments.length === 2 && method === "DELETE") {
      const material = await readOne<MaterialRow>(STORE.materials, segments[1])
      if (!material || material.userId !== userId) throw new Error("Material not found.")
      const questions = (await readAll<QuestionRow>(STORE.questions)).filter(
        (question) => question.materialId === material.id,
      )
      await Promise.all(questions.map((question) => drop(STORE.questions, question.id)))

      // Quiz attempts belong to the material. XP events are deliberately kept:
      // earned XP is user progress and must not be destroyed by a delete.
      const attempts = (await readAll<AttemptRow>(STORE.attempts)).filter(
        (attempt) => attempt.materialId === material.id && attempt.userId === userId,
      )
      await Promise.all(attempts.map((attempt) => drop(STORE.attempts, attempt.id)))

      const games = (await readAll<GameRow>(STORE.games)).filter(
        (game) => game.materialId === material.id && game.userId === userId,
      )
      await Promise.all(games.map((game) => drop(STORE.games, game.id)))

      await drop(STORE.files, material.id)
      await drop(STORE.materials, material.id)

      const notes = await this.notesVisibleTo(userId)
      await Promise.all(
        notes
          .filter((note) => note.materialId === material.id && note.ownerId === userId)
          .map((note) => write(STORE.notes, { ...note, materialId: null, updatedAt: now })),
      )

      const calendar = (await readAll<CalendarRow>(STORE.calendarEvents)).filter(
        (event) => event.materialId === material.id && event.userId === userId,
      )
      await Promise.all(
        calendar.map((event) => write(STORE.calendarEvents, { ...event, materialId: null, updatedAt: now })),
      )

      await this.recomputeProgress(userId)
      return { ok: true } as T
    }

    /* ---- quiz ---- */

    if (rawPath === "/quiz-attempts" && method === "POST") {
      const body = payload as unknown as { materialId: string; answers: Record<string, number> }
      const material = await readOne<MaterialRow>(STORE.materials, body?.materialId)
      if (!material || material.userId !== userId) throw new Error("Material not found.")

      const questions = (await readAll<QuestionRow>(STORE.questions))
        .filter((question) => question.materialId === body.materialId)
        .sort((left, right) => left.position - right.position)
      if (!questions.length) throw new Error("This material has no generated questions yet.")

      let score = 0
      const correct: string[] = []
      const correctMap: Record<string, boolean> = {}
      const explanations: Record<string, string> = {}
      questions.forEach((question) => {
        explanations[question.id] = question.explanation
        const isCorrect = Number(body.answers?.[question.id]) === question.answerIndex
        correctMap[question.id] = isCorrect
        if (isCorrect) {
          score += 1
          correct.push(question.id)
        }
      })

      const xpAwarded = await this.awardXp(
        userId,
        correct.map((id) => ({
          key: eventKeyQuizAnswer(body.materialId, id),
          xp: XP.quizQuestionCorrect,
        })),
      )

      const attempt: AttemptRow = {
        id: randomId(),
        userId,
        materialId: body.materialId,
        score,
        total: questions.length,
        xpAwarded,
        answers: body.answers ?? {},
        createdAt: now,
      }
      await write(STORE.attempts, attempt)
      // Keyed by the attempt id, so re-submitting or reloading the result screen
      // cannot turn one quiz into several study days.
      await this.recordActivity(userId, "quiz_completed", attempt.id)
      await this.notify(userId, {
        title: score === questions.length ? "Perfect quiz" : "Quiz complete",
        message: `${material.title}: ${score}/${questions.length} correct${
          xpAwarded ? ` · +${xpAwarded} XP` : " · no new XP this round"
        }.`,
        kind: "quiz",
      })
      const progress = await this.recomputeProgress(userId)
      return { attempt, progress, correctMap, explanations } as T
    }

    if (rawPath.startsWith("/quiz-attempts") && method === "GET") {
      const params = new URLSearchParams(query ?? "")
      const materialId = params.get("materialId")
      return (await readMine<AttemptRow>(STORE.attempts))
        .filter((attempt) => !materialId || attempt.materialId === materialId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)) as unknown as T
    }

    /* ---- game progress (keyed by material + map) ---- */

    if (segments[0] === "game-progress" && segments.length === 1 && method === "GET") {
      return (await readMine<GameRow>(STORE.games)) as unknown as T
    }

    if (segments[0] === "game-progress" && segments.length === 3 && method === "GET") {
      const found = (await readMine<GameRow>(STORE.games)).find(
        (game) => game.materialId === segments[1] && game.mapId === segments[2],
      )
      return (found ?? emptyGameProgress(segments[1], segments[2])) as unknown as T
    }

    if (rawPath === "/game-progress" && method === "POST") {
      const body = payload as unknown as {
        materialId: string
        mapId: string
        characterId?: string
        orbTotal?: number
        elapsedSeconds?: number
        events?: {
          gates?: string[]
          revealedGates?: string[]
          collectibles?: string[]
          checkpoints?: string[]
          position?: number
          finished?: boolean
        }
      }
      if (!body?.materialId || !body?.mapId) throw new Error("A material and a map are required.")

      const material = await readOne<MaterialRow>(STORE.materials, body.materialId)
      if (!material || material.userId !== userId) throw new Error("Material not found.")

      const stored = await readMine<GameRow>(STORE.games)
      const current: GameRow =
        stored.find((game) => game.materialId === body.materialId && game.mapId === body.mapId) ?? {
          ...emptyGameProgress(body.materialId, body.mapId),
          id: gameRowId(userId, body.materialId, body.mapId),
          userId,
        }

      const events = body.events ?? {}
      const openedGates = Array.from(
        new Set([...current.openedGates, ...(events.gates ?? []), ...(events.revealedGates ?? [])]),
      )
      const collected = Array.from(new Set([...current.collected, ...(events.collectibles ?? [])]))
      const checkpoints = Array.from(new Set([...current.checkpoints, ...(events.checkpoints ?? [])]))
      const finished = current.finished || events.finished === true

      const awards: { key: string; xp: number }[] = []
      for (const id of events.gates ?? []) {
        if (!current.openedGates.includes(id)) {
          awards.push({ key: eventKeyGate(body.materialId, body.mapId, id), xp: XP.gateOpened })
        }
      }
      for (const id of events.collectibles ?? []) {
        if (!current.collected.includes(id)) {
          awards.push({
            key: eventKeyCollectible(body.materialId, body.mapId, id),
            xp: XP.collectible,
          })
        }
      }
      if (finished && !current.finished) {
        awards.push({ key: eventKeyWorld(body.materialId, body.mapId), xp: XP.worldFinished })
      }

      const xpAwarded = await this.awardXp(userId, awards)

      // Clearing a gate and finishing a world are qualifying study activities.
      // Both keys include the map, so the same gate in another world is its own
      // activity, and repeating one is not.
      for (const id of events.gates ?? []) {
        if (!current.openedGates.includes(id)) {
          await this.recordActivity(userId, "gate_opened", `${body.materialId}:${body.mapId}:${id}`)
        }
      }
      if (finished && !current.finished) {
        await this.recordActivity(userId, "world_finished", `${body.materialId}:${body.mapId}`)
      }

      const bestTime =
        finished && typeof body.elapsedSeconds === "number"
          ? current.bestTimeSeconds === null
            ? body.elapsedSeconds
            : Math.min(current.bestTimeSeconds, body.elapsedSeconds)
          : current.bestTimeSeconds

      const next: GameRow = {
        ...current,
        userId,
        id: gameRowId(userId, body.materialId, body.mapId),
        characterId: body.characterId ?? current.characterId,
        orbTotal: typeof body.orbTotal === "number" ? body.orbTotal : current.orbTotal,
        openedGates,
        collected,
        checkpoints,
        position: typeof events.position === "number" ? events.position : current.position,
        finished,
        xpAwarded: current.xpAwarded + xpAwarded,
        bestTimeSeconds: bestTime,
        updatedAt: now,
      }
      await write(STORE.games, next)

      if (openedGates.length > current.openedGates.length) {
        await this.notify(userId, {
          title: "Challenge gate opened",
          message: `${material.title}: ${openedGates.length} gates cleared in this world.`,
          kind: "game",
        })
      }
      if (finished && !current.finished) {
        await this.notify(userId, {
          title: "Map completed",
          message: `You reached the goal in ${material.title} · +${XP.worldFinished} XP.`,
          kind: "game",
        })
      }

      const progress = await this.recomputeProgress(userId)
      return { game: next, progress, xpAwarded } as T
    }

    /* ---- notes ---- */

    if (rawPath === "/notes" && method === "POST") {
      const body = payload as unknown as { title?: string; content?: string; materialId?: string | null }
      const profile = await this.getProfile(userId)
      const note: NoteRow = {
        id: randomId(),
        ownerId: userId,
        ownerEmail: profile.email,
        title: body?.title?.trim() || "Untitled note",
        content: body?.content ?? "",
        materialId: body?.materialId ?? null,
        collaborators: [],
        // A new note is private. Sharing is an explicit, revocable act.
        shareToken: null,
        shareMode: "private",
        version: 1,
        createdAt: now,
        updatedAt: now,
      }
      await write(STORE.notes, note)
      await this.awardXp(userId, [{ key: eventKeyNote(note.id), xp: XP.noteCreated }])
      await this.recomputeProgress(userId)
      return note as unknown as T
    }

    if (rawPath === "/notes" && method === "GET") {
      const [notes, email] = await Promise.all([
        this.notesVisibleTo(userId),
        this.profileEmail(userId),
      ])
      return notes.map((note) => this.withAccess(note, userId, email)) as unknown as T
    }

    /**
     * Change feed for real-time collaboration.
     *
     * Returns every note the caller may read that was touched after `since`,
     * together with the authoritative version. Clients poll this while a note is
     * open, and apply a newer version instead of trusting their local copy.
     */
    if (rawPath === "/notes/feed" && method === "GET") {
      const params = new URLSearchParams(query ?? "")
      const since = params.get("since") ?? new Date(0).toISOString()
      const email = await this.profileEmail(userId)
      const visible = (await this.notesVisibleTo(userId)).map((note) =>
        this.withAccess(note, userId, email),
      )
      return {
        serverTime: new Date().toISOString(),
        notes: visible
          .filter((entry) => entry.note.updatedAt > since)
          .map((entry) => ({
            id: entry.note.id,
            title: entry.note.title,
            content: entry.note.content,
            materialId: entry.note.materialId,
            version: entry.note.version,
            updatedAt: entry.note.updatedAt,
            ownerEmail: entry.note.ownerEmail,
            shareMode: entry.note.shareMode,
            access: entry.access,
            canEdit: entry.canEdit,
            collaborators: entry.note.collaborators,
          })),
      } as unknown as T
    }

    /**
     * Sharing with a named account. Owner only, and validated server-side: the
     * caller cannot invite on someone else's note, and an invited reader cannot
     * promote themselves to editor.
     */
    if (segments[0] === "notes" && segments.length === 3 && segments[2] === "share" && method === "POST") {
      const note = await readOne<NoteRow>(STORE.notes, segments[1])
      if (!note || note.ownerId !== userId) throw new Error("Note not found.")
      const body = payload as unknown as { email?: string; permission?: "viewer" | "editor" }
      const email = String(body?.email ?? "").trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("Enter a valid email address to share with.")
      }
      const ownerEmail = await this.profileEmail(userId)
      if (email === ownerEmail) throw new Error("That note already belongs to you.")

      const people = await this.collaboratorsFor(note.id)
      const duplicate = people.find((person) => String(person.email).toLowerCase() === email)
      const permission = body.permission === "viewer" ? "viewer" : "editor"
      if (duplicate) await drop(STORE.collaborators, duplicate.id)
      await write<CollaboratorRow>(STORE.collaborators, {
        id: randomId(),
        noteId: note.id,
        userId: randomId(),
        email,
        permission,
      })
      await write(STORE.notes, { ...note, updatedAt: now })
      await this.notify(userId, {
        title: "Note shared",
        message: `${note.title} was shared with ${email} as ${permission}.`,
        kind: "system",
      })
      return (await this.withAccess(await this.hydrateNote(note), userId, ownerEmail)) as unknown as T
    }

    if (segments[0] === "notes" && segments.length === 4 && segments[2] === "collaborators" && method === "DELETE") {
      const note = await readOne<NoteRow>(STORE.notes, segments[1])
      if (!note || note.ownerId !== userId) throw new Error("Note not found.")
      const person = await readOne<CollaboratorRow>(STORE.collaborators, segments[3])
      if (!person || person.noteId !== note.id) throw new Error("That person is not on this note.")
      await drop(STORE.collaborators, person.id)
      return { ok: true } as T
    }

    /**
     * Link sharing. `PATCH { mode }` turns the link on or off and — critically —
     * switching back to `private` clears the token, so revoking access is
     * immediate and the old URL can never resolve again. Each new token is drawn
     * from the CSPRNG rather than derived from the note id.
     */
    if (segments[0] === "notes" && segments.length === 3 && segments[2] === "share" && method === "PATCH") {
      const note = await readOne<NoteRow>(STORE.notes, segments[1])
      if (!note || note.ownerId !== userId) throw new Error("Note not found.")
      const body = payload as unknown as { mode?: NoteShareMode }
      const mode: NoteShareMode =
        body?.mode === "view" || body?.mode === "edit" ? body.mode : "private"
      const current = normalizeNote({ ...note })
      const shareToken = mode === "private" ? null : (current.shareToken ?? createShareToken())
      await write(STORE.notes, { ...current, shareToken, shareMode: mode, updatedAt: now })
      return {
        shareToken,
        shareMode: mode,
        revoked: mode === "private",
      } as unknown as T
    }

    if (segments[0] === "notes" && segments.length === 3 && segments[2] === "share" && method === "DELETE") {
      const note = await readOne<NoteRow>(STORE.notes, segments[1])
      if (!note || note.ownerId !== userId) throw new Error("Note not found.")
      const current = normalizeNote({ ...note })
      const people = await this.collaboratorsFor(note.id)
      await Promise.all(people.map((person) => drop(STORE.collaborators, person.id)))
      await write(STORE.notes, {
        ...current,
        shareToken: null,
        shareMode: "private",
        updatedAt: now,
      })
      return { ok: true, revoked: true } as T
    }

    /**
     * Content writes. Access is re-derived from the stored row and the invite
     * list on every call, and a stale editor is rejected with a 409 rather than
     * being allowed to overwrite newer text.
     */
    if (segments[0] === "notes" && segments.length === 2 && method === "PATCH") {
      const note = await readOne<NoteRow>(STORE.notes, segments[1])
      if (!note) throw new Error("Note not found.")
      const current = await this.hydrateNote(note)
      const email = await this.profileEmail(userId)
      const access = this.accessFor(current, userId, email)
      const canEdit = access === "owner" || access === "editor" || access === "link-edit"
      if (!canEdit) {
        throw Object.assign(new Error("You have view-only access to this note."), {
          code: "FORBIDDEN",
          status: 403,
        })
      }

      const body = payload as Partial<Note> & { expectedVersion?: number }
      if (typeof body.expectedVersion === "number" && body.expectedVersion !== current.version) {
        throw Object.assign(
          new Error(
            "Someone else saved a newer version of this note. Reload it to pick up their changes.",
          ),
          { code: "VERSION_CONFLICT", status: 409, version: current.version },
        )
      }

      const next = normalizeNote({
        ...current,
        title: typeof body.title === "string" ? body.title : current.title,
        content: typeof body.content === "string" ? body.content : current.content,
        materialId:
          body.materialId !== undefined ? (body.materialId ?? null) : current.materialId,
        version: current.version + 1,
        updatedAt: now,
      })
      await write(STORE.notes, next)
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("llamastu:data-changed", { detail: { scope: "note", id: next.id } }),
        )
      }
      return next as unknown as T
    }

    if (segments[0] === "notes" && segments.length === 2 && method === "DELETE") {
      const note = await readOne<NoteRow>(STORE.notes, segments[1])
      if (!note || note.ownerId !== userId) throw new Error("Note not found.")
      const people = await this.collaboratorsFor(note.id)
      await Promise.all(people.map((person) => drop(STORE.collaborators, person.id)))
      await drop(STORE.notes, note.id)
      return { ok: true } as T
    }

    /* ---- calendar ---- */

    if (rawPath === "/calendar" && method === "GET") {
      const params = new URLSearchParams(query ?? "")
      const category = params.get("category")
      return (await readMine<CalendarRow>(STORE.calendarEvents))
        .filter((event) => !category || event.category === category)
        .sort((left, right) => left.startAt.localeCompare(right.startAt)) as unknown as T
    }

    if ((rawPath === "/calendar" || rawPath === "/schedules") && method === "POST") {
      const body = payload as unknown as Partial<CalendarEvent> & {
        course?: string
        room?: string
        notes?: string
      }
      const isSchedule = rawPath === "/schedules"
      const title = (isSchedule ? body.course : body.title)?.trim()
      if (!title) throw new Error("A title is required.")
      if (!body.startAt || !body.endAt) throw new Error("Start and end times are required.")
      if (new Date(body.endAt) <= new Date(body.startAt)) {
        throw new Error("The end time must be after the start time.")
      }
      const reminderMinutes = Number(body.reminderMinutes ?? 0)
      const category: CalendarCategory = isSchedule
        ? "class"
        : ((body.category as CalendarCategory) ?? "study")
      const created: CalendarRow = {
        id: randomId(),
        userId,
        title,
        description: (isSchedule ? (body.notes ?? "") : (body.description ?? "")) || "",
        category,
        startAt: body.startAt,
        endAt: body.endAt,
        location: (isSchedule ? body.room : body.location)?.trim() || null,
        reminderMinutes,
        repeatRule: (body.repeatRule as RepeatRule) ?? "none",
        materialId: body.materialId ?? null,
        reminderAt: computeReminderAt(body.startAt, reminderMinutes),
        reminderSentAt: null,
        createdAt: now,
        updatedAt: now,
      }
      await write(STORE.calendarEvents, created)
      if (isSchedule) {
        await this.awardXp(userId, [{ key: eventKeySchedule(created.id), xp: XP.scheduleCreated }])
        await this.notify(userId, {
          title: "Class added",
          message: `${created.title} is now in your calendar.`,
          kind: "schedule",
        })
        await this.recomputeProgress(userId)
        return this.toSchedule(created) as unknown as T
      }
      await this.notify(userId, {
        title: "Agenda added",
        message:
          reminderMinutes >= 0
            ? `${created.title} · reminder ${created.reminderMinutes} min before.`
            : `${created.title} was added to your calendar.`,
        kind: "schedule",
        eventId: created.id,
      })
      await this.recomputeProgress(userId)
      return (({ userId: _u, ...event }) => event)(created) as unknown as T
    }

    if (segments[0] === "calendar" && segments.length === 2 && method === "GET") {
      const row = await readOne<CalendarRow>(STORE.calendarEvents, segments[1])
      if (!row || row.userId !== userId) throw new Error("Event not found.")
      return (({ userId: _u, ...event }) => event)(row) as unknown as T
    }

    if (segments[0] === "calendar" && segments.length === 2 && (method === "PUT" || method === "PATCH")) {
      const row = await readOne<CalendarRow>(STORE.calendarEvents, segments[1])
      if (!row || row.userId !== userId) throw new Error("Event not found.")
      const patch = payload as Partial<CalendarEvent>
      const next: CalendarRow = { ...row, ...patch, id: row.id, userId, updatedAt: now }

      // The reminder is derived, never independently editable — so editing the
      // time, the date or the lead time always moves the alarm with it.
      const reminderMinutes =
        patch.reminderMinutes !== undefined ? Number(patch.reminderMinutes) : row.reminderMinutes
      next.reminderMinutes = reminderMinutes
      next.reminderAt = computeReminderAt(next.startAt, reminderMinutes)
      if (patch.startAt && patch.startAt !== row.startAt) next.reminderSentAt = null

      await write(STORE.calendarEvents, next)
      return (({ userId: _u, ...event }) => event)(next) as unknown as T
    }

    if (segments[0] === "calendar" && segments.length === 2 && method === "DELETE") {
      const row = await readOne<CalendarRow>(STORE.calendarEvents, segments[1])
      if (!row || row.userId !== userId) throw new Error("Event not found.")
      // Deleting the event removes its reminder with it: reminders live inside
      // the event row, so no orphan can exist.
      await drop(STORE.calendarEvents, row.id)
      return { ok: true, cancelledReminder: row.reminderAt !== null } as T
    }

    /* ---- schedules (compatibility view over the calendar) ---- */

    if (rawPath === "/schedules" && method === "GET") {
      return (await readMine<CalendarRow>(STORE.calendarEvents))
        .filter((row) => row.category === "class")
        .sort((left, right) => left.startAt.localeCompare(right.startAt))
        .map((row) => this.toSchedule(row)) as unknown as T
    }

    if (segments[0] === "schedules" && segments.length === 2 && (method === "PUT" || method === "PATCH")) {
      const row = await readOne<CalendarRow>(STORE.calendarEvents, segments[1])
      if (!row || row.userId !== userId) throw new Error("Schedule not found.")
      const body = payload as Partial<Schedule>
      const startAt = body.startAt ?? row.startAt
      const reminderMinutes = body.reminderMinutes ?? row.reminderMinutes
      const next: CalendarRow = {
        ...row,
        title: body.course?.trim() || row.title,
        startAt,
        endAt: body.endAt ?? row.endAt,
        location: body.room !== undefined ? (body.room?.trim() || null) : row.location,
        description: body.notes !== undefined ? (body.notes ?? "") : row.description,
        reminderMinutes,
        repeatRule: body.repeatRule ?? row.repeatRule,
        reminderAt: computeReminderAt(startAt, reminderMinutes),
        updatedAt: now,
      }
      if (startAt !== row.startAt) next.reminderSentAt = null
      await write(STORE.calendarEvents, next)
      return this.toSchedule(next) as unknown as T
    }

    if (segments[0] === "schedules" && segments.length === 2 && method === "DELETE") {
      const row = await readOne<CalendarRow>(STORE.calendarEvents, segments[1])
      if (!row || row.userId !== userId) throw new Error("Schedule not found.")
      await drop(STORE.calendarEvents, row.id)
      return { ok: true, cancelledReminder: row.reminderAt !== null } as T
    }

    /* ---- notifications ---- */

    if (rawPath === "/notifications" && method === "GET") {
      return (await readMine<NotificationRow>(STORE.notifications)).sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ) as unknown as T
    }

    if (rawPath === "/notifications/read-all" && method === "POST") {
      const unread = (await readMine<NotificationRow>(STORE.notifications)).filter((item) => !item.read)
      await Promise.all(unread.map((item) => write(STORE.notifications, { ...item, read: true })))
      return { ok: true, count: unread.length } as T
    }

    if (segments[0] === "notifications" && segments.length === 2 && method === "PATCH") {
      const notification = await readOne<NotificationRow>(STORE.notifications, segments[1])
      if (!notification || notification.userId !== userId) throw new Error("Notification not found.")
      const next = { ...notification, ...(payload as Partial<NotificationRow>), userId }
      await write(STORE.notifications, next)
      return next as unknown as T
    }

    if (segments[0] === "notifications" && segments.length === 2 && method === "DELETE") {
      const notification = await readOne<NotificationRow>(STORE.notifications, segments[1])
      if (!notification || notification.userId !== userId) throw new Error("Notification not found.")
      await drop(STORE.notifications, notification.id)
      return { ok: true } as T
    }

    /* ---- export ---- */

    /**
     * The export document is assembled from a fresh read of the authoritative
     * stores on every request, filtered by the caller's own id. Nothing is served
     * from a cache, and no other account's rows can be included.
     */
    if (rawPath === "/export" && method === "GET") {
      return (await this.buildExport(userId)) as T
    }

    /* ---- web push subscriptions ---- */

    if (rawPath === "/push/subscribe" && method === "POST") {
      const body = payload as unknown as {
        subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
        userAgent?: string
      }
      const endpoint = body?.subscription?.endpoint
      const p256dh = body?.subscription?.keys?.p256dh
      const auth = body?.subscription?.keys?.auth
      if (!endpoint || !p256dh || !auth) throw new Error("That push subscription is not complete.")
      const existing = (await readAll<PushSubRow>(STORE.pushSubscriptions)).filter(
        (row) => row.userId === userId,
      )
      const duplicate = existing.find((row) => row.endpoint === endpoint)
      if (duplicate) {
        await write<PushSubRow>(STORE.pushSubscriptions, {
          ...duplicate,
          p256dh,
          auth,
          userAgent: body.userAgent ?? duplicate.userAgent,
        })
        return { ok: true, created: false } as T
      }
      await write<PushSubRow>(STORE.pushSubscriptions, {
        id: randomId(),
        userId,
        endpoint,
        p256dh,
        auth,
        userAgent: body.userAgent ?? "",
        createdAt: now,
      })
      return { ok: true, created: true } as T
    }

    if (rawPath === "/push/unsubscribe" && method === "POST") {
      const body = payload as unknown as { endpoint?: string }
      if (!body?.endpoint) throw new Error("An endpoint is required.")
      const rows = await readMine<PushSubRow>(STORE.pushSubscriptions)
      const target = rows.find((row) => row.endpoint === body.endpoint)
      if (target) await drop(STORE.pushSubscriptions, target.id)
      return { ok: true } as T
    }

    if (rawPath === "/push/subscriptions" && method === "GET") {
      // Endpoints and client keys only never leave the device in this driver;
      // the count is what the UI needs in order to say whether push is armed.
      const rows = await readMine<PushSubRow>(STORE.pushSubscriptions)
      return { count: rows.length, active: rows.length > 0 } as T
    }

    /* ---- reminder scheduling and delivery records ---- */

    /**
     * Reminders that are due. The window is derived from `reminderAt` — which is
     * itself derived from the event — so editing an event moves its alert and
     * deleting the event removes it from this list. `reminderSentAt` is what
     * stops the same alert being delivered twice.
     */
    if (rawPath === "/reminders/due" && method === "GET") {
      const params = new URLSearchParams(query ?? "")
      const horizonMinutes = Number(params.get("horizonMinutes") ?? 0)
      const until = new Date(Date.now() + Math.max(0, horizonMinutes) * 60_000).toISOString()
      const events = (await readMine<CalendarRow>(STORE.calendarEvents))
        .filter((event) => event.reminderAt !== null && event.reminderAt <= until)
        .filter((event) => !event.reminderSentAt)
        .sort((left, right) => String(left.reminderAt).localeCompare(String(right.reminderAt)))
      return events.map(({ userId: _u, ...event }) => event) as unknown as T
    }

    if (segments[0] === "reminders" && segments.length === 3 && segments[2] === "delivered" && method === "POST") {
      const event = await readOne<CalendarRow>(STORE.calendarEvents, segments[1])
      if (!event || event.userId !== userId) throw new Error("Event not found.")
      const body = payload as unknown as {
        channel?: DeliveryRow["channel"]
        status?: DeliveryRow["status"]
        detail?: string
      }
      const channel = body?.channel ?? "in-app"
      const status = body?.status ?? "delivered"
      const reminderAt = event.reminderAt ?? event.startAt
      const id = `${userId}|${event.id}|${reminderAt}|${channel}`
      const existing = await readOne<DeliveryRow>(STORE.deliveries, id)
      if (!existing) {
        await write<DeliveryRow>(STORE.deliveries, {
          id,
          userId,
          eventId: event.id,
          reminderAt,
          channel,
          status,
          detail: body?.detail ?? "",
          createdAt: now,
          deliveredAt: status === "delivered" ? now : null,
        })
      }
      // Marking the event as sent is what makes a duplicate delivery impossible,
      // and a reschedule clears it so the alert can fire again at its new time.
      await write<CalendarRow>(STORE.calendarEvents, { ...event, reminderSentAt: now })
      return { ok: true, alreadyRecorded: Boolean(existing), reminderAt } as T
    }

    if (rawPath === "/reminders/deliveries" && method === "GET") {
      return (await readMine<DeliveryRow>(STORE.deliveries)).sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ) as unknown as T
    }

    /* ---- AI study assistant ---- */

    /**
     * The on-device driver has no server of its own, so it cannot hold a provider
     * key — and a key shipped to the browser would not be a secret any more. It
     * retrieves the relevant passages locally (materials live on this device) and
     * sends the question plus those passages to the deployed assistant endpoint,
     * which holds LLM_API_KEY. When no endpoint exists the caller gets an explicit
     * status rather than a canned answer.
     */
    if (rawPath === "/assistant" && method === "POST") {
      const body = payload as unknown as {
        messages?: AssistantMessage[]
        materialId?: string | null
        question?: string
      }
      const question = String(body?.question ?? "").trim()
      if (!question) throw new Error("Type a question first.")
      if (question.length > 4000) throw new Error("That question is too long. Please shorten it.")
      const materialId = body?.materialId ?? null

      const history = (body?.messages ?? [])
        .filter((item) => item && (item.role === "user" || item.role === "assistant"))
        .slice(-10)
        .map((item) => ({ role: item.role, content: String(item.content ?? "").slice(0, 4000) }))

      // Never send provider credentials from the browser.
      const endpoint = this.assistantEndpoint()
      if (!endpoint) {
        const local = await this.assistantContext(userId, materialId, question)
        return (await askGroq({
          question,
          history,
          materialId,
          materialTitle: local.materialTitle,
          passages: local.passages,
          reference: local.reference,
          id: randomId(),
        })) as T
      }

      const context = await this.assistantContext(userId, materialId, question)
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 50_000)
      try {
        const anon = supabaseAnonKey
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(anon ? { apikey: anon, Authorization: `Bearer ${anon}` } : {}),
          },
          body: JSON.stringify({ messages: history, question, context }),
          signal: controller.signal,
        })
        let wire: AssistantWire | null = null
        try {
          wire = (await response.json()) as AssistantWire
        } catch {
          wire = null
        }
        return toAssistantReply(response.status, wire, materialId, randomId()) as T
      } catch (reason) {
        const aborted = reason instanceof Error && reason.name === "AbortError"
        return toAssistantReply(
          aborted ? 504 : 0,
          {
            status: aborted ? "timeout" : "unreachable",
            detail: aborted
              ? "The assistant took too long to answer. Please try again."
              : "The assistant could not be reached. Check your connection and try again.",
          },
          materialId,
          randomId(),
        ) as T
      } finally {
        window.clearTimeout(timer)
      }
    }

    throw new Error(`This action is not available right now. Please try again. (${method})`)
  }

  /**
   * Retrieval for the assistant: the most relevant passages of the selected
   * material, ranked by term overlap. With no material selected the learner asked
   * for general answers, so nothing is retrieved. Only the caller's own materials
   * are ever read.
   */
  private async assistantContext(
    userId: string,
    materialId: string | null,
    question: string,
  ): Promise<{ materialTitle: string | null; reference: string | null; passages: string[] }> {
    if (!materialId) return { materialTitle: null, reference: null, passages: [] }
    const materials = (await readAll<MaterialRow>(STORE.materials)).filter(
      (row) => row.userId === userId && row.id === materialId,
    )
    if (!materials.length) return { materialTitle: null, reference: null, passages: [] }

    const terms = question
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3)
    const passages: string[] = []
    for (const material of materials) {
      const text = material.extractedText ?? ""
      if (!text) continue
      const paragraphs = text
        .split(/\n{2,}|\r\n\r\n/)
        .flatMap((block) => (block.length > 1200 ? block.match(/[\s\S]{1,1000}/g) ?? [] : [block]))
        .filter((block) => block.trim().length > 0)
      const scored = paragraphs.map((block) => {
        const lower = block.toLowerCase()
        const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0)
        return { block, score }
      })
      scored.sort((left, right) => right.score - left.score)
      for (const item of scored.slice(0, 4)) {
        passages.push(`[${material.title || material.name}] ${item.block.slice(0, 1200)}`)
      }
    }
    const title = materials[0]?.title ?? materials[0]?.name ?? null
    return { materialTitle: title, reference: title, passages: passages.slice(0, 8) }
  }

  private assistantEndpoint(): string | null {
    return assistantPublicUrl
  }

  private assistantConfigured(): boolean {
    return true
  }

  private vapidPublicKey(): string | null {
    const env = import.meta.env as unknown as Record<string, string | undefined>
    return env.VITE_VAPID_PUBLIC_KEY?.trim() || null
  }

  /**
   * Builds the export document from live rows.
   *
   * Everything readable by this account is included: its profile, its own
   * materials with their generated content, its notes (private ones and the ones
   * shared with it), its calendar and timetable, quiz attempts, the study
   * activity history, the SP ledger and the achievement record. Secrets are not
   * representable here because they are not stored in these stores at all.
   */
  private async buildExport(userId: string) {
    const account = await readOne<AccountRow>(STORE.accounts, userId)
    const [
      profile,
      materials,
      questions,
      notes,
      calendar,
      attempts,
      games,
      activity,
      ledger,
      achievementRows,
      streak,
      preferences,
      notifications,
    ] = await Promise.all([
      this.getProfile(userId),
      readAll<MaterialRow>(STORE.materials),
      readAll<QuestionRow>(STORE.questions),
      this.notesVisibleTo(userId),
      readAll<CalendarRow>(STORE.calendarEvents),
      readAll<AttemptRow>(STORE.attempts),
      readAll<GameRow>(STORE.games),
      readAll<StudyActivityRow>(STORE.studyActivity),
      this.xpLedger(userId),
      this.syncAchievements(userId),
      this.streakFor(userId),
      this.preferencesFor(userId),
      readAll<NotificationRow>(STORE.notifications),
    ])

    const mine = <T extends { userId: string }>(rows: T[]) => rows.filter((row) => row.userId === userId)
    const xp = ledger.reduce((total, event) => total + event.xp, 0)

    return {
      format: "llamastu-export",
      version: 1,
      generatedAt: new Date().toISOString(),
      generatedFor: { id: userId, email: account?.email ?? "" },
      profile,
      preferences: { notifications: preferences, character: await this.characterFor(userId) },
      progress: {
        xp,
        level: levelForXp(xp),
        streak: streak.streak,
        longestStreak: streak.longest,
        studyDays: streak.studyDays,
        lastActivityDate: streak.lastActivityDate,
        quizAttempts: mine(attempts).length,
      },
      materials: mine(materials).map((material) => ({
        id: material.id,
        title: material.title,
        name: material.name,
        subject: material.subject,
        status: material.status,
        size: material.size,
        wordCount: material.wordCount,
        summary: material.summary,
        keyPoints: material.keyPoints,
        objectives: material.objectives,
        flashcards: material.flashcards,
        extractedText: material.extractedText,
        createdAt: material.createdAt,
        updatedAt: material.updatedAt,
        questions: questions
          .filter((question) => question.materialId === material.id)
          .sort((left, right) => left.position - right.position)
          .map(({ materialId: _m, userId: _u, ...question }) => question),
      })),
      notes,
      calendarEvents: mine(calendar).map(({ userId: _u, ...event }) => event),
      timetable: mine(calendar)
        .filter((row) => row.category === "class")
        .map((row) => this.toSchedule(row)),
      quizAttempts: mine(attempts),
      gameProgress: mine(games).map(({ userId: _u, ...game }) => game),
      studyActivity: mine(activity).map(({ userId: _u, ...row }) => row),
      xpTransactions: ledger.map((row) => ({ ...row })),
      achievements: achievementRows.map((row) => ({ code: row.code, unlockedAt: row.unlockedAt })),
      notifications: mine(notifications).map(({ userId: _u, ...item }) => item),
      excluded: [
        "Passwords and session tokens are never stored in a readable form and are not exportable.",
        "The original uploaded binary files are not included; their extracted text and all generated content are.",
        "The VAPID private key and any provider API key live only in the server environment.",
      ],
    }
  }

  private async withQuestions(material: MaterialRow): Promise<Material> {
    const questions = (await readAll<QuestionRow>(STORE.questions))
      .filter((question) => question.materialId === material.id)
      .sort((left, right) => left.position - right.position)
      .map(({ materialId: _m, userId: _u, ...question }) => question)
    return { ...material, questions }
  }
}

export function emptyGameProgress(materialId: string, mapId: string): GameProgress {
  return {
    materialId,
    mapId,
    characterId: "",
    openedGates: [],
    collected: [],
    checkpoints: [],
    position: 0,
    finished: false,
    xpAwarded: 0,
    bestTimeSeconds: null,
    orbTotal: 0,
    updatedAt: new Date().toISOString(),
  }
}
