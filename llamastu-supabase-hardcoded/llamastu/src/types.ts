/**
 * Shared domain types. These mirror the relational schema in
 * `supabase/migrations/0001_init.sql` and are used by both the Supabase
 * backend driver and the offline IndexedDB driver so the UI is identical
 * regardless of which backend is active.
 */

export type Page =
  | "home"
  | "materials"
  | "workspace"
  | "notes"
  | "calendar"
  | "schedule"
  | "assistant"
  | "achievements"
  | "settings"

export type IconName =
  | "home"
  | "book"
  | "folder"
  | "quiz"
  | "calendar"
  | "user"
  | "award"
  | "settings"
  | "upload"
  | "spark"
  | "bell"
  | "search"
  | "play"
  | "clock"
  | "arrow"
  | "plus"
  | "moon"
  | "check"
  | "file"
  | "flame"
  | "close"
  | "trash"
  | "edit"
  | "share"
  | "logout"
  | "menu"
  | "chevron-left"
  | "chevron-right"
  | "download"
  | "key"

export type MaterialStatus =
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | "needs_text"

export type Question = {
  id: string
  position: number
  question: string
  choices: string[]
  answerIndex: number
  explanation: string
  difficulty: "easy" | "medium" | "hard"
}

export type Flashcard = {
  id: string
  front: string
  back: string
}

export type Material = {
  id: string
  userId: string
  title: string
  name: string
  subject: string | null
  type: string
  size: number
  storagePath: string | null
  status: MaterialStatus
  errorMessage: string | null
  summary: string | null
  keyPoints: string[]
  objectives: string[]
  flashcards: Flashcard[]
  extractedText: string | null
  questions: Question[]
  wordCount: number
  xpAwarded: boolean
  processedAt: string | null
  createdAt: string
  updatedAt: string
}

export type NoteCollaborator = {
  id: string
  userId: string
  email: string
  permission: "viewer" | "editor"
}

/**
 * Who may reach a note.
 *
 * - `private`  — only the owner and explicitly invited collaborators.
 * - `view`     — anyone holding the share link may read, nobody but the owner
 *                and invited editors may write.
 * - `edit`     — anyone holding the share link may read and write.
 *
 * The link is only meaningful while the owner keeps sharing switched on; setting
 * the mode back to `private` revokes it immediately and clears the token.
 */
export type NoteShareMode = "private" | "view" | "edit"

export type Note = {
  id: string
  ownerId: string
  ownerEmail: string
  title: string
  content: string
  materialId: string | null
  collaborators: NoteCollaborator[]
  /** Opaque, unguessable token; `null` whenever sharing is off. */
  shareToken: string | null
  shareMode: NoteShareMode
  /**
   * Monotonic revision of the note body. Every accepted write bumps it, so a
   * stale editor can be rejected instead of silently overwriting newer text.
   */
  version: number
  createdAt: string
  updatedAt: string
}

export type Schedule = {
  id: string
  course: string
  lecturer: string | null
  startAt: string
  endAt: string
  room: string | null
  notes: string | null
  repeatRule: "none" | "weekly"
  reminderMinutes: number
  createdAt: string
  updatedAt: string
}

export type AppNotification = {
  id: string
  title: string
  message: string
  kind: "material" | "quiz" | "game" | "schedule" | "achievement" | "system"
  read: boolean
  createdAt: string
}

export type CharacterModel = "male" | "female"

export type Character = {
  /** Which playable body the learner uses in the adventure worlds. */
  model: CharacterModel
  hair: string
  face: string
  outfit: string
  shoes: string
  hat: string
  glasses: string
  backpack: string
  accessory: string
}

export type Profile = {
  name: string
  username: string
  email: string
  program: string
  semester: string
  bio: string
}

export type ProgressState = {
  xp: number
  level: number
  streak: number
  longestStreak: number
  quizAttempts: number
  completedChallenges: number
  character: Character
}

/**
 * Progress inside one world. Keyed by (material, map): the same document played
 * in two different maps keeps two independent sets of gates, orbs and
 * checkpoints, and each map awards its own XP exactly once.
 */
export type GameProgress = {
  materialId: string
  mapId: string
  /** Character used for this run, remembered so a replay looks consistent. */
  characterId: string
  openedGates: string[]
  collected: string[]
  checkpoints: string[]
  position: number
  finished: boolean
  xpAwarded: number
  bestTimeSeconds: number | null
  /** How many collectibles this world contains, reported by the game. */
  orbTotal: number
  updatedAt: string
}

export type CalendarCategory =
  | "study"
  | "class"
  | "exam"
  | "assignment"
  | "review"
  | "other"

export type RepeatRule = "none" | "daily" | "weekly" | "monthly"

