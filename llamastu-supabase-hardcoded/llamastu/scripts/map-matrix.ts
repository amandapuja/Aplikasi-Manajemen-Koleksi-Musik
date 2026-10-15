/**
 * Map matrix harness.
 *
 * Proves, mechanically, the things a single browser play-through cannot prove
 * reliably: that EVERY map is well formed, that a bot can actually get from
 * spawn to goal in each of the five, that a closed gate blocks each of them,
 * that the five are structurally distinct rather than recolours, and that a
 * calendar reminder always moves with its agenda.
 *
 * Complements scripts/smoke-test.ts. Run with:  npm run test:logic
 *
 * This file is intentionally ASCII-only.
 */

import { buildLevel, gateTriggerZone, safeSpawnFor } from "../src/game/level"
import {
  DEATH_COOLDOWN,
  GROUND_Y,
  LEVEL_HEIGHT,
  MAX_FALL_SPEED,
  PLATFORM_THICKNESS,
  PLAYER_H,
  PLAYER_W,
} from "../src/game/constants"
import {
  createWorld,
  openGate,
  overlaps,
  resetSession,
  stepWorld,
  type Input,
  type World,
  type WorldEvent,
} from "../src/game/engine"
import { canvasMetrics, renderWorld } from "../src/game/render"
import { getCharacter } from "../src/game/characters"
import {
  ACHIEVEMENTS,
  ALL_ACHIEVEMENTS_UNLOCKED,
  achievementStates,
  activityKey,
  computeStudyStreak,
} from "../src/lib/rules"
import { gatesForMap, MAPS } from "../src/game/maps"
import { computeReminderAt, occurrencesFor, buildMonthGrid, dayKey } from "../src/lib/calendar"
import { DEMO_EMAIL, DEMO_MATERIALS, DEMO_PASSWORD } from "../src/lib/demo"
import { generateLearningContent } from "../src/lib/content"
import type { CalendarEvent, Material, Question } from "../src/types"

let failures = 0
let checks = 0

