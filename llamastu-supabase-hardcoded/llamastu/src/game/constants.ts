/**
 * Platformer tuning.
 *
 * The reachability budget below is derived from the physics and is what every
 * generated level is built and verified against:
 *
 *   apex height     = jumpVelocity² / (2 · gravity)   ≈ 145 px
 *   air time        = 2 · jumpVelocity / gravity        ≈ 0.73 s
 *   jump distance   = air time · moveSpeed              ≈ 233 px
 *
 * Maps scale gravity, so the builder recomputes these per map (see
 * `src/game/level.ts`) and keeps every step-up and gap inside the envelope.
 */

export const TILE = 48

export const PLAYER_W = 34
export const PLAYER_H = 46

export const GRAVITY = 2200
export const MOVE_SPEED = 320
export const GROUND_ACCELERATION = 2800
export const AIR_ACCELERATION = 1700
export const GROUND_FRICTION = 2600
export const JUMP_VELOCITY = -800
export const MAX_FALL_SPEED = 1300
export const COYOTE_TIME = 0.1
export const JUMP_BUFFER_TIME = 0.12

export const GROUND_Y = 528
export const LEVEL_HEIGHT = 736
export const DEATH_Y = 736
export const WORLD_PADDING = 80

/**
 * Minimum gap between two processed deaths. One fall can cross more than one
 * kill band in a single step, and a checkpoint can sit inside a pit's hazard
 * column; this is what makes "one mistake, one respawn" true rather than
 * approximate.
 */
export const DEATH_COOLDOWN = 0.35

export const FIXED_STEP = 1 / 120
export const MAX_FRAME_STEP = 1 / 30

export const ORB_RADIUS = 13
export const CHECKPOINT_WIDTH = 26
export const CHECKPOINT_HEIGHT = 64
export const PLATFORM_THICKNESS = 26
export const CEILING_THICKNESS = 34

/** A standing player spans GROUND_Y − 46 … GROUND_Y, so this is always collected. */
export const WALK_ORB_HEIGHT = 40

/** Trigger band in front of every gate. */
export const GATE_TRIGGER_WIDTH = 118

export const TRAVEL = {
  /** Baseline reachable apex at gravity ×1. */
  apex: (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY),
  /** Baseline horizontal reach at gravity ×1. */
  jumpDistance: 2 * (Math.abs(JUMP_VELOCITY) / GRAVITY) * MOVE_SPEED,
  /** A platform must clear the player's head (PLAYER_H + thickness) to be walked under. */
  minStepUp: 72,
  minGateHeight: 150,
} as const

/**
 * Fallback palette. Individual maps override this — see `src/game/maps.ts`.
 */
export const COLORS = {
  skyTop: "#fff3e0",
  skyBottom: "#ffd9ae",
  hillFar: "#e9c9a6",
  hillNear: "#dbb28b",
  groundTop: "#8da789",
  groundBody: "#6f8a6c",
  groundDeep: "#5b7358",
  platformTop: "#c98f5f",
  platformBody: "#a97045",
  platformEdge: "#8a5a37",
  gateClosed: "#7d6b63",
  gateClosedDark: "#5d4f49",
  gateOpen: "#8da789",
  orb: "#ffb347",
  orbGlow: "rgba(255, 179, 71, 0.35)",
  checkpoint: "#d96f4b",
  checkpointDone: "#8da789",
  goal: "#bb563c",
  goalGlow: "rgba(187, 86, 60, 0.3)",
  player: "#d96f4b",
  playerDark: "#bb563c",
  skin: "#f2cfae",
  hair: "#6b4530",
  ink: "#3f302b",
}