export type CalendarEvent = {
  id: string
  title: string
  description: string
  category: CalendarCategory
  startAt: string
  endAt: string
  location: string | null
  /** Minutes before start that the reminder fires. 0 = at start time. */
  reminderMinutes: number
  repeatRule: RepeatRule
  /** Set when the event was created from a material. */
  materialId: string | null
  /** Derived from the event and its reminder; persisted so it can be cancelled. */
  reminderAt: string | null
  reminderSentAt: string | null
  createdAt: string
  updatedAt: string
}

export type NotificationPreferences = {
  /** Master switch for in-app notifications. */
  enabled: boolean
  studyReminders: boolean
  gameReminders: boolean
  agendaReminders: boolean
  /** Browser Notification API reminders for calendar events. */
  browserPush: boolean
  /** How long before the event a browser reminder fires, in minutes. */
  leadMinutes: number
}

export type AppPreferences = {
  /** Null until a legacy device preference has been migrated or a choice is saved. */
  darkMode: boolean | null
}

export type PushSubscriptionInfo = {
  endpoint: string
  keys: { p256dh: string; auth: string }
  userAgent: string
}

export type AchievementDefinition = {
  code: string
  title: string
  description: string
  icon: IconName
  xpReward: number
}

export type AchievementState = {
  code: string
  unlockedAt: string
}

export type QuizAttempt = {
  id: string
  materialId: string
  score: number
  total: number
  xpAwarded: number
  answers: Record<string, number>
  createdAt: string
}

export type User = {
  id: string
  email: string
}

export type AppData = {
  user: User
  profile: Profile
  preferences: AppPreferences
  progress: ProgressState
  materials: Material[]
  notes: Note[]
  /**
   * Every calendar entry. Class entries (`category: "class"`) are the same rows
   * the Schedule page shows, so there is one source of truth rather than two
   * competing systems.
   */
  calendarEvents: CalendarEvent[]
  /** Derived view of `calendarEvents` for the timetable screen. */
  schedules: Schedule[]
  notifications: AppNotification[]
  notificationPreferences: NotificationPreferences
  achievements: AchievementState[]
  games: Record<string, GameProgress>
}

export type BackendMode = "supabase" | "local"

export type BackendInfo = {
  mode: BackendMode
  label: string
  detail: string
  /** True when material content can be produced by a configured model service. */
  aiConfigured: boolean
}

export type AuthSession = {
  userId: string
  email: string
  accessToken: string | null
  expiresAt: number | null
}

/* ------------------------------------------------------------------ *
 * Study activity, rewards and delivery records
 * ------------------------------------------------------------------ */

/**
 * The activities that are allowed to count towards the study streak and to
 * award SP. A visit to a page is deliberately NOT one of them.
 */
export type ActivityKind =
  | "material_processed"
  | "quiz_completed"
  | "gate_opened"
  | "world_finished"

/**
 * One canonical learning activity. `date` is the calendar day the activity is
 * attributed to, and `(userId, date)` may only appear once in the streak —
 * twenty quizzes in one evening still count as a single study day.
 */
export type StudyActivity = {
  id: string
  userId: string
  kind: ActivityKind
  /** `YYYY-MM-DD` in the account's local day. */
  date: string
  /** Stable key so the same activity can never be recorded twice. */
  activityKey: string
  createdAt: string
}

/** One immutable SP transaction. The total is always the sum of these rows. */
export type XpTransaction = {
  id: string
  userId: string
  eventKey: string
  xp: number
  createdAt: string
}

/** The derived, always-recomputed study statistics. */
export type StudyStats = {
  /** Consecutive qualifying days ending today or yesterday. */
  streak: number
  longestStreak: number
  /** Total SP, equal to the sum of every SP transaction. */
  xp: number
  level: number
  /** Distinct qualifying study days, all time. */
  studyDays: number
  lastActivityDate: string | null
}

/** How a shared note link resolved for the caller. */
export type NoteAccess = "owner" | "editor" | "viewer" | "link-view" | "link-edit"

export type SharedNoteView = {
  note: Note
  access: NoteAccess
  canEdit: boolean
}

/* ------------------------------------------------------------------ *
 * AI Study Assistant
 * ------------------------------------------------------------------ */

export type AssistantRole = "user" | "assistant"

export type AssistantMessage = {
  id: string
  role: AssistantRole
  content: string
  createdAt: string
  /** Material this turn was grounded in, when one was selected. */
  materialId?: string | null
  /** Section/heading the grounding quote came from, when available. */
  reference?: string | null
}

export type AssistantStatus =
  | "ready"
  | "missing_key"
  | "unreachable"
  | "rate_limited"
  | "timeout"
  | "error"

export type AssistantReply = {
  message: AssistantMessage
  status: AssistantStatus
  /** Present when `status` is not `ready`; safe to display to the learner. */
  detail?: string
  /** Named configuration still required before the assistant can answer. */
  missing?: string
}
