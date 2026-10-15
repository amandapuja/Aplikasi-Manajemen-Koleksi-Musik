import type { Material, Question } from "../types"
import { hashString } from "../lib/content"
import {
  CEILING_THICKNESS,
  CHECKPOINT_HEIGHT,
  CHECKPOINT_WIDTH,
  GATE_TRIGGER_WIDTH,
  GROUND_Y,
  LEVEL_HEIGHT,
  ORB_RADIUS,
  PLATFORM_THICKNESS,
  PLAYER_H,
  TILE,
  TRAVEL,
  WALK_ORB_HEIGHT,
  WORLD_PADDING,
} from "./constants"
import { gatesForMap, type MapDefinition } from "./maps"

export type Rect = { x: number; y: number; w: number; h: number }

export type Gate = Rect & {
  id: string
  questionId: string
  index: number
  opened: boolean
}

export type Mover = Rect & {
  id: string
  axis: "x" | "y"
  range: number
  speed: number
  phase: number
  originX: number
  originY: number
  prevX: number
  prevY: number
}

export type Orb = { id: string; x: number; y: number; taken: boolean }
export type Checkpoint = Rect & { id: string; reached: boolean }

export type Level = {
  materialId: string
  mapId: string
  map: MapDefinition
  width: number
  height: number
  groundY: number
  deathY: number
  gravityScale: number
  /** Highest feet-rise the player can achieve anywhere in this level. */
  maxRise: number
  gateHeight: number
  solids: Rect[]
  /**
   * Overhead slabs. They are solid for collision but are NOT standable
   * platforms: the player can never reach their top, so they must be excluded
   * from any "highest platform" analysis (which is what keeps the
   * cannot-jump-over-a-gate guarantee honest).
   */
  ceilings: Rect[]
  /**
   * Explicit death zones — one per pit, spanning the gap from just under the
   * ground line down past the world floor. Making the kill zones explicit means
   * "fall in a pit, respawn at the checkpoint" is a defined rule with a testable
   * rectangle on every map, instead of an accident of how tall the world is.
   */
  hazards: Rect[]
  gates: Gate[]
  orbs: Orb[]
  checkpoints: Checkpoint[]
  movers: Mover[]
  goal: Rect
  spawn: { x: number; y: number }
  orbCount: number
}

type Random = () => number

