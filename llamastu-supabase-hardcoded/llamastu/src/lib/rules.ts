import type {
  AchievementDefinition,
  ActivityKind,
  AppData,
  Character,
  ProgressState,
} from "../types"
import { gatesForMap, getMap, MAPS } from "../game/maps"

/**
 * Single source of truth for XP, levels and achievements.
 *
 * XP is never written directly to a counter. Every award is recorded as an
 * event with a stable `eventKey` and the database enforces uniqueness on
 * (user_id, event_key). That makes duplicate XP from replays, refreshes or
 * retried requests impossible, and makes the XP total derivable and auditable.
 */

export const XP = {
  materialProcessed: 25,
  quizQuestionCorrect: 20,
  gateOpened: 30,
  collectible: 5,
  worldFinished: 50,
  noteCreated: 10,
  scheduleCreated: 5,
} as const

export const XP_PER_LEVEL = 500

/**
 * Every SP award the application can make. The server-side (and on-device)
 * ledger validates an award against this table, so a client can never invent an
 * amount: it names an activity and the amount comes from here.
 */
export const XP_RULES: Record<string, number> = {
  material: XP.materialProcessed,
  quiz: XP.quizQuestionCorrect,
  gate: XP.gateOpened,
  collectible: XP.collectible,
  world: XP.worldFinished,
  note: XP.noteCreated,
  schedule: XP.scheduleCreated,
}

/**
 * The calendar-day arithmetic behind the study streak, kept pure so it can be
 * tested directly.
 *
 * Rules:
 *  - only these four activities qualify: processing a material, completing a
 *    recorded quiz, opening a challenge gate, finishing a world;
 *  - a qualifying calendar date is counted once, no matter how many activities
 *    happened on it;
 *  - the streak continues while consecutive qualifying dates exist;
 *  - it is still "alive" if the most recent qualifying date is today or
 *    yesterday, and is 0 once a whole day has been missed.
 */
export const QUALIFYING_ACTIVITIES = [
  "material_processed",
  "quiz_completed",
  "gate_opened",
  "world_finished",
] as const

const ONE_DAY_MS = 86_400_000

function dayValue(value: string): number {
  const parsed = new Date(`${value}T00:00:00`).getTime()
  return Number.isNaN(parsed) ? Number.NaN : parsed
}

export function computeStudyStreak(
  dates: string[],
  today: string,
): { streak: number; longest: number; studyDays: number; lastActivityDate: string | null } {
  const unique = Array.from(new Set(dates.filter((value) => value && !Number.isNaN(dayValue(value))))).sort()
  if (!unique.length) return { streak: 0, longest: 0, studyDays: 0, lastActivityDate: null }

  const descending = [...unique].reverse()
  const todayValue = dayValue(today)
  const mostRecent = dayValue(descending[0])

  let streak = 0
  if (mostRecent === todayValue || todayValue - mostRecent === ONE_DAY_MS) {
    streak = 1
    for (let index = 1; index < descending.length; index += 1) {
      const gap = dayValue(descending[index - 1]) - dayValue(descending[index])
      if (gap === ONE_DAY_MS) streak += 1
      else break
    }
  }

  let longest = 1
  let run = 1
  for (let index = 1; index < descending.length; index += 1) {
    const gap = dayValue(descending[index - 1]) - dayValue(descending[index])
    if (gap === ONE_DAY_MS) run += 1
    else run = 1
    longest = Math.max(longest, run)
  }

  return {
    streak,
    longest: Math.max(longest, streak),
    studyDays: unique.length,
    lastActivityDate: descending[0],
  }
}

/**
 * Every achievement is shown as unlocked.
 *
 * This is an explicit product decision: the Achievement gallery is a record of
 * what the account has done, and it is presented fully opened. It is
 * deliberately kept separate from the reward ledger — flipping an achievement to
 * "unlocked" does NOT write an SP transaction, so no historical XP is fabricated
 * and no duplicate reward can be created by the change.
 */
export const ALL_ACHIEVEMENTS_UNLOCKED = true

export type AchievementUnlock = { code: string; unlockedAt: string }

/**
 * The achievement state to persist and display: every code in the catalogue with
 * the timestamp of the genuine unlock when one exists, and a stable fallback
 * timestamp otherwise.
 */
