import {
  AIR_ACCELERATION,
  COYOTE_TIME,
  DEATH_COOLDOWN,
  GRAVITY,
  GROUND_ACCELERATION,
  GROUND_FRICTION,
  JUMP_BUFFER_TIME,
  JUMP_VELOCITY,
  MAX_FALL_SPEED,
  MOVE_SPEED,
  ORB_RADIUS,
  PLAYER_H,
  PLAYER_W,
} from "./constants"
import { gateTriggerZone, safeSpawnFor, type Gate, type Level, type Rect } from "./level"

export type Input = { left: boolean; right: boolean; jump: boolean }

export type WorldEvent =
  | { type: "orb"; id: string }
  | { type: "checkpoint"; id: string }
  | { type: "gate-trigger"; gateId: string; questionId: string }
  | { type: "died" }
  | { type: "respawned"; checkpointId: string | null }
  | { type: "goal" }
  | { type: "jumped" }

export type Player = {
  x: number
  y: number
  w: number
  h: number
  vx: number
  vy: number
  onGround: boolean
  facing: 1 | -1
  coyote: number
  jumpBuffer: number
  jumpHeld: boolean
  cutoffApplied: boolean
  animTime: number
  squish: number
}

export type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
}

export type WorldStatus = "playing" | "challenge" | "finished"

export type World = {
  level: Level
  player: Player
  cameraX: number
  elapsed: number
  status: WorldStatus
  activeGateId: string | null
  particles: Particle[]
  lastCheckpointId: string | null
  sessionXp: number
  viewWidth: number
  deaths: number
  stamina: number
  /**
   * Time remaining before another death may be processed.
   *
   * Respawn teleports the player to a checkpoint, but a hazard can overlap that
   * spawn point or a fall can cross two kill bands in one step. Without this
   * guard a single mistake could fire several deaths and several `died` events
   * in consecutive steps, which is what "duplicate respawn events" looks like
   * from the outside.
   */
  deathCooldown: number
  /**
   * Saved completion, kept separate from the live session status, so replaying a
   * finished map starts a real new session instead of opening frozen.
   */
  completed: boolean
}

export type SavedGameState = {
  openedGates: string[]
  collected: string[]
  checkpoints: string[]
  finished: boolean
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function circleOverlapsRect(cx: number, cy: number, radius: number, rect: Rect): boolean {
  const nearestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w))
  const nearestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h))
  const dx = cx - nearestX
  const dy = cy - nearestY
  return dx * dx + dy * dy <= radius * radius
}

export function createWorld(level: Level, saved: SavedGameState): World {
  const reachedCheckpoint =
    [...level.checkpoints]
      .reverse()
      .find((checkpoint) => saved.checkpoints.includes(checkpoint.id))?.id ?? null

  level.gates.forEach((gate) => {
    gate.opened = saved.openedGates.includes(gate.questionId)
  })
  level.orbs.forEach((orb) => {
    orb.taken = saved.collected.includes(orb.id)
  })
  level.checkpoints.forEach((checkpoint) => {
    checkpoint.reached = saved.checkpoints.includes(checkpoint.id)
  })

  const spawn = safeSpawnFor(level, reachedCheckpoint)

  return {
    level,
    player: {
      x: spawn.x,
      y: spawn.y,
      w: PLAYER_W,
      h: PLAYER_H,
      vx: 0,
      vy: 0,
      onGround: false,
      facing: 1,
      coyote: 0,
      jumpBuffer: 0,
      jumpHeld: false,
      cutoffApplied: false,
      animTime: 0,
      squish: 0,
    },
    cameraX: Math.max(0, spawn.x - 200),
    elapsed: 0,
    // A replayed map always opens in a live, playable session. Saved completion
    // is remembered on `completed` instead of freezing the world on load.
    status: "playing",
    activeGateId: null,
    particles: [],
    lastCheckpointId: reachedCheckpoint,
    sessionXp: 0,
    viewWidth: 840,
    deaths: 0,
    stamina: 1,
    deathCooldown: 0,
    completed: saved.finished,
  }
}

/**
 * Starts a clean session on an existing level.
 *
 * Permanent progress — opened gates, collected orbs, reached checkpoints — is
 * preserved, because that is the learner's earned progress and must survive
 * leaving and reopening a map. Everything temporary is reset: position and
 * velocity, camera, timers, particles, the active challenge, the death counter
 * and the per-session SP counter. No reward is touched, so a reset can never
 * duplicate XP.
 */
