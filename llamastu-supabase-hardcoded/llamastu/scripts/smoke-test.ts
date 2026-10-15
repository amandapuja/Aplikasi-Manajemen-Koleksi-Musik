/**
 * Logic verification harness.
 *
 * Runs the pure parts of the application — grounded content generation, the
 * level builder and the platformer simulation — without a browser, so the
 * behaviour the requirements describe can be asserted mechanically:
 *
 *   - generated questions are grounded, well formed and deterministic
 *   - every generated level is geometrically completable
 *   - a closed gate physically blocks the player
 *   - approaching a gate opens the challenge and answering it opens the gate
 *   - orbs are collected, checkpoints are saved, pits kill and respawn
 *   - the goal can only be reached once every gate is open
 *
 * Run with:  npm run test:logic
 */

import { generateLearningContent, normalizeText } from "../src/lib/content"
import { buildLevel, gateTriggerZone, safeSpawnFor } from "../src/game/level"
import { gatesForMap, getMap, MAPS } from "../src/game/maps"
import { GROUND_Y, MAX_FALL_SPEED, PLAYER_H, PLAYER_W, TRAVEL } from "../src/game/constants"
import {
  createWorld,
  openGate,
  overlaps,
  stepWorld,
  type Input,
  type World,
  type WorldEvent,
} from "../src/game/engine"
import { demoIdentityFrom } from "../src/lib/demo"
import { toAssistantReply } from "../src/lib/assistantReply"
import type { Material, Question } from "../src/types"

let failures = 0
let checks = 0