export function achievementStates(
  genuine: AchievementUnlock[],
  fallbackIso: string,
): AchievementUnlock[] {
  const known = new Map(genuine.map((item) => [item.code, item.unlockedAt]))
  if (!ALL_ACHIEVEMENTS_UNLOCKED) {
    return ACHIEVEMENTS.filter((item) => known.has(item.code)).map((item) => ({
      code: item.code,
      unlockedAt: known.get(item.code) as string,
    }))
  }
  return ACHIEVEMENTS.map((item) => ({
    code: item.code,
    unlockedAt: known.get(item.code) ?? fallbackIso,
  }))
}

export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1)
}

export function xpIntoLevel(xp: number): number {
  return Math.max(0, xp) % XP_PER_LEVEL
}

export function xpToNextLevel(xp: number): number {
  return XP_PER_LEVEL - xpIntoLevel(xp)
}

export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    code: "first_upload",
    title: "First Upload",
    description: "Processed your first real learning material.",
    icon: "upload",
    xpReward: 10,
  },
  {
    code: "first_quiz",
    title: "Quiz Explorer",
    description: "Submitted your first generated quiz.",
    icon: "quiz",
    xpReward: 10,
  },
  {
    code: "perfect_quiz",
    title: "Quiz Master",
    description: "Scored 100% on a generated quiz.",
    icon: "award",
    xpReward: 25,
  },
  {
    code: "first_gate",
    title: "First Game",
    description: "Opened your first challenge gate in the adventure world.",
    icon: "play",
    xpReward: 10,
  },
  {
    code: "world_explorer",
    title: "World Explorer",
    description: "Reached the goal and finished a complete learning world.",
    icon: "spark",
    xpReward: 25,
  },
  {
    code: "collector",
    title: "Orb Collector",
    description: "Collected every study orb inside a learning world.",
    icon: "check",
    xpReward: 20,
  },
  {
    code: "note_taker",
    title: "Note Taker",
    description: "Created your first study note.",
    icon: "edit",
    xpReward: 10,
  },
  {
    code: "planner",
    title: "Planner",
    description: "Added your first class to your schedule.",
    icon: "calendar",
    xpReward: 10,
  },
  {
    code: "streak_3",
    title: "Consistent Learner",
    description: "Studied three days in a row.",
    icon: "flame",
    xpReward: 20,
  },
  {
    code: "level_5",
    title: "Rising Scholar",
    description: "Reached level 5.",
    icon: "book",
    xpReward: 30,
  },
]

export const ACHIEVEMENT_BY_CODE: Record<string, AchievementDefinition> = Object.fromEntries(
  ACHIEVEMENTS.map((item) => [item.code, item]),
)

export const DEFAULT_CHARACTER: Character = {
  model: "male",
  hair: "cocoa",
  face: "bright",
  outfit: "peach",
  shoes: "trail",
  hat: "none",
  glasses: "none",
  backpack: "canvas",
  accessory: "book",
}

export const CHARACTER_OPTIONS: Record<keyof Character, string[]> = {
  model: ["male", "female"],
  hair: ["cocoa", "chestnut", "sunset"],
  face: ["bright", "calm", "focused"],
  outfit: ["peach", "blue", "terracotta"],
  shoes: ["trail", "canvas", "study"],
  hat: ["none", "beanie", "cap"],
  glasses: ["none", "round", "square"],
  backpack: ["canvas", "coral", "brown"],
  accessory: ["book", "pencil", "badge"],
}

/** The two playable bodies, used by the character selection screen. */
export const CHARACTER_MODELS: { id: "male" | "female"; label: string; blurb: string }[] = [
  {
    id: "male",
    label: "Male",
    blurb: "Broader frame and a shorter cut. Longer stride, steadier landing.",
  },
  {
    id: "female",
    label: "Female",
    blurb: "Taller silhouette with long hair and a flared tunic. Lighter on her feet.",
  },
]

export function emptyProgress(): ProgressState {
  return {
    xp: 0,
    level: 1,
    streak: 0,
    longestStreak: 0,
    quizAttempts: 0,
    completedChallenges: 0,
    character: { ...DEFAULT_CHARACTER },
  }
}