export function resetSession(world: World, saved?: SavedGameState): World {
  if (saved) {
    for (const gate of world.level.gates) {
      gate.opened = saved.openedGates.includes(gate.questionId)
    }
    for (const orb of world.level.orbs) orb.taken = saved.collected.includes(orb.id)
    for (const checkpoint of world.level.checkpoints) {
      checkpoint.reached = saved.checkpoints.includes(checkpoint.id)
    }
    world.lastCheckpointId =
      [...world.level.checkpoints]
        .reverse()
        .find((checkpoint) => saved.checkpoints.includes(checkpoint.id))?.id ?? null
    world.completed = saved.finished
  }

  const spawn = safeSpawnFor(world.level, world.lastCheckpointId)
  const player = world.player
  player.x = spawn.x
  player.y = spawn.y
  player.vx = 0
  player.vy = 0
  player.onGround = false
  player.facing = 1
  player.coyote = 0
  player.jumpBuffer = 0
  player.jumpHeld = false
  player.cutoffApplied = false
  player.animTime = 0
  player.squish = 0

  world.cameraX = Math.max(0, spawn.x - 200)
  world.elapsed = 0
  world.status = "playing"
  world.activeGateId = null
  world.particles = []
  world.sessionXp = 0
  world.deaths = 0
  world.stamina = 1
  world.deathCooldown = 0
  return world
}

/** Solid geometry the player can collide with right now. */
function solidRects(world: World): Rect[] {
  const closedGates = world.level.gates
    .filter((gate) => !gate.opened)
    .map<Rect>((gate) => ({ x: gate.x, y: gate.y, w: gate.w, h: gate.h }))
  const movers = world.level.movers.map<Rect>((mover) => ({
    x: mover.x,
    y: mover.y,
    w: mover.w,
    h: mover.h,
  }))
  return [...world.level.solids, ...world.level.ceilings, ...closedGates, ...movers]
}

/** Advances oscillating platforms and carries any player standing on one. */
function stepMovers(world: World, dt: number): void {
  const moverList = world.level.movers
  if (!moverList.length) return

  for (const mover of moverList) {
    mover.prevX = mover.x
    mover.prevY = mover.y
    const offset = Math.sin(world.elapsed * mover.speed + mover.phase) * mover.range
    if (mover.axis === "x") mover.x = mover.originX + offset
    else mover.y = mover.originY + offset
  }

  // Carrying: stand on a mover and you travel with it.
  const player = world.player
  const probe: Rect = { x: player.x + 2, y: player.y + player.h, w: player.w - 4, h: 4 }
  for (const mover of moverList) {
    if (!overlaps(probe, mover)) continue
    player.x += mover.x - mover.prevX
    player.y += mover.y - mover.prevY
  }
  void dt
}

function resolveHorizontal(player: Player, dx: number, solids: Rect[], level: Level): boolean {
  player.x += dx
  let blocked = false
  for (let pass = 0; pass < 3; pass += 1) {
    let hit = false
    for (const solid of solids) {
      if (!overlaps(player, solid)) continue
      hit = true
      blocked = true
      if (dx > 0) player.x = solid.x - player.w
      else if (dx < 0) player.x = solid.x + solid.w
    }
    if (!hit) break
  }
  player.x = Math.max(0, Math.min(player.x, level.width - player.w))
  return blocked
}

function resolveVertical(
  player: Player,
  dy: number,
  solids: Rect[],
): { landed: boolean; bumped: boolean } {
  player.y += dy
  let landed = false
  let bumped = false
  for (let pass = 0; pass < 3; pass += 1) {
    let hit = false
    for (const solid of solids) {
      if (!overlaps(player, solid)) continue
      hit = true
      if (dy > 0) {
        player.y = solid.y - player.h
        landed = true
      } else if (dy < 0) {
        player.y = solid.y + solid.h
        bumped = true
      }
    }
    if (!hit) break
  }
  return { landed, bumped }
}

/**
 * Puts the player back on the last checkpoint with a clean slate.
 *
 * Position, velocity and the whole temporary failure state are restored, and a
 * short cooldown is armed so overlapping hazards cannot respawn the player
 * twice for one fall. Gameplay continues immediately — no reload is involved.
 */