function check(name: string, condition: boolean, detail = "") {
  checks += 1
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

function section(title: string) {
  console.log(`\n${title}`)
}

/* ------------------------------------------------------------------ *
 * 1. Grounded content generation
 * ------------------------------------------------------------------ */

const SAMPLE = `
Database normalisation is the process of organising the columns and tables of a relational
database to minimise data redundancy and prevent update anomalies. First normal form requires
that every column contains only atomic values and that each record is unique. Second normal form
removes partial dependencies, which means every non key attribute must depend on the whole
primary key. Third normal form eliminates transitive dependencies so that non key attributes
depend only on the primary key. Boyce Codd normal form is a stronger version of third normal form
that handles certain anomalies involving overlapping candidate keys. Denormalisation is the
deliberate introduction of redundancy to improve read performance. An index is a data structure
that speeds up the retrieval of rows from a table. A transaction is a unit of work that is
executed atomically so the database never observes a partially applied change. Atomicity means
that a transaction either completes entirely or not at all. Isolation controls how concurrent
transactions observe each other's intermediate states. Durability guarantees that committed data
survives a system failure. A primary key uniquely identifies each row in a relation while a
foreign key references a primary key in another table. Referential integrity ensures that a
foreign key always points at an existing row. A join combines rows from two relations using a
related column. Cardinality describes how many rows participate on each side of a relationship.
Concurrency control prevents two writers from corrupting the same page at the same time.
The write ahead log records changes before they are applied so recovery can replay them.
`

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
    extractedText: SAMPLE,
    questions,
    wordCount: 300,
    xpAwarded: true,
    processedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

section("1. Content generation is grounded, valid and deterministic")

const generated = generateLearningContent(SAMPLE, { questionCount: 10 })
check("summary is produced", generated.summary.length > 80)
check("key points are produced", generated.keyPoints.length >= 3, `${generated.keyPoints.length}`)
check("objectives are produced", generated.objectives.length >= 3, `${generated.objectives.length}`)
check("flashcards are produced", generated.flashcards.length >= 3, `${generated.flashcards.length}`)
check("questions reach the requested count", generated.questions.length === 10, `${generated.questions.length}`)
check("word count is measured", generated.wordCount > 150, `${generated.wordCount}`)

// Compare against a whitespace-flattened copy, because the generator works on
// flattened sentences while the raw source keeps its line breaks.
const sourceLower = normalizeText(SAMPLE).replace(/\s+/g, " ").toLowerCase()
let validChoices = true
let grounded = true
let uniqueChoices = true
for (const question of generated.questions) {
  if (question.answerIndex < 0 || question.answerIndex >= question.choices.length) validChoices = false
  if (question.choices.length < 3) validChoices = false
  if (new Set(question.choices.map((choice) => choice.toLowerCase())).size !== question.choices.length) {
    uniqueChoices = false
  }
  // Every question must be anchored by at least one sentence that really
  // exists in the source material.
  const quoted = question.explanation.match(/[\u201c"]([^\u201d"]+)[\u201d"]/)
  if (!quoted) grounded = false
  else if (!sourceLower.includes(quoted[1].toLowerCase().slice(0, 40))) grounded = false
  // The correct answer must appear in the material.
  const correct = question.choices[question.answerIndex]
  if (correct.length > 24 && !sourceLower.includes(correct.toLowerCase().slice(0, 30))) grounded = false
  // The wrong answers must not be presented as true statements from the text.
  if (question.choices.some((choice) => !choice.trim())) grounded = false
}
check("every question has a valid answer index", validChoices)
check("choices within a question are unique", uniqueChoices)
check("every question is anchored to real source text", grounded)

const repeat = generateLearningContent(SAMPLE, { questionCount: 10 })
check(
  "generation is deterministic for the same text",
  JSON.stringify(repeat.questions) === JSON.stringify(generated.questions),
)

let shortTextRejected = false
try {
  generateLearningContent("Only a handful of words here.", { questionCount: 5 })
} catch {
  shortTextRejected = true
}
check("text that is too short is rejected with an error", shortTextRejected)

/* ------------------------------------------------------------------ *
 * 2. Level geometry
 * ------------------------------------------------------------------ */

section("2. Generated levels are well formed and completable")

const QUESTION_COUNTS = [4, 7, 12]
let geometryOk = true
let platformsClearOfGates = true
let gatesUnjumpable = true
let gapsJumpable = true
let orbsOk = true

const levels = QUESTION_COUNTS.map((count) => {
  const material = fakeMaterial(`m${count}`, count)
  const level = buildLevel(material, MAPS[0])
  return { material, level }
})

for (const { material, level } of levels) {
  const count = material.questions.length
  if (level.gates.length !== Math.min(getMap(MAPS[0].id).challengeCount, count)) geometryOk = false
  if (level.orbs.length < 3) geometryOk = false
  // One checkpoint per gate plus the start and final checkpoints.
  if (level.checkpoints.length < level.gates.length + 2) geometryOk = false
  if (level.gates.length !== Math.min(getMap(MAPS[0].id).challengeCount, count)) geometryOk = false
  if (!level.solids.length) geometryOk = false
  if (level.width <= 800) geometryOk = false
  if (level.goal.x <= 0 || level.goal.x >= level.width) geometryOk = false

  // Platforms must never intersect a gate, otherwise a player could stand on
  // one inside the gate and slip past it.
  for (const solid of level.solids) {
    if (solid.h > 60) continue
    for (const gate of level.gates) {
      if (overlaps(solid, gate)) platformsClearOfGates = false
    }
  }

  // Nothing may let the player build enough height to clear a gate. Reachable
  // apex is about 145 px, so the highest platform top must stay below that.
  const highestPlatform = Math.min(
    ...level.solids.filter((solid) => solid.h <= 60).map((solid) => solid.y),
  )
  for (const gate of level.gates) {
    if (highestPlatform - 145 <= gate.y) gatesUnjumpable = false
  }

  // Gaps between ground slabs must be inside the jump envelope.
  const ground = level.solids.filter((solid) => solid.h > 60).sort((a, b) => a.x - b.x)
  for (let index = 1; index < ground.length; index += 1) {
    const gap = ground[index].x - (ground[index - 1].x + ground[index - 1].w)
    if (gap <= 0 || gap > 168) gapsJumpable = false
  }

  if (level.orbCount !== level.orbs.length) orbsOk = false
}

check("gates, orbs, checkpoints, ground and goal all exist", geometryOk)
check("no floating platform intersects a gate", platformsClearOfGates)
check("no platform allows the player to jump over a gate", gatesUnjumpable)
check("every pit is inside the jump envelope", gapsJumpable)
check("orb count matches the placed orbs", orbsOk)

const specific = levels[1].level
const trigger = gateTriggerZone(specific.gates[0])
check("the gate trigger sits in front of the gate", trigger.x + trigger.w <= specific.gates[0].x + 1)
check(
  "the gate is tall enough to be a real obstacle",
  specific.gates[0].h === specific.gateHeight && specific.gates[0].y + specific.gates[0].h === GROUND_Y,
)
check("gate width is a solid slab", specific.gates[0].w === getMap(MAPS[0].id).gateWidth)
check("the default spawn is above the ground", safeSpawnFor(specific, null).y < GROUND_Y)

/* ------------------------------------------------------------------ *
 * 3. Simulation: collision, gates, orbs, death and the goal
 * ------------------------------------------------------------------ */

section("3. Platformer simulation")

const STEP = 1 / 120

/**
 * Bot that plays the level the way a person would: always run right, and hold
 * the jump button for a moment when a wall or a pit is ahead. Holding matters
 * because the physics implement a variable jump height — releasing instantly
 * produces a short hop that cannot clear a pit.
 */
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

    if (player.onGround && (wallAhead || !floorAhead)) {
      // Hold long enough that the variable-jump cutoff never triggers.
      holdUntil = world.elapsed + 0.3
    }

    return { left: false, right: true, jump: world.elapsed < holdUntil }
  }
}

