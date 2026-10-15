/**
 * XP, level, streak and achievement rules for the Edge Function.
 * Kept in sync with src/lib/rules.ts and src/lib/backends/localBackend.ts in
 * the frontend, so the hosted backend and the on-device driver behave
 * identically.
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
 * Every SP award the application can make. Awards are always named, never
 * invented by a client: the amount comes from this table and the client can
 * only choose WHICH activity happened, never how much it is worth.
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

export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1)
}

export const ACHIEVEMENT_XP: Record<string, number> = {
  first_upload: 10,
  first_quiz: 10,
  perfect_quiz: 25,
  first_gate: 10,
  world_explorer: 25,
  collector: 20,
  note_taker: 10,
  planner: 10,
  streak_3: 20,
  level_5: 30,
}

/** The achievement catalogue, mirrored from src/lib/rules.ts. */
export const ACHIEVEMENTS: {
  code: string
  title: string
  description: string
  icon: string
  xpReward: number
}[] = [
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

/**
 * Every achievement is presented as unlocked.
 *
 * This is an explicit product decision and is deliberately kept separate from
 * the reward ledger: flipping an achievement to "unlocked" does NOT write an SP
 * transaction, so no historical XP is fabricated and no duplicate reward can be
 * created by the change. Only a genuinely evaluated achievement awards SP.
 */
export const ALL_ACHIEVEMENTS_UNLOCKED = true

export type AchievementUnlock = { code: string; unlockedAt: string }

/**
 * The achievement state to persist and display: every code in the catalogue
 * with the timestamp of the genuine unlock when one exists, and a stable
 * fallback timestamp otherwise.
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

/**
 * The calendar-day arithmetic behind the study streak, kept pure so it can be
 * reasoned about directly.
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

export type ActivityKind = (typeof QUALIFYING_ACTIVITIES)[number]

const ONE_DAY_MS = 86_400_000

function dayValue(value: string): number {
  const parsed = new Date(`${value}T00:00:00`).getTime()
  return Number.isNaN(parsed) ? Number.NaN : parsed
}

export function computeStudyStreak(
  dates: string[],
  today: string,
): { streak: number; longest: number; studyDays: number; lastActivityDate: string | null } {
  const unique = Array.from(
    new Set(dates.filter((value) => value && !Number.isNaN(dayValue(value)))),
  ).sort()
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

export const DEFAULT_CHARACTER = {
  hair: "cocoa",
  face: "bright",
  outfit: "peach",
  shoes: "trail",
  hat: "none",
  glasses: "none",
  backpack: "canvas",
  accessory: "book",
}

export function orbCountFor(questionCount: number): number {
  return Math.max(3, Math.min(questionCount * 2, 24))
}