export function respawn(world: World): WorldEvent[] {
  const spawn = safeSpawnFor(world.level, world.lastCheckpointId)
  const player = world.player
  player.x = spawn.x
  player.y = spawn.y
  player.vx = 0
  player.vy = 0
  player.onGround = false
  player.coyote = 0
  player.jumpBuffer = 0
  player.jumpHeld = false
  player.cutoffApplied = false
  player.squish = 0
  world.cameraX = Math.max(0, Math.min(player.x - 220, world.level.width))
  world.deathCooldown = DEATH_COOLDOWN
  return [{ type: "respawned", checkpointId: world.lastCheckpointId }]
}

export function openGate(world: World, gate: Gate): void {
  gate.opened = true
  world.activeGateId = null
  world.status = "playing"
  world.player.vx = 0
  for (let index = 0; index < 18; index += 1) {
    world.particles.push({
      x: gate.x + gate.w / 2,
      y: gate.y + gate.h / 2,
      vx: (Math.random() - 0.5) * 260,
      vy: (Math.random() - 0.5) * 260,
      life: 0.7,
      maxLife: 0.7,
      color: world.level.map.palette.gateOpen,
    })
  }
}

export function activeGate(world: World): Gate | null {
  if (!world.activeGateId) return null
  return world.level.gates.find((gate) => gate.id === world.activeGateId) ?? null
}

function spawnParticles(world: World, x: number, y: number, color: string): void {
  for (let index = 0; index < 12; index += 1) {
    world.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 200,
      vy: -Math.random() * 200 - 40,
      life: 0.6,
      maxLife: 0.6,
      color,
    })
  }
}

/**
 * Advances the simulation by one fixed step and returns the gameplay events
 * that happened, so the caller can persist progress and award XP exactly once.
 */