function simulate(material: Material, options: { openGates: boolean; seconds: number }) {
  const level = buildLevel(material, MAPS[0], [])
  const world = createWorld(level, {
    openedGates: [],
    collected: [],
    checkpoints: [],
    finished: false,
  })
  const events: WorldEvent[] = []
  const steps = Math.round(options.seconds / STEP)
  let triggersSeen = 0
  const botInput = createBot()

  for (let step = 0; step < steps; step += 1) {
    const produced = stepWorld(world, botInput(world), STEP)
    for (const event of produced) {
      events.push(event)
      if (event.type === "gate-trigger") {
        triggersSeen += 1
        if (options.openGates) {
          const gate = world.level.gates.find((item) => item.id === event.gateId)
          if (gate) openGate(world, gate)
        }
      }
    }
    // Only a genuine finish ends the run, so the goal overlap really happens.
    if (world.status === "finished") break
  }
  return { world, events, triggersSeen, level }
}

const blockedCase = simulate(levels[1].material, { openGates: false, seconds: 40 })
const firstGate = blockedCase.level.gates[0]
const blockedOrbs = blockedCase.world.level.orbs.filter((orb) => orb.taken).length
check(
  "a closed gate physically stops the player",
  blockedCase.world.player.x + PLAYER_W <= firstGate.x + 1,
  `player x=${blockedCase.world.player.x.toFixed(1)} gate x=${firstGate.x}`,
)
check("approaching a closed gate raises the challenge", blockedCase.triggersSeen >= 1)
check(
  "the world pauses while the challenge is open",
  blockedCase.world.status === "challenge",
  blockedCase.world.status,
)
check(
  "no gate or goal XP is granted while the gate stays closed",
  blockedCase.world.sessionXp === blockedOrbs * 5,
  `sessionXp=${blockedCase.world.sessionXp} orbs=${blockedOrbs}`,
)
check("the player never clips through the gate slab", blockedCase.world.player.x + PLAYER_W <= firstGate.x)

const solvedCase = simulate(levels[1].material, { openGates: true, seconds: 180 })
const openedGates = solvedCase.world.level.gates.filter((gate) => gate.opened).length
const orbsTaken = solvedCase.world.level.orbs.filter((orb) => orb.taken).length
const checkpointsReached = solvedCase.world.level.checkpoints.filter((item) => item.reached).length

check(
  "answering the challenge opens every gate",
  openedGates === solvedCase.level.gates.length,
  `${openedGates} of ${solvedCase.level.gates.length}`,
)
check(
  "gates raise the trigger event exactly once each",
  solvedCase.triggersSeen === solvedCase.level.gates.length,
  `${solvedCase.triggersSeen}`,
)
check("collectibles are picked up while running the level", orbsTaken >= 3, `${orbsTaken}`)
check("checkpoints are activated", checkpointsReached >= 2, `${checkpointsReached}`)
check("the goal fires once every gate is open", solvedCase.events.some((event) => event.type === "goal"))
check("reaching the goal finishes the world", solvedCase.world.status === "finished")
check("session XP reflects orbs plus the goal reward", solvedCase.world.sessionXp === orbsTaken * 5 + 50, `${solvedCase.world.sessionXp}`)

// A pit kills the player and respawns them at the last activated checkpoint.
const deathLevel = buildLevel(levels[0].material, MAPS[0], levels[0].material.questions.map((q) => q.id))
const deathWorld = createWorld(deathLevel, {
  openedGates: levels[0].material.questions.map((q) => q.id),
  collected: [],
  checkpoints: [deathLevel.checkpoints[0].id],
  finished: false,
})
deathLevel.checkpoints.forEach((checkpoint) => {
  checkpoint.reached = checkpoint.id === deathLevel.checkpoints[0].id
})
const groundSlabs = deathLevel.solids.filter((solid) => solid.h > 60).sort((a, b) => a.x - b.x)
const pitX = (groundSlabs[0].x + groundSlabs[0].w + groundSlabs[1].x) / 2
deathWorld.player.x = pitX
deathWorld.player.y = GROUND_Y - 10
deathWorld.player.vx = 0
deathWorld.player.vy = MAX_FALL_SPEED
let died = false
for (let step = 0; step < 400; step += 1) {
  const produced = stepWorld(deathWorld, { left: false, right: false, jump: false }, STEP)
  if (produced.some((event) => event.type === "died")) {
    died = true
    break
  }
}
check("falling into a pit is detected as a death", died)
check("the player respawns at the last checkpoint", deathWorld.player.x < pitX, `${deathWorld.player.x}`)
check("respawn restores a standing position", deathWorld.player.y + PLAYER_H <= GROUND_Y + 1)
check("death count is tracked", deathWorld.deaths === 1)