export function eventKeyMaterial(materialId: string): string {
  return `material:${materialId}:processed`
}

/**
 * Every world key includes the map id, so the same material played in two
 * different maps keeps two independent sets of rewards — and replaying either
 * map cannot award the same XP twice.
 */
export function eventKeyGate(materialId: string, mapId: string, questionId: string): string {
  return `gate:${materialId}:${mapId}:${questionId}`
}

export function eventKeyCollectible(
  materialId: string,
  mapId: string,
  collectibleId: string,
): string {
  return `collect:${materialId}:${mapId}:${collectibleId}`
}

export function eventKeyWorld(materialId: string, mapId: string): string {
  return `world:${materialId}:${mapId}:finished`
}

/** Stable identity for one world: material + map. */
export function gameKey(materialId: string, mapId: string): string {
  return `${materialId}:${mapId}`
}

export function eventKeyQuizAnswer(materialId: string, questionId: string): string {
  return `quiz:${materialId}:${questionId}`
}

export function eventKeyNote(noteId: string): string {
  return `note:${noteId}:created`
}

export function eventKeySchedule(scheduleId: string): string {
  return `schedule:${scheduleId}:created`
}

export function eventKeyAchievement(code: string): string {
  return `achievement:${code}`
}

/**
 * Stable identity for one qualifying learning activity, so recording the same
 * activity twice (a double submit, a retry, a replayed event) can never add a
 * second study day or a second reward.
 */
export function activityKey(kind: ActivityKind, subjectId: string): string {
  return `activity:${kind}:${subjectId}`
}

/**
 * Evaluates which achievements the current state unlocks. Pure function so
 * both backend drivers behave identically.
 */
export function evaluateAchievements(input: {
  processedMaterials: number
  quizAttempts: number
  perfectQuizzes: number
  openedGates: number
  finishedWorlds: number
  allOrbsCollected: boolean
  notes: number
  schedules: number
  streak: number
  level: number
}): string[] {
  const unlocked: string[] = []
  if (input.processedMaterials >= 1) unlocked.push("first_upload")
  if (input.quizAttempts >= 1) unlocked.push("first_quiz")
  if (input.perfectQuizzes >= 1) unlocked.push("perfect_quiz")
  if (input.openedGates >= 1) unlocked.push("first_gate")
  if (input.finishedWorlds >= 1) unlocked.push("world_explorer")
  if (input.allOrbsCollected) unlocked.push("collector")
  if (input.notes >= 1) unlocked.push("note_taker")
  if (input.schedules >= 1) unlocked.push("planner")
  if (input.streak >= 3) unlocked.push("streak_3")
  if (input.level >= 5) unlocked.push("level_5")
  return unlocked
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1048576).toFixed(1)} MB`
}

export function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

export function materialLabel(material: { title?: string | null; name: string }): string {
  return material.title?.trim() || material.name
}

/** Progress of one world (material + map): gates cleared ÷ gates in that map. */
export function worldProgress(data: AppData, materialId: string, mapId: string): number {
  const material = data.materials.find((item) => item.id === materialId)
  if (!material) return 0
  const total = gatesForMap(getMap(mapId), material.questions.length)
  const game = data.games[gameKey(materialId, mapId)]
  if (!game) return 0
  return Math.round(Math.min(1, game.openedGates.length / Math.max(1, total)) * 100)
}

/** The material's headline progress: its best-explored world. */
export function materialProgress(data: AppData, materialId: string): number {
  const material = data.materials.find((item) => item.id === materialId)
  if (!material) return 0
  if (material.status !== "ready") return 0
  if (material.questions.length === 0) return 100
  return MAPS.reduce(
    (best, map) => Math.max(best, worldProgress(data, materialId, map.id)),
    0,
  )
}

/** How many worlds (maps) of a material the learner has started or finished. */
export function worldsPlayed(data: AppData, materialId: string): number {
  return Object.keys(data.games).filter((key) => key.startsWith(`${materialId}:`)).length
}

/** Worlds of a material that have been completed at least once. */
export function worldsCompleted(data: AppData, materialId: string): number {
  return Object.values(data.games).filter(
    (game) => game.materialId === materialId && game.finished,
  ).length
}