export function stepWorld(world: World, input: Input, dt: number): WorldEvent[] {
  const events: WorldEvent[] = []
  const player = world.player

  if (world.status === "challenge") {
    player.vx = 0
    stepParticles(world, dt)
    return events
  }

  world.elapsed += dt
  player.animTime += dt

  stepMovers(world, dt)

  if (world.status === "finished") {
    input = { left: false, right: false, jump: false }
  }

  const gravity = GRAVITY * world.level.gravityScale

  // ---- horizontal movement -------------------------------------------
  const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  const acceleration = player.onGround ? GROUND_ACCELERATION : AIR_ACCELERATION

  if (direction !== 0) {
    player.vx += direction * acceleration * dt
    player.vx = Math.max(-MOVE_SPEED, Math.min(MOVE_SPEED, player.vx))
    player.facing = direction > 0 ? 1 : -1
  } else if (player.onGround) {
    const drop = GROUND_FRICTION * dt
    if (Math.abs(player.vx) <= drop) player.vx = 0
    else player.vx -= Math.sign(player.vx) * drop
  } else {
    player.vx *= 1 - Math.min(0.9, dt * 0.6)
  }

  // ---- jump -----------------------------------------------------------
  if (input.jump && !player.jumpHeld) player.jumpBuffer = JUMP_BUFFER_TIME
  player.jumpHeld = input.jump
  player.jumpBuffer = Math.max(0, player.jumpBuffer - dt)

  if (player.jumpBuffer > 0 && (player.onGround || player.coyote > 0)) {
    player.vy = JUMP_VELOCITY
    player.onGround = false
    player.coyote = 0
    player.jumpBuffer = 0
    player.cutoffApplied = false
    player.squish = -0.35
    events.push({ type: "jumped" })
  }

  // Variable jump height: releasing early cuts the rise once.
  if (!input.jump && player.vy < JUMP_VELOCITY * 0.4 && !player.cutoffApplied) {
    player.vy *= 0.55
    player.cutoffApplied = true
  }

  // ---- gravity --------------------------------------------------------
  player.vy = Math.min(MAX_FALL_SPEED, player.vy + gravity * dt)

  // ---- collisions -----------------------------------------------------
  const solids = solidRects(world)
  if (player.vx !== 0) resolveHorizontal(player, player.vx * dt, solids, world.level)

  const wasOnGround = player.onGround
  player.onGround = false
  const { landed, bumped } = resolveVertical(player, player.vy * dt, solids)
  if (bumped) player.vy = Math.max(player.vy, 0)
  if (landed) {
    if (!wasOnGround && player.vy > 400) player.squish = 0.35
    player.vy = 0
    player.onGround = true
    player.coyote = COYOTE_TIME
  } else {
    player.coyote = Math.max(0, player.coyote - dt)
  }
  player.squish *= 1 - Math.min(1, dt * 8)

  // ---- death zones ----------------------------------------------------
  // Two ways to die: falling past the world floor, or entering an explicitly
  // defined hazard band inside a pit. The cooldown means one mistake produces
  // exactly one `died` event and exactly one respawn.
  world.deathCooldown = Math.max(0, world.deathCooldown - dt)
  if (world.deathCooldown === 0) {
    const inHazard = world.level.hazards.some((hazard) => overlaps(player, hazard))
    if (inHazard || player.y > world.level.deathY) {
      world.deaths += 1
      events.push({ type: "died" })
      events.push(...respawn(world))
      stepParticles(world, dt)
      return events
    }
  }

  // ---- collectibles ---------------------------------------------------
  for (const orb of world.level.orbs) {
    if (orb.taken) continue
    if (!circleOverlapsRect(orb.x, orb.y, ORB_RADIUS, player)) continue
    orb.taken = true
    world.sessionXp += 5
    spawnParticles(world, orb.x, orb.y, world.level.map.palette.accent)
    events.push({ type: "orb", id: orb.id })
  }

  // ---- checkpoints ----------------------------------------------------
  for (const checkpoint of world.level.checkpoints) {
    if (checkpoint.reached) continue
    if (!overlaps(player, checkpoint)) continue
    checkpoint.reached = true
    world.lastCheckpointId = checkpoint.id
    spawnParticles(world, checkpoint.x + checkpoint.w / 2, checkpoint.y, "#d96f4b")
    events.push({ type: "checkpoint", id: checkpoint.id })
  }

  // ---- final challenge / goal -----------------------------------------
  if (world.status !== "finished" && overlaps(player, world.level.goal)) {
    const allOpen = world.level.gates.every((gate) => gate.opened)
    if (allOpen) {
      world.status = "finished"
      world.sessionXp += 50
      spawnParticles(
        world,
        world.level.goal.x + 40,
        world.level.goal.y + 80,
        world.level.map.palette.accent,
      )
      events.push({ type: "goal" })
    }
  }

  // ---- gate triggers --------------------------------------------------
  if (world.status === "playing") {
    for (const gate of world.level.gates) {
      if (gate.opened) continue
      if (!overlaps(player, gateTriggerZone(gate))) continue
      world.status = "challenge"
      world.activeGateId = gate.id
      player.vx = 0
      events.push({ type: "gate-trigger", gateId: gate.id, questionId: gate.questionId })
      break
    }
  }

  updateCamera(world, dt)
  stepParticles(world, dt)
  return events
}

/** Keeps the player centred while never showing past the level edges. */
export function updateCamera(world: World, dt: number): void {
  const viewWidth = Math.max(320, world.viewWidth)
  const maxCamera = Math.max(0, world.level.width - viewWidth)
  const target = world.player.x + world.player.w / 2 - viewWidth / 2
  const clamped = Math.max(0, Math.min(maxCamera, target))
  const smoothing = 1 - Math.pow(0.0001, dt)
  world.cameraX += (clamped - world.cameraX) * smoothing
}

function stepParticles(world: World, dt: number): void {
  const remaining: Particle[] = []
  for (const particle of world.particles) {
    particle.life -= dt
    if (particle.life <= 0) continue
    particle.vy += 520 * dt
    particle.x += particle.vx * dt
    particle.y += particle.vy * dt
    remaining.push(particle)
  }
  world.particles = remaining
}

export function worldSnapshot(world: World) {
  return {
    status: world.status,
    x: world.player.x,
    y: world.player.y,
    openedGates: world.level.gates.filter((gate) => gate.opened).map((gate) => gate.questionId),
    collected: world.level.orbs.filter((orb) => orb.taken).map((orb) => orb.id),
    checkpoints: world.level.checkpoints.filter((item) => item.reached).map((item) => item.id),
    finished: world.status === "finished",
    orbCount: world.level.orbCount,
  }
}