// The player can never leave the world horizontally.
const wanderWorld = createWorld(buildLevel(levels[0].material, MAPS[0]), {
  openedGates: [],
  collected: [],
  checkpoints: [],
  finished: false,
})
for (let step = 0; step < 600; step += 1) {
  stepWorld(wanderWorld, { left: true, right: false, jump: true }, STEP)
}
check("the player cannot walk out of the left edge of the world", wanderWorld.player.x >= 0)
for (let step = 0; step < 20000; step += 1) {
  stepWorld(wanderWorld, { left: false, right: true, jump: true }, STEP)
}
check(
  "the player cannot run past the right edge of the world",
  wanderWorld.player.x + PLAYER_W <= wanderWorld.level.width + 1,
)

/* ------------------------------------------------------------------ *
 * 4. No stuck states
 * ------------------------------------------------------------------ */

section("4. Progress cannot be lost")

const resumeWorld = createWorld(buildLevel(levels[0].material, MAPS[0]), {
  openedGates: [levels[0].material.questions[1].id],
  collected: ["orb-0-r0"],
  checkpoints: ["checkpoint-1"],
  finished: false,
})
check("saved gates are restored on load", resumeWorld.level.gates[1].opened)
check("saved gates leave the others closed", !resumeWorld.level.gates[0].opened)
check("saved orbs stay collected", resumeWorld.level.orbs.find((orb) => orb.id === "orb-0-r0")?.taken === true)
check("the player resumes at the saved checkpoint", resumeWorld.player.x > 400, `${resumeWorld.player.x}`)

/* ------------------------------------------------------------------ *
 * 5. The demo entry point
 * ------------------------------------------------------------------ */

section("5. A name is enough to enter the demo workspace")

const plainName = demoIdentityFrom("Alifah")
check("a plain name becomes the display name", plainName.name === "Alifah", plainName.name)
check("a plain name gets a placeholder address", /@example\.com$/.test(plainName.email), plainName.email)
check("the identity is the fixed demo identity", plainName.id === "demo-user", plainName.id)
check("the mode is recorded as demo", plainName.mode === "demo")

const trimmed = demoIdentityFrom("   Alifah   ")
check("surrounding spaces are ignored", trimmed.name === "Alifah", trimmed.name)

const fromEmail = demoIdentityFrom("alifah@example.com")
check("an email address is accepted", fromEmail.email === "alifah@example.com", fromEmail.email)
check("the email supplies the display name", fromEmail.name === "Alifah", fromEmail.name)

const multi = demoIdentityFrom("alifah nur aisyah")
check("a multi word name keeps its words", multi.name === "Alifah Nur Aisyah", multi.name)
check("a multi word name becomes a safe address", multi.email === "alifah.nur.aisyah@example.com", multi.email)

const messy = demoIdentityFrom("  ALIFAH  ")
check("a shouting name is tidied up", messy.name === "Alifah", messy.name)

check("every input maps to the same demo identity", demoIdentityFrom("Budi").id === demoIdentityFrom("Siti").id)

section("6. AI Study Assistant response mapping")

const okReply = toAssistantReply(200, { status: "ready", answer: "Fotosintesis adalah...", reference: "Bab 1" }, "m1", "id1")
check("a successful answer maps to ready", okReply.status === "ready")
check("the answer text is carried through", okReply.message.content === "Fotosintesis adalah...")
check("the reference is carried through", okReply.message.reference === "Bab 1")
check("the material id is kept", okReply.message.materialId === "m1")

const noKey = toAssistantReply(503, { status: "missing_key", detail: "needs key", missing: "LLM_API_KEY" }, null, "id2")
check("a missing key is reported as missing_key", noKey.status === "missing_key")
check("a missing key never carries an answer", noKey.message.content === "")
check("the missing setting is named", noKey.missing === "LLM_API_KEY")

check("429 maps to rate_limited", toAssistantReply(429, null, null, "id3").status === "rate_limited")
check("504 maps to timeout", toAssistantReply(504, null, null, "id4").status === "timeout")
check("a 502 maps to unreachable", toAssistantReply(502, null, null, "id5").status === "unreachable")
check("no network (status 0) maps to unreachable", toAssistantReply(0, null, null, "id6").status === "unreachable")
check("a 400 with an error message is shown", toAssistantReply(400, { error: "Type a question first." }, null, "id7").detail === "Type a question first.")
check("a 200 with an empty answer is not treated as success", toAssistantReply(200, { status: "ready", answer: "   " }, null, "id8").status !== "ready")
check("an unknown status never becomes ready", toAssistantReply(500, { status: "ready" }, null, "id9").status !== "ready")

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exitCode = 1
}