function createRandom(seed: number): Random {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildLevel(
  material: Material,
  map: MapDefinition,
  openedGateIds: string[] = [],
): Level {
  const questions: Question[] = (material.questions ?? []).slice(
    0,
    gatesForMap(map, (material.questions ?? []).length),
  )
  const random = createRandom(hashString(`${material.id}|${map.id}`))
  const solids: Rect[] = []
  const ceilings: Rect[] = []
  const movers: Mover[] = []
  const gates: Gate[] = []
  const orbs: Orb[] = []
  const checkpoints: Checkpoint[] = []
  const hazards: Rect[] = []
  const opened = new Set(openedGateIds)

  /* ---- physics budget for this map ------------------------------------ */
  const apex = TRAVEL.apex / map.gravityScale
  const airDistance = TRAVEL.jumpDistance / map.gravityScale
  // The lab deliberately caps how high the player may rise, which is what
  // makes its corridors feel low and its doors feel heavy.
  const maxRise = map.mechanic === "low-ceiling" ? Math.min(apex, 92) : apex

  /* ---- platform rows -------------------------------------------------- */
  const rowHeights: number[] = []
  for (let index = 0; index < map.platformRows; index += 1) {
    const height = Math.min(TRAVEL.minStepUp + index * 36, maxRise - 6)
    if (height < TRAVEL.minStepUp) break
    if (rowHeights.includes(height)) continue
    rowHeights.push(height)
  }
  const topRow = rowHeights.length ? Math.max(...rowHeights) : TRAVEL.minStepUp

  /* ---- gate dimensions ------------------------------------------------ */
  // A gate must be taller than (highest platform top — reached apex) so it can
  // never be jumped over, from the ground or from any platform.
  const gateHeight = Math.max(TRAVEL.minGateHeight, Math.round(topRow + apex + 60))
  const gateY = GROUND_Y - gateHeight

  /* ---- gaps ----------------------------------------------------------- */
  const gapMax = Math.max(90, Math.min(map.gapMax, Math.floor(airDistance * 0.7)))
  const gapMin = Math.max(80, Math.min(map.gapMin, gapMax - 20))

  const addGround = (x: number, width: number) => {
    solids.push({ x, y: GROUND_Y, w: width, h: 200 })
  }
  const addPlatform = (x: number, y: number, width: number) => {
    solids.push({ x, y, w: width, h: PLATFORM_THICKNESS })
  }
  const addWalkOrb = (id: string, x: number) => {
    orbs.push({ id, x, y: GROUND_Y - WALK_ORB_HEIGHT, taken: false })
  }
  const addPlatformOrb = (id: string, x: number, top: number) => {
    orbs.push({ id, x, y: top - WALK_ORB_HEIGHT, taken: false })
  }

  const runLength = map.runLength

  let cursor = 0

  /* ---- opening plateau ------------------------------------------------ */
  const startWidth = 520
  addGround(0, startWidth)
  cursor = startWidth

  checkpoints.push({
    id: "checkpoint-start",
    x: WORLD_PADDING + 60,
    y: GROUND_Y - CHECKPOINT_HEIGHT,
    w: CHECKPOINT_WIDTH,
    h: CHECKPOINT_HEIGHT,
    reached: true,
  })

  const spawn = { x: WORLD_PADDING, y: GROUND_Y - 70 }

  addWalkOrb("orb-start-0", 220)
  addWalkOrb("orb-start-1", 330)
  orbs.push({ id: "orb-start-2", x: 430, y: GROUND_Y - 132, taken: false })

  // Low-ceiling maps get a ceiling over the opening plateau too.
  if (map.mechanic === "low-ceiling") addCeiling(0, startWidth - 40)

  function addCeiling(from: number, width: number) {
    const bottom = GROUND_Y - maxRise - PLAYER_H
    ceilings.push({
      x: from,
      y: bottom - CEILING_THICKNESS,
      w: width,
      h: CEILING_THICKNESS,
    })
  }

  /* ---- one section per challenge -------------------------------------- */
  questions.forEach((question, index) => {
    const gap = gapMin + Math.round(random() * Math.max(0, gapMax - gapMin))
    cursor += gap

    addGround(cursor, runLength)

    checkpoints.push({
      id: `checkpoint-${index + 1}`,
      x: cursor + 40,
      y: GROUND_Y - CHECKPOINT_HEIGHT,
      w: CHECKPOINT_WIDTH,
      h: CHECKPOINT_HEIGHT,
      reached: false,
    })

    const gateX = cursor + runLength - 150

    // -- mechanic-specific geometry inside this section ------------------
    if (map.mechanic === "stepping-stones") {
      // Stones span the pit that was just crossed, giving a safer route.
      const stoneY = GROUND_Y - 90
      const count = gap > 150 ? 2 : 1
      for (let step = 0; step < count; step += 1) {
        const x = cursor - gap + 40 + step * Math.floor((gap - 80) / Math.max(1, count))
        addPlatform(x, stoneY, 64)
        addPlatformOrb(`orb-${index}-stone-${step}`, x + 32, stoneY)
      }
    }

    if (map.mechanic === "moving-platforms") {
      // A drifting platform hovers over the pit as a bonus route. It stays
      // well above head height so it can never trap a player walking below it.
      const moverX = cursor - gap / 2 - 55
      const moverY = GROUND_Y - 116
      movers.push({
        id: `mover-${index}`,
        x: moverX,
        y: moverY,
        w: 110,
        h: PLATFORM_THICKNESS,
        axis: "x",
        range: Math.max(20, Math.min(70, (gap - 110) / 2)),
        speed: 1.1 + (index % 3) * 0.25,
        phase: index * 1.7,
        originX: moverX,
        originY: moverY,
        prevX: moverX,
        prevY: moverY,
      })
      addPlatformOrb(`orb-${index}-mover`, moverX + 55, moverY)
    }

    // -- platform rows ---------------------------------------------------
    // Rows are distributed across the space actually available between the
    // section start and the gate, so a map that declares three rows really gets
    // three instead of silently dropping the ones that would not fit.
    const spanStart = cursor + 90
    const spanEnd = gateX - 50
    const span = spanEnd - spanStart
    const rowCount = rowHeights.length
    const spacing = 26
    const preferred = map.mechanic === "counters" ? 170 : 140
    const rowWidth = Math.max(
      110,
      Math.min(preferred, Math.floor((span - spacing * (rowCount - 1)) / Math.max(1, rowCount))),
    )
    rowHeights.forEach((height, row) => {
      const x = spanStart + row * (rowWidth + spacing)
      if (x + rowWidth > spanEnd) return
      addPlatform(x, GROUND_Y - height, rowWidth)
      addPlatformOrb(`orb-${index}-r${row}`, x + rowWidth / 2, GROUND_Y - height)
    })

    if (map.mechanic === "counters" && index % 2 === 0) {
      // Extra ingredient sitting on a low counter ledge.
      const y = GROUND_Y - TRAVEL.minStepUp
      addPlatform(gateX - 300, y, 120)
      addPlatformOrb(`orb-${index}-counter`, gateX - 240, y)
    }

    // -- the educational gate -------------------------------------------
    gates.push({
      id: `gate-${index + 1}`,
      questionId: question.id,
      index,
      x: gateX,
      y: gateY,
      w: map.gateWidth,
      h: gateHeight,
      opened: opened.has(question.id),
    })

    addWalkOrb(`orb-${index}-c`, cursor + 380)

    // -- low ceiling over the walkable run, stopping before the gate -----
    if (map.mechanic === "low-ceiling") {
      addCeiling(cursor, Math.max(120, gateX - 70 - cursor))
    }

    cursor += runLength
  })

  /* ---- final run, final challenge and goal ---------------------------- */
  const finalGap = gapMin + Math.round(random() * Math.max(0, gapMax - gapMin))
  cursor += finalGap
  const finalWidth = 700
  addGround(cursor, finalWidth)

  checkpoints.push({
    id: `checkpoint-${questions.length + 1}`,
    x: cursor + 40,
    y: GROUND_Y - CHECKPOINT_HEIGHT,
    w: CHECKPOINT_WIDTH,
    h: CHECKPOINT_HEIGHT,
    reached: false,
  })

  if (map.mechanic === "low-ceiling") addCeiling(cursor, finalWidth - 220)

  rowHeights.slice(0, 2).forEach((height, row) => {
    const x = cursor + 150 + row * 180
    if (x + 120 > finalWidth - 240) return
    addPlatform(x, GROUND_Y - height, 120)
    addPlatformOrb(`orb-final-r${row}`, x + 60, GROUND_Y - height)
  })
  addWalkOrb("orb-final-c", cursor + 80)

  const goal: Rect = {
    x: cursor + finalWidth - 170,
    y: GROUND_Y - 168,
    w: 84,
    h: 168,
  }

  const width = cursor + finalWidth + 120

  /* ---- death zones ---------------------------------------------------- */
  // Derived from the ground geometry, so a hazard can never drift out of step
  // with the pit it belongs to. `drawHazardHint` reads this list too, which is
  // why the warning stripe always sits exactly on a lethal gap.
  const groundSlabs = solids
    .filter((solid) => solid.h > 60)
    .slice()
    .sort((left, right) => left.x - right.x)
  for (let index = 1; index < groundSlabs.length; index += 1) {
    const from = groundSlabs[index - 1].x + groundSlabs[index - 1].w
    const to = groundSlabs[index].x
    if (to - from < 40) continue
    hazards.push({
      x: from,
      y: GROUND_Y + 6,
      w: to - from,
      h: Math.max(0, LEVEL_HEIGHT - GROUND_Y - 6),
    })
  }

  return {
    materialId: material.id,
    mapId: map.id,
    map,
    width,
    height: LEVEL_HEIGHT,
    groundY: GROUND_Y,
    deathY: LEVEL_HEIGHT,
    gravityScale: map.gravityScale,
    maxRise,
    gateHeight,
    solids,
    ceilings,
    hazards,
    gates,
    orbs,
    checkpoints,
    movers,
    goal,
    spawn,
    orbCount: orbs.length,
  }
}

export function gateTriggerZone(gate: Gate): Rect {
  return {
    x: gate.x - GATE_TRIGGER_WIDTH,
    y: gate.y - TILE * 2,
    w: GATE_TRIGGER_WIDTH,
    h: gate.h + TILE * 2,
  }
}

export function safeSpawnFor(level: Level, checkpointId: string | null): { x: number; y: number } {
  if (!checkpointId) return { ...level.spawn }
  const checkpoint = level.checkpoints.find((item) => item.id === checkpointId)
  if (!checkpoint) return { ...level.spawn }
  return { x: checkpoint.x, y: checkpoint.y - 20 }
}

export { ORB_RADIUS }