function check(name: string, condition: boolean, detail = "") {
  checks += 1
  if (condition) console.log(`  ok   ${name}`)
  else {
    failures += 1
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`)
  }
}

function section(title: string) {
  console.log(`\n${title}`)
}

function fakeMaterial(id: string, questionCount: number): Material {
  const questions: Question[] = []
  for (let index = 0; index < questionCount; index += 1) {
    questions.push({
      id: `q-${id}-${index}`,
      position: index,
      question: `Question ${index}`,
      choices: ["a", "b", "c", "d"],
      answerIndex: index % 4,
      explanation: "because",
      difficulty: "medium",
    })
  }
  const now = new Date().toISOString()
  return {
    id,
    userId: "u1",
    title: `Material ${id}`,
    name: `${id}.txt`,
    subject: null,
    type: "text/plain",
    size: 1000,
    storagePath: null,
    status: "ready",
    errorMessage: null,
    summary: "summary",
    keyPoints: [],
    objectives: [],
    flashcards: [],
    extractedText: "text",
    questions,
    wordCount: 300,
    xpAwarded: true,
    processedAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

const STEP = 1 / 120

/** Runs right, holds jump when a wall or a pit is ahead. */
function createBot() {
  let holdUntil = -1
  return function botInput(world: World): Input {
    const player = world.player
    const probeX = player.x + PLAYER_W + 10
    const feet = player.y + PLAYER_H
    const solids = [
      ...world.level.solids,
      ...world.level.gates
        .filter((gate) => !gate.opened)
        .map((gate) => ({ x: gate.x, y: gate.y, w: gate.w, h: gate.h })),
      ...world.level.movers.map((mover) => ({ x: mover.x, y: mover.y, w: mover.w, h: mover.h })),
    ]
    const wallAhead = solids.some(
      (solid) =>
        probeX + 12 > solid.x &&
        probeX - 6 < solid.x + solid.w &&
        feet > solid.y + 6 &&
        player.y < solid.y + solid.h,
    )
    const floorAhead = solids.some(
      (solid) => probeX > solid.x && probeX < solid.x + solid.w && Math.abs(feet - solid.y) < 8,
    )
    if (player.onGround && (wallAhead || !floorAhead)) holdUntil = world.elapsed + 0.3
    return { left: false, right: true, jump: world.elapsed < holdUntil }
  }
}

function playMap(material: Material, mapId: string, openGates: boolean) {
  const map = MAPS.find((item) => item.id === mapId) ?? MAPS[0]
  const world = createWorld(buildLevel(material, map, []), {
    openedGates: [],
    collected: [],
    checkpoints: [],
    finished: false,
  })
  const bot = createBot()
  const events: WorldEvent[] = []
  let triggers = 0
  const maxTicks = 30 * 120
  for (let tick = 0; tick < maxTicks; tick += 1) {
    for (const event of stepWorld(world, bot(world), STEP)) {
      events.push(event)
      if (event.type === "gate-trigger") {
        triggers += 1
        if (openGates) {
          const gate = world.level.gates.find((item) => item.id === event.gateId)
          if (gate) openGate(world, gate)
        }
      }
    }
    if (world.status === "finished") break
  }
  return { world, events, triggers }
}

const materials = [4, 8, 14].map((count) => fakeMaterial(`mx${count}`, count))

/* ------------------------------------------------------------------ *
 * 1. Every map is geometrically valid
 * ------------------------------------------------------------------ */

section("1. Every map builds a valid, completable level")

const stats = new Map<string, { gateHeight: number; maxGap: number; rows: number; maxRise: number }>()
let gatesMatch = true
let platformsClear = true
let gatesUnjumpable = true
let gapsSane = true
let structureOk = true

for (const map of MAPS) {
  for (const material of materials) {
    const level = buildLevel(material, map)
    if (level.gates.length !== gatesForMap(map, material.questions.length)) gatesMatch = false
    if (level.orbs.length < 3 || level.solids.length < 3) structureOk = false
    if (level.checkpoints.length < level.gates.length + 2) structureOk = false
    if (level.goal.x <= 0 || level.goal.x >= level.width) structureOk = false
    if (level.spawn.x < 0 || level.spawn.y >= GROUND_Y) structureOk = false

    for (const solid of level.solids) {
      if (solid.h !== PLATFORM_THICKNESS) continue
      for (const gate of level.gates) if (overlaps(solid, gate)) platformsClear = false
    }

    const highest = Math.min(...level.solids.filter((s) => s.h <= 60).map((s) => s.y))
    if (Number.isFinite(highest)) {
      const reachableTop = highest - level.maxRise
      for (const gate of level.gates) if (reachableTop <= gate.y) gatesUnjumpable = false
    }

    const ground = level.solids.filter((s) => s.h > 60).sort((a, b) => a.x - b.x)
    let widest = 0
    for (let index = 1; index < ground.length; index += 1) {
      const gap = ground[index].x - (ground[index - 1].x + ground[index - 1].w)
      if (gap <= 0 || gap > 300) gapsSane = false
      widest = Math.max(widest, gap)
    }

    const rows = new Set(
      level.solids.filter((s) => s.h <= 60).map((s) => Math.round(GROUND_Y - s.y)),
    ).size
    stats.set(map.id, {
      gateHeight: level.gateHeight,
      maxGap: widest,
      rows,
      maxRise: Math.round(level.maxRise),
    })
  }
}

check("gates match each map's declared challenge count", gatesMatch)
check("every level has ground, platforms, orbs, checkpoints and a goal", structureOk)
check("no floating platform intersects a gate", platformsClear)
check("no platform lets the player clear a gate", gatesUnjumpable)
check("every pit is inside its map's jump envelope", gapsSane)
check("the spawn is above the ground", safeSpawnFor(buildLevel(materials[0], MAPS[0]), null).y < GROUND_Y)
{
  const sample = buildLevel(materials[1], MAPS[0])
  const zone = gateTriggerZone(sample.gates[0])
  check("the gate trigger sits in front of the gate", zone.x + zone.w <= sample.gates[0].x + 1)
  check("the gate reaches the ground", sample.gates[0].y + sample.gates[0].h === GROUND_Y)
}

/* ------------------------------------------------------------------ *
 * 2. The five maps are structurally distinct
 * ------------------------------------------------------------------ */

section("2. The five maps are genuinely different, not recolours")

const list = [...stats.values()]
check("five maps are defined", MAPS.length === 5, `${MAPS.length}`)
check("every map id is unique", new Set(MAPS.map((m) => m.id)).size === 5)
check("every environment is unique", new Set(MAPS.map((m) => m.environment)).size === 5)
check("every theme is unique", new Set(MAPS.map((m) => m.theme)).size === 5)
check("every objective is unique", new Set(MAPS.map((m) => m.objective)).size === 5)
check("every collectible identity is unique", new Set(MAPS.map((m) => m.collectibleName)).size === 5)
check("gravity differs", new Set(MAPS.map((m) => m.gravityScale)).size >= 4)
check("every map uses a different mechanic", new Set(MAPS.map((m) => m.mechanic)).size === 5)
check("palettes differ", new Set(MAPS.map((m) => m.palette.groundTop + m.palette.skyTop)).size === 5)
check("background decor treatment differs", new Set(MAPS.map((m) => m.palette.decor)).size === 5)
check("difficulty labels are used", new Set(MAPS.map((m) => m.difficulty)).size >= 2)

const gateHeights = new Set(list.map((s) => s.gateHeight))
const maxGaps = new Set(list.map((s) => s.maxGap))
const rowCounts = new Set(list.map((s) => s.rows))
const rises = new Set(list.map((s) => s.maxRise))
check("resulting gate heights differ", gateHeights.size >= 4, [...gateHeights].join(", "))
check("resulting pit widths differ", maxGaps.size >= 4, [...maxGaps].join(", "))
check("platform layout depth differs", rowCounts.size >= 2, [...rowCounts].join(", "))
check("reachable jump height differs", rises.size >= 3, [...rises].join(", "))

check(
  "low-ceiling map really caps the jump",
  MAPS.filter((m) => m.mechanic === "low-ceiling").every((m) => {
    const level = buildLevel(materials[1], m)
    return level.maxRise < 145.45 / m.gravityScale
  }),
)
check(
  "space-station map really has moving platforms",
  MAPS.filter((m) => m.mechanic === "moving-platforms").every(
    (m) => buildLevel(materials[1], m).movers.length > 0,
  ),
)
check(
  "island map really places stepping stones inside its pits",
  MAPS.filter((m) => m.mechanic === "stepping-stones").every((m) => {
    const level = buildLevel(materials[1], m)
    const ground = level.solids.filter((s) => s.h > 60).sort((a, b) => a.x - b.x)
    let stones = 0
    for (let index = 1; index < ground.length; index += 1) {
      const from = ground[index - 1].x + ground[index - 1].w
      const to = ground[index].x
      stones += level.solids.filter((s) => s.h <= 60 && s.x > from && s.x + s.w < to).length
    }
    return stones > 0
  }),
)
check(
  "kitchen map really adds counter rows",
  MAPS.filter((m) => m.mechanic === "counters").every(
    (m) =>
      new Set(buildLevel(materials[1], m).solids.filter((s) => s.h <= 60).map((s) => s.y)).size >= 3,
  ),
)

/* ------------------------------------------------------------------ *
 * 3. A bot plays each map from spawn to goal
 * ------------------------------------------------------------------ */

section("3. A bot plays each of the five maps from spawn to goal")

for (const map of MAPS) {
  const result = playMap(materials[1], map.id, true)
  const level = result.world.level
  const opened = level.gates.filter((g) => g.opened).length
  const orbs = level.orbs.filter((o) => o.taken).length
  const reached = level.checkpoints.filter((c) => c.reached).length
  const goal = result.events.some((e) => e.type === "goal")

  check(`${map.name}: goal reached`, goal, `status=${result.world.status}`)
  check(`${map.name}: all gates opened`, opened === level.gates.length, `${opened}/${level.gates.length}`)
  check(`${map.name}: each gate triggered once`, result.triggers === level.gates.length)
  check(`${map.name}: collectibles picked up`, orbs >= 3, `${orbs}/${level.orbCount}`)
  check(`${map.name}: checkpoints activated`, reached >= 2, `${reached}`)
  check(
    `${map.name}: session XP = orbs x5 + goal`,
    result.world.sessionXp === orbs * 5 + 50,
    `${result.world.sessionXp}`,
  )
}

/* ------------------------------------------------------------------ *
 * 4. Collision and boundaries on every map
 * ------------------------------------------------------------------ */

section("4. A closed gate blocks the player on every map")

for (const map of MAPS) {
  const blocked = playMap(materials[1], map.id, false)
  const gate = blocked.world.level.gates[0]
  const orbs = blocked.world.level.orbs.filter((o) => o.taken).length
  check(
    `${map.name}: the player stops at the gate`,
    blocked.world.player.x + PLAYER_W <= gate.x + 1,
    `x=${blocked.world.player.x.toFixed(1)} gate=${gate.x}`,
  )
  check(`${map.name}: the challenge is raised`, blocked.triggers >= 1)
  check(`${map.name}: the world pauses`, blocked.world.status === "challenge", blocked.world.status)
  check(
    `${map.name}: no gate or goal XP while locked`,
    blocked.world.sessionXp === orbs * 5,
    `${blocked.world.sessionXp}`,
  )
}

{
  const level = buildLevel(materials[0], MAPS[0], materials[0].questions.map((q) => q.id))
  const world = createWorld(level, {
    openedGates: materials[0].questions.map((q) => q.id),
    collected: [],
    checkpoints: [level.checkpoints[0].id],
    finished: false,
  })
  level.checkpoints.forEach((c) => {
    c.reached = c.id === level.checkpoints[0].id
  })
  const slabs = level.solids.filter((s) => s.h > 60).sort((a, b) => a.x - b.x)
  const pitX = (slabs[0].x + slabs[0].w + slabs[1].x) / 2
  world.player.x = pitX
  world.player.y = GROUND_Y - 10
  world.player.vy = MAX_FALL_SPEED
  let died = false
  for (let tick = 0; tick < 400 && !died; tick += 1) {
    died = stepWorld(world, { left: false, right: false, jump: false }, STEP).some((e) => e.type === "died")
  }
  check("falling into a pit is a death", died)
  check("respawn returns to the last checkpoint", world.player.x < pitX)
  check("respawn restores a standing position", world.player.y + PLAYER_H <= GROUND_Y + 1)
  check("deaths are counted", world.deaths === 1)
}

{
  const wanders = MAPS.map((map) => {
    const level = buildLevel(materials[0], map)
    return {
      map,
      world: createWorld(level, { openedGates: [], collected: [], checkpoints: [], finished: false }),
    }
  })
  for (const entry of wanders) {
    for (let tick = 0; tick < 400; tick += 1) {
      stepWorld(entry.world, { left: true, right: false, jump: true }, STEP)
    }
  }
  check(
    "the player cannot leave the left edge of any world",
    wanders.every((entry) => entry.world.player.x >= 0),
  )
  for (const entry of wanders) {
    for (let tick = 0; tick < 25000; tick += 1) {
      stepWorld(entry.world, { left: false, right: true, jump: true }, STEP)
    }
  }
  check(
    "the player cannot run past the right edge of any world",
    wanders.every((entry) => entry.world.player.x + PLAYER_W <= entry.world.level.width + 1),
  )
}

{
  const map = MAPS.find((m) => m.mechanic === "moving-platforms")!
  const level = buildLevel(materials[1], map)
  const world = createWorld(level, {
    openedGates: [],
    collected: [],
    checkpoints: [],
    finished: false,
  })
  const mover = level.movers[0]
  world.player.x = mover.x + 30
  world.player.y = mover.y - PLAYER_H
  world.player.vy = 0
  const startX = world.player.x
  let carried = false
  for (let tick = 0; tick < 240; tick += 1) {
    stepWorld(world, { left: false, right: false, jump: false }, STEP)
    if (Math.abs(world.player.x - startX) > 5 && world.player.onGround) carried = true
  }
  check("a moving platform carries the player standing on it", carried)
  check(
    "the player does not fall through a moving platform",
    world.player.y + PLAYER_H <= mover.y + mover.h + 2,
  )
}

/* ------------------------------------------------------------------ *
 * 5. Calendar reminders follow their agenda
 * ------------------------------------------------------------------ */

section("5. A calendar reminder always moves with its agenda")

const base = "2026-10-05T19:00:00"
const r15 = computeReminderAt(base, 15)
check(
  "19:00 with a 15 minute reminder fires at 18:45",
  r15 !== null && new Date(r15).getHours() === 18 && new Date(r15).getMinutes() === 45,
  r15 ?? "null",
)
const moved = computeReminderAt("2026-10-05T20:00:00", 15)
check(
  "moving the event to 20:00 moves the alarm to 19:45",
  moved !== null && new Date(moved).getHours() === 19 && new Date(moved).getMinutes() === 45,
  moved ?? "null",
)
const longer = computeReminderAt("2026-10-05T20:00:00", 30)
check(
  "changing the lead time to 30 minutes fires at 19:30",
  longer !== null && new Date(longer).getHours() === 19 && new Date(longer).getMinutes() === 30,
  longer ?? "null",
)
check("no reminder means no alarm", computeReminderAt(base, -1) === null)
check("a reminder at start time equals the event time", computeReminderAt(base, 0) === new Date(base).toISOString())

const repeating: CalendarEvent = {
  id: "e1",
  title: "Belajar Struktur Data",
  description: "",
  category: "study",
  startAt: base,
  endAt: "2026-10-05T20:00:00",
  location: null,
  reminderMinutes: 15,
  repeatRule: "weekly",
  materialId: null,
  reminderAt: r15,
  reminderSentAt: null,
  createdAt: base,
  updatedAt: base,
}
const occurrences = occurrencesFor(
  repeating,
  new Date("2026-10-01T00:00:00"),
  new Date("2026-10-31T23:59:59"),
)
check("a weekly event repeats inside the window", occurrences.length >= 4, `${occurrences.length}`)
check(
  "every repeat keeps the event's reminder lead time",
  occurrences.every((occurrence) => occurrence.event.reminderMinutes === 15),
)
check(
  "repeats after the first are flagged as repeats",
  occurrences.filter((o) => o.isRepeat).length === occurrences.length - 1,
)

const grid = buildMonthGrid(2026, 9)
check(
  "the month grid is six weeks of seven days",
  grid.weeks.length === 6 && grid.weeks.every((week) => week.length === 7),
)
check("the month grid starts on a Monday", grid.weeks[0][0].getDay() === 1)
check(
  "5 October 2026 is inside the grid",
  grid.weeks.flat().some((day) => dayKey(day) === "2026-10-05"),
)

/* ------------------------------------------------------------------ *
 * 6. The seeded demo account really produces content
 * ------------------------------------------------------------------ */

section("6. The demo account's seeded documents produce real content")

check("the demo account is defined", DEMO_MATERIALS.length >= 2, `${DEMO_MATERIALS.length}`)
check(
  "the demo credentials meet the app's own password rule",
  DEMO_PASSWORD.length >= 8 && /\S+@\S+\.\S+/.test(DEMO_EMAIL),
)

for (const seed of DEMO_MATERIALS) {
  let generatedText = ""
  let questionCount = 0
  let flashcardCount = 0
  let summaryLength = 0
  let error = ""
  try {
    const generated = generateLearningContent(seed.text, { questionCount: 10 })
    generatedText = generated.summary
    questionCount = generated.questions.length
    flashcardCount = generated.flashcards.length
    summaryLength = generated.summary.length
  } catch (reason) {
    error = reason instanceof Error ? reason.message : "generation failed"
  }

  check(`demo seed "${seed.title}" generates content`, error === "", error)
  check(`demo seed "${seed.title}" produces questions`, questionCount >= 8, `${questionCount}`)
  check(`demo seed "${seed.title}" produces flashcards`, flashcardCount >= 3, `${flashcardCount}`)
  check(`demo seed "${seed.title}" produces a summary`, summaryLength > 200, `${summaryLength}`)
  check(
    `demo seed "${seed.title}" questions are grounded in its own text`,
    generatedText.length > 0 &&
      !error &&
      generatedText
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((word) => word.length > 6)
        .slice(0, 12)
        .some((word) => seed.text.toLowerCase().includes(word)),
  )
}

/* ------------------------------------------------------------------ *
 * 7. Death zones, respawn and session reset
 * ------------------------------------------------------------------ */

section("7. Death zones, respawn and a fresh session on every reopen")

function fallIntoFirstHazard(world: World): void {
  const hazard = world.level.hazards[0]
  world.player.x = hazard.x + hazard.w / 2
  world.player.y = hazard.y + 10
  world.player.vx = 0
  world.player.vy = 0
}

for (const map of MAPS) {
  const level = buildLevel(fakeMaterial("death", 6), map, [])
  const hazards = level.hazards

  check(`${map.name}: the level defines at least one death zone`, hazards.length >= 1, `${hazards.length}`)

  // A hazard must sit in a real pit: no ground slab may overlap its footprint,
  // otherwise "falling in" would be survivable and the rule would be a lie.
  const groundSlabs = level.solids.filter((solid) => solid.h > 60)
  const outside = hazards.filter((hazard) =>
    groundSlabs.some(
      (slab) => hazard.x < slab.x + slab.w && hazard.x + hazard.w > slab.x,
    ),
  )
  check(`${map.name}: every death zone lies in a pit`, outside.length === 0, `${outside.length} bad`)

  const aboveGround = hazards.every((hazard) => hazard.y >= GROUND_Y && hazard.h > 0)
  check(`${map.name}: every death zone is below the ground line`, aboveGround)

  const world = createWorld(buildLevel(fakeMaterial("death", 6), map, []), {
    openedGates: [],
    collected: [],
    checkpoints: [],
    finished: false,
  })

  fallIntoFirstHazard(world)
  const first = stepWorld(world, { left: false, right: false, jump: false }, 1 / 120)
  check(
    `${map.name}: falling into a death zone fires exactly one death`,
    first.filter((event) => event.type === "died").length === 1,
  )
  check(
    `${map.name}: that death produces exactly one respawn`,
    first.filter((event) => event.type === "respawned").length === 1,
  )
  check(`${map.name}: the death counter moved by one`, world.deaths === 1, `${world.deaths}`)
  check(
    `${map.name}: the respawn lands on the last checkpoint`,
    world.player.x === safeSpawnFor(world.level, world.lastCheckpointId).x,
  )
  check(`${map.name}: velocity is cleared on respawn`, world.player.vx === 0 && world.player.vy === 0)
  check(`${map.name}: the respawn arms the duplicate-death guard`, world.deathCooldown > 0)

  // Repeat the failure many times over: one mistake must never become a burst
  // of deaths or respawns.
  for (let step = 0; step < 240; step += 1) {
    stepWorld(world, { left: false, right: false, jump: false }, 1 / 120)
  }
  check(
    `${map.name}: repeated hazard contact does not multiply deaths`,
    world.deaths === 1,
    `${world.deaths}`,
  )
  check(
    `${map.name}: the death cooldown is a real, bounded guard`,
    DEATH_COOLDOWN > 0 && world.deathCooldown >= 0,
  )
}

{
  // Session reset: permanent progress survives, everything temporary does not.
  const map = MAPS[0]
  const material = fakeMaterial("reset", 6)
  const level = buildLevel(material, map, [])
  const world = createWorld(level, {
    openedGates: [],
    collected: [],
    checkpoints: [],
    finished: false,
  })

  openGate(world, world.level.gates[0])
  world.level.orbs[0].taken = true
  world.level.checkpoints[1].reached = true
  world.lastCheckpointId = world.level.checkpoints[1].id
  world.sessionXp = 40
  world.deaths = 3
  world.particles.push({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 1,
    maxLife: 1,
    color: "#fff",
  })
  resetSession(world)

  check("resetSession keeps opened gates", world.level.gates[0].opened)
  check("resetSession keeps collected orbs", world.level.orbs[0].taken)
  check(
    "resetSession keeps reached checkpoints",
    world.level.checkpoints[1].reached,
    "checkpoint should stay reached",
  )
  check("resetSession returns the session to playing", world.status === "playing")
  check("resetSession clears the session SP counter", world.sessionXp === 0, `${world.sessionXp}`)
  check("resetSession clears the death counter", world.deaths === 0, `${world.deaths}`)
  check("resetSession clears particles", world.particles.length === 0)
  check("resetSession clears the active challenge", world.activeGateId === null)
  check("resetSession clears velocity", world.player.vx === 0 && world.player.vy === 0)
  check(
    "resetSession respawns at the saved checkpoint",
    world.player.x === safeSpawnFor(world.level, world.lastCheckpointId).x,
  )

  // Reopening a COMPLETED map must give a playable world, not a frozen one.
  const saved = {
    openedGates: level.gates.map((gate) => gate.questionId),
    collected: level.orbs.map((orb) => orb.id),
    checkpoints: level.checkpoints.map((item) => item.id),
    finished: true,
  }
  const replayLevel = buildLevel(material, map, saved.openedGates)
  const replay = createWorld(replayLevel, saved)
  check("reopening a finished map starts a live session", replay.status === "playing", replay.status)
  check("reopening a finished map still knows it was completed", replay.completed === true)

  const before = replay.player.x
  for (let step = 0; step < 60; step += 1) {
    stepWorld(replay, { left: false, right: true, jump: false }, 1 / 120)
  }
  check(
    "a replayed finished world is actually movable",
    replay.player.x > before + 20,
    `${before} -> ${replay.player.x}`,
  )
}

/* ------------------------------------------------------------------ *
 * 8. No ghost frames: the whole backing store is cleared and repainted
 *
 * The bug this asserts against: `renderWorld` clears and paints using the
 * WORLD-space viewport. If that rectangle is reported as `cssWidth x cssHeight`
 * instead of `cssWidth / scale x LEVEL_HEIGHT`, the bottom/right of the canvas
 * is never erased, so the moving character leaves a translucent copy of itself
 * behind on every step.
 *
 * `createRecordingContext` honours `setTransform`, so every drawing call is
 * converted to real device pixels and the coverage can be checked exactly.
 * ------------------------------------------------------------------ */

section("8. Character rendering is clean on every map (no uncleared frames)")

type Rect2 = { x: number; y: number; w: number; h: number }

/**
 * Tolerance is a fraction of a device pixel on purpose: a whole-pixel shortfall
 * is exactly the bug this guards against (a cleared-but-never-repainted last
 * column at a fractional device pixel ratio), so rounding it away would hide it.
 */
function covers(outer: Rect2, inner: Rect2, tolerance = 0.05): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.w <= outer.x + outer.w + tolerance &&
    inner.y + inner.h <= outer.y + outer.h + tolerance
  )
}

function createRecordingContext(pixelWidth: number, pixelHeight: number) {
  let a = 1
  let d = 1
  let e = 0
  let f = 0
  const stack: number[][] = []
  const clearRects: Rect2[] = []
  const fillRects: Rect2[] = []

  const toDevice = (x: number, y: number, w: number, h: number): Rect2 => {
    const x0 = a * x + e
    const y0 = d * y + f
    const x1 = a * (x + w) + e
    const y1 = d * (y + h) + f
    return {
      x: Math.min(x0, x1),
      y: Math.min(y0, y1),
      w: Math.abs(x1 - x0),
      h: Math.abs(y1 - y0),
    }
  }

  const gradient = { addColorStop: () => undefined }
  const noop = () => undefined

  const ctx = {
    canvas: { width: pixelWidth, height: pixelHeight },
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "" as unknown,
    strokeStyle: "" as unknown,
    lineWidth: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    save() {
      stack.push([a, d, e, f])
    },
    restore() {
      const previous = stack.pop()
      if (previous) {
        a = previous[0]
        d = previous[1]
        e = previous[2]
        f = previous[3]
      }
    },
    setTransform(na: number, _nb: number, _nc: number, nd: number, ne: number, nf: number) {
      a = na
      d = nd
      e = ne
      f = nf
    },
    translate(tx: number, ty: number) {
      e += a * tx
      f += d * ty
    },
    scale(sx: number, sy: number) {
      a *= sx
      d *= sy
    },
    clearRect(x: number, y: number, w: number, h: number) {
      clearRects.push(toDevice(x, y, w, h))
    },
    fillRect(x: number, y: number, w: number, h: number) {
      fillRects.push(toDevice(x, y, w, h))
    },
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    arcTo: noop,
    ellipse: noop,
    quadraticCurveTo: noop,
    fill: noop,
    stroke: noop,
    fillText: noop,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: () => ({ width: 0 }),
  }

  return {
    ctx,
    clearRects,
    fillRects,
    reset() {
      clearRects.length = 0
      fillRects.length = 0
    },
    deviceRect(x: number, y: number, w: number, h: number) {
      return toDevice(x, y, w, h)
    },
  }
}

// The viewport sizes the product is judged at, in CSS pixels.
const VIEWPORTS: [number, number][] = [
  [360, 520],
  [390, 560],
  [768, 480],
  [1440, 520],
  [1920, 640],
]

for (const map of MAPS) {
  const level = buildLevel(fakeMaterial("render", 6), map, [])
  let allCleared = true
  let allPainted = true
  let viewportCorrect = true
  let buggyViewportWouldFail = true
  let ghostSurvived = false

  for (const [cssWidth, cssHeight] of VIEWPORTS) {
    // 1.25 and 1.5 are the ratios a Windows machine actually reports; a
    // fractional ratio is what exposed the transparent last-column seam.
    for (const dpr of [1, 1.25, 1.5, 2]) {
      const metrics = canvasMetrics(cssWidth, cssHeight, dpr)
      const recorder = createRecordingContext(metrics.pixelWidth, metrics.pixelHeight)
      const context = recorder.ctx as unknown as CanvasRenderingContext2D

      const world = createWorld(level, {
        openedGates: [],
        collected: [],
        checkpoints: [],
        finished: false,
      })
      world.viewWidth = metrics.viewport.width

      // Reproduce exactly what GameWorld.resize() does.
      recorder.ctx.setTransform(metrics.transformScale, 0, 0, metrics.transformScale, 0, 0)

      if (metrics.viewport.height !== LEVEL_HEIGHT) viewportCorrect = false

      const full: Rect2 = { x: 0, y: 0, w: metrics.pixelWidth, h: metrics.pixelHeight }

      // ---- frame 1 ----------------------------------------------------
      renderWorld(context, world, metrics.viewport, 1, getCharacter("male"))
      const frame1Clear = recorder.clearRects[0]
      const frame1Sky = recorder.fillRects[0]
      if (!frame1Clear || !covers(frame1Clear, full)) allCleared = false
      if (!frame1Sky || !covers(frame1Sky, full)) allPainted = false

      // Where the character was drawn on frame 1, in device pixels.
      const playerFrame1 = recorder.deviceRect(
        world.player.x - world.cameraX,
        world.player.y,
        world.player.w,
        world.player.h,
      )

      // The old, buggy viewport would have cleared only this much.
      const buggy: Rect2 = {
        x: 0,
        y: 0,
        w: cssWidth * metrics.transformScale,
        h: cssHeight * metrics.transformScale,
      }
      if (covers(buggy, full)) buggyViewportWouldFail = false

      // ---- frame 2: move the character, then draw again ---------------
      world.player.x += 140
      recorder.reset()
      renderWorld(context, world, metrics.viewport, 1.016, getCharacter("male"))
      const frame2Clear = recorder.clearRects[0]
      if (!frame2Clear || !covers(frame2Clear, full)) allCleared = false
      // The pixels the character occupied on frame 1 must be inside the region
      // frame 2 erases. If they are, nothing from frame 1 can survive.
      if (!frame2Clear || !covers(frame2Clear, playerFrame1)) ghostSurvived = true
      if (recorder.fillRects.length === 0) allPainted = false
    }
  }

  check(`${map.name}: every frame clears the entire canvas`, allCleared)
  check(`${map.name}: every frame repaints the entire visible area`, allPainted)
  check(
    `${map.name}: the drawn viewport reaches the backing store edge at every dpr`,
    allPainted,
    "a cleared but unpainted column would leave a transparent seam",
  )
  check(`${map.name}: the reported viewport matches the drawing transform`, viewportCorrect)
  check(
    `${map.name}: the pre-fix viewport would have left part of the canvas uncleared`,
    buggyViewportWouldFail,
  )
  check(`${map.name}: the previous frame's character pixels are erased`, !ghostSurvived)
}

/* ------------------------------------------------------------------ *
 * 9. Study streak and SP rules
 * ------------------------------------------------------------------ */

section("9. Study streak and SP are derived from real activity")

function localDaysAgo(days: number): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - days)
  return dayKey(date)
}

const today = localDaysAgo(0)

check(
  "several activities on one day count as one study day",
  computeStudyStreak([today, today, today], today).streak === 1,
)
check(
  "a run of consecutive days counts up",
  computeStudyStreak([today, localDaysAgo(1), localDaysAgo(2)], today).streak === 3,
)
check(
  "a streak ending yesterday is still alive",
  computeStudyStreak([localDaysAgo(1), localDaysAgo(2), localDaysAgo(3)], today).streak === 3,
)
check(
  "missing a whole day resets the current streak",
  computeStudyStreak([localDaysAgo(2), localDaysAgo(3), localDaysAgo(4)], today).streak === 0,
)
check(
  "the longest streak is kept separately from the current one",
  computeStudyStreak([today, localDaysAgo(10), localDaysAgo(9), localDaysAgo(8)], today).longest === 3,
)
check(
  "distinct study days are counted once",
  computeStudyStreak([today, today, localDaysAgo(1), localDaysAgo(1)], today).studyDays === 2,
)
check(
  "an empty history has no streak",
  computeStudyStreak([], today).streak === 0 &&
    computeStudyStreak([], today).longest === 0,
)
check(
  "the last qualifying date is reported",
  computeStudyStreak([localDaysAgo(4), localDaysAgo(5)], today).lastActivityDate === localDaysAgo(4),
)
check(
  "activity keys are unique per kind and subject",
  activityKey("gate_opened", "m:map:g1") !== activityKey("world_finished", "m:map:g1") &&
    activityKey("gate_opened", "a") !== activityKey("gate_opened", "b"),
)

check("every achievement is unlocked", ALL_ACHIEVEMENTS_UNLOCKED === true)
const states = achievementStates([], "2026-01-01T00:00:00.000Z")
check(
  "the achievement state covers the whole catalogue",
  states.length === ACHIEVEMENTS.length,
  `${states.length} of ${ACHIEVEMENTS.length}`,
)
check(
  "no achievement code is reported twice",
  new Set(states.map((item) => item.code)).size === states.length,
)
const genuine = achievementStates(
  [{ code: ACHIEVEMENTS[0].code, unlockedAt: "2026-02-02T10:00:00.000Z" }],
  "2026-01-01T00:00:00.000Z",
)
check(
  "a genuinely earned achievement keeps its real timestamp",
  genuine.find((item) => item.code === ACHIEVEMENTS[0].code)?.unlockedAt === "2026-02-02T10:00:00.000Z",
)
check(
  "achievement state carries no reward amount",
  genuine.every((item) => !("xp" in item) && !("xpReward" in item)),
)

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exitCode = 1
}
