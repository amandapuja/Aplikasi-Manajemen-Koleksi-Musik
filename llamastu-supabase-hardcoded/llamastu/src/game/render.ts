import { LEVEL_HEIGHT, ORB_RADIUS, PLAYER_H, PLAYER_W } from "./constants"
import type { GameCharacter } from "./characters"
import type { Gate, Level, Mover } from "./level"
import type { Player, World } from "./engine"

export type Viewport = { width: number; height: number }

/**
 * The single source of truth for the canvas geometry.
 *
 * The renderer draws in world units through a scaled transform, so the region a
 * frame is responsible for is NOT `cssWidth x cssHeight`: it is
 * `cssWidth / scale` world units wide by `LEVEL_HEIGHT` tall, where
 * `scale = cssHeight / LEVEL_HEIGHT`. Getting this wrong is what made the
 * character leave translucent copies of itself behind, so the formula lives in
 * one place and is asserted directly by the test harness.
 */
export function canvasMetrics(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): {
  pixelWidth: number
  pixelHeight: number
  transformScale: number
  viewport: Viewport
} {
  const safeWidth = cssWidth > 0 ? cssWidth : 800
  const safeHeight = cssHeight > 0 ? cssHeight : 420
  /**
   * Everything is derived from the ROUNDED backing-store size.
   *
   * A fractional device pixel ratio is common (1.25 and 1.5 are standard on
   * Windows), and rounding `cssWidth * dpr` can add up to a pixel to each
   * dimension. If the transform is instead derived from the unrounded size, the
   * drawn viewport ends up a fraction narrower than the canvas: the full clear
   * erases that last column, but the sky pass never repaints it, leaving a
   * permanently transparent seam down the right edge. Deriving the scale from
   * `pixelHeight` makes `viewport.width * transformScale === pixelWidth` and
   * `LEVEL_HEIGHT * transformScale === pixelHeight` exact, at any ratio.
   */
  const pixelWidth = Math.max(1, Math.round(safeWidth * dpr))
  const pixelHeight = Math.max(1, Math.round(safeHeight * dpr))
  const transformScale = pixelHeight / LEVEL_HEIGHT
  return {
    pixelWidth,
    pixelHeight,
    transformScale,
    viewport: { width: pixelWidth / transformScale, height: LEVEL_HEIGHT },
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/* ------------------------------------------------------------------ *
 * Backgrounds — one distinct treatment per map
 * ------------------------------------------------------------------ */

function drawSky(ctx: CanvasRenderingContext2D, level: Level, viewport: Viewport): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, viewport.height)
  gradient.addColorStop(0, level.map.palette.skyTop)
  gradient.addColorStop(1, level.map.palette.skyBottom)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, viewport.width, viewport.height)
}

function drawDecor(
  ctx: CanvasRenderingContext2D,
  world: World,
  viewport: Viewport,
  elapsed: number,
): void {
  const level = world.level
  const palette = level.map.palette
  const camera = world.cameraX

  switch (palette.decor) {
    case "stars": {
      ctx.fillStyle = "rgba(255,255,255,0.85)"
      for (let index = 0; index < 70; index += 1) {
        const x = ((index * 137.5) % 1400) - (camera * 0.05) % 1400
        const y = (index * 53.7) % 380
        const size = index % 5 === 0 ? 1.8 : 1
        ctx.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(elapsed * 1.4 + index))
        ctx.fillRect(x, y, size, size)
      }
      ctx.globalAlpha = 1
      // A distant planet
      ctx.beginPath()
      ctx.arc(viewport.width - 150 - ((camera * 0.04) % 900), 130, 62, 0, Math.PI * 2)
      ctx.fillStyle = "rgba(127, 224, 200, 0.22)"
      ctx.fill()
      break
    }
    case "waves": {
      ctx.fillStyle = palette.hillFar
      for (let index = -1; index < Math.ceil(viewport.width / 500) + 2; index += 1) {
        const x = index * 500 - ((camera * 0.2) % 500)
        ctx.beginPath()
        ctx.moveTo(x, 470)
        ctx.quadraticCurveTo(x + 125, 430 + Math.sin(elapsed + index) * 6, x + 250, 470)
        ctx.quadraticCurveTo(x + 375, 510 + Math.cos(elapsed * 0.8 + index) * 6, x + 500, 470)
        ctx.lineTo(x + 500, viewport.height)
        ctx.lineTo(x, viewport.height)
        ctx.fill()
      }
      ctx.fillStyle = palette.hillNear
      for (let index = -1; index < Math.ceil(viewport.width / 700) + 2; index += 1) {
        const x = index * 700 - ((camera * 0.33) % 700)
        ctx.beginPath()
        ctx.moveTo(x, 520)
        ctx.quadraticCurveTo(x + 175, 470, x + 350, 520)
        ctx.lineTo(x + 350, viewport.height)
        ctx.lineTo(x, viewport.height)
        ctx.fill()
      }
      break
    }
    case "grid": {
      ctx.strokeStyle = "rgba(95,122,140,0.22)"
      ctx.lineWidth = 1
      const step = 56
      const offset = -(camera * 0.25) % step
      for (let x = offset; x < viewport.width; x += step) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, viewport.height)
        ctx.stroke()
      }
      for (let y = 60; y < viewport.height; y += step) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(viewport.width, y)
        ctx.stroke()
      }
      ctx.fillStyle = "rgba(79,143,176,0.14)"
      for (let index = -1; index < Math.ceil(viewport.width / 460) + 2; index += 1) {
        const x = index * 460 - ((camera * 0.16) % 460)
        ctx.fillRect(x + 60, 300, 120, 200)
      }
      break
    }
    case "tiles": {
      // Kitchen wall tiles
      const tile = 74
      const offset = -(camera * 0.24) % tile
      ctx.strokeStyle = "rgba(185,155,116,0.28)"
      ctx.lineWidth = 2
      for (let x = offset; x < viewport.width + tile; x += tile) {
        for (let y = 40; y < 470; y += tile) {
          ctx.strokeRect(x, y, tile, tile)
        }
      }
      ctx.fillStyle = "rgba(217,115,75,0.12)"
      for (let index = -1; index < Math.ceil(viewport.width / 380) + 2; index += 1) {
        const x = index * 380 - ((camera * 0.14) % 380)
        ctx.fillRect(x + 100, 120, 90, 26)
        ctx.fillRect(x + 220, 200, 90, 26)
      }
      break
    }
    default: {
      // Rolling hills
      const farOffset = -(camera * 0.18) % 900
      ctx.fillStyle = palette.hillFar
      for (let index = -1; index < Math.ceil(viewport.width / 900) + 2; index += 1) {
        const baseX = farOffset + index * 900
        ctx.beginPath()
        ctx.ellipse(baseX + 240, 470, 300, 170, 0, Math.PI, 0)
        ctx.fill()
        ctx.beginPath()
        ctx.ellipse(baseX + 690, 500, 260, 200, 0, Math.PI, 0)
        ctx.fill()
      }
      const nearOffset = -(camera * 0.34) % 700
      ctx.fillStyle = palette.hillNear
      for (let index = -1; index < Math.ceil(viewport.width / 700) + 2; index += 1) {
        const baseX = nearOffset + index * 700
        ctx.beginPath()
        ctx.ellipse(baseX + 180, 545, 250, 145, 0, Math.PI, 0)
        ctx.fill()
        ctx.beginPath()
        ctx.ellipse(baseX + 520, 560, 210, 160, 0, Math.PI, 0)
        ctx.fill()
      }
      ctx.fillStyle = "rgba(255, 219, 160, 0.85)"
      ctx.beginPath()
      ctx.arc(viewport.width - 130, 108, 54, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "rgba(255,255,255,0.7)"
      for (let index = -1; index < Math.ceil(viewport.width / 620) + 2; index += 1) {
        const baseX = index * 620 - ((camera * 0.08) % 620)
        ctx.beginPath()
        ctx.arc(baseX + 120, 110, 30, 0, Math.PI * 2)
        ctx.arc(baseX + 154, 98, 24, 0, Math.PI * 2)
        ctx.arc(baseX + 184, 114, 26, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
  }
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

function drawCeilings(ctx: CanvasRenderingContext2D, level: Level): void {
  for (const ceiling of level.ceilings) {
    roundedRect(ctx, ceiling.x, ceiling.y, ceiling.w, ceiling.h, 6)
    ctx.fillStyle = level.map.palette.groundDeep
    ctx.fill()
    ctx.fillStyle = "rgba(255,255,255,0.14)"
    ctx.fillRect(ceiling.x, ceiling.y + ceiling.h - 6, ceiling.w, 6)
  }
}

function drawSolids(ctx: CanvasRenderingContext2D, level: Level): void {
  const palette = level.map.palette
  for (const solid of level.solids) {
    const isGround = solid.h > 60
    const isCeiling = solid.y < level.groundY - 200 && solid.h < 60 && solid.y + solid.h < level.groundY - 120

    if (isCeiling) {
      roundedRect(ctx, solid.x, solid.y, solid.w, solid.h, 6)
      ctx.fillStyle = palette.groundDeep
      ctx.fill()
      ctx.fillStyle = "rgba(255,255,255,0.12)"
      ctx.fillRect(solid.x, solid.y, solid.w, 6)
      continue
    }

    if (isGround) {
      ctx.fillStyle = palette.groundDeep
      ctx.fillRect(solid.x, solid.y, solid.w, solid.h)
      const gradient = ctx.createLinearGradient(0, solid.y, 0, solid.y + solid.h)
      gradient.addColorStop(0, palette.groundTop)
      gradient.addColorStop(1, palette.groundDeep)
      ctx.fillStyle = gradient
      ctx.fillRect(solid.x, solid.y, solid.w, solid.h)
      ctx.fillStyle = "rgba(255,255,255,0.18)"
      ctx.fillRect(solid.x, solid.y, solid.w, 6)
    } else {
      roundedRect(ctx, solid.x, solid.y, solid.w, solid.h, 8)
      ctx.fillStyle = palette.platformBody
      ctx.fill()
      roundedRect(ctx, solid.x, solid.y, solid.w, 12, 6)
      ctx.fillStyle = palette.platformTop
      ctx.fill()
      ctx.fillStyle = "rgba(0,0,0,0.16)"
      ctx.fillRect(solid.x + 4, solid.y + solid.h - 6, solid.w - 8, 4)
    }
  }
}

function drawMover(ctx: CanvasRenderingContext2D, mover: Mover, level: Level): void {
  const palette = level.map.palette
  roundedRect(ctx, mover.x, mover.y, mover.w, mover.h, 9)
  ctx.fillStyle = palette.platformEdge
  ctx.fill()
  roundedRect(ctx, mover.x + 3, mover.y + 3, mover.w - 6, mover.h - 6, 7)
  ctx.fillStyle = palette.platformTop
  ctx.fill()
  // Thrusters / energy rails hint that it moves.
  ctx.fillStyle = palette.accent
  ctx.globalAlpha = 0.8
  ctx.fillRect(mover.x + 10, mover.y + mover.h - 4, mover.w - 20, 3)
  ctx.globalAlpha = 1
}

function drawGate(ctx: CanvasRenderingContext2D, gate: Gate, level: Level, elapsed: number): void {
  const palette = level.map.palette
  const style = level.map.id

  if (gate.opened) {
    ctx.fillStyle = palette.gateOpen
    ctx.fillRect(gate.x, gate.y, 9, gate.h)
    ctx.fillRect(gate.x + gate.w - 9, gate.y, 9, gate.h)
    ctx.fillRect(gate.x, gate.y, gate.w, 12)
    const glow = ctx.createLinearGradient(gate.x, gate.y, gate.x + gate.w, gate.y + gate.h)
    glow.addColorStop(0, "rgba(141, 167, 137, 0.35)")
    glow.addColorStop(1, "rgba(141, 167, 137, 0.05)")
    ctx.fillStyle = glow
    ctx.fillRect(gate.x + 9, gate.y + 12, gate.w - 18, gate.h - 12)
    return
  }

  const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.4)

  roundedRect(ctx, gate.x - 4, gate.y - 6, gate.w + 8, gate.h + 6, 10)
  ctx.fillStyle = palette.gateClosedDark
  ctx.fill()
  roundedRect(ctx, gate.x, gate.y, gate.w, gate.h, 8)
  ctx.fillStyle = palette.gateClosed
  ctx.fill()

  // Per-map surface treatment so a door never looks the same in two worlds.
  if (style === "space_station") {
    ctx.strokeStyle = `rgba(127, 224, 200, ${0.35 + pulse * 0.5})`
    ctx.lineWidth = 2
    for (let y = gate.y + 16; y < gate.y + gate.h - 8; y += 22) {
      ctx.beginPath()
      ctx.moveTo(gate.x + 5, y)
      ctx.lineTo(gate.x + gate.w - 5, y)
      ctx.stroke()
    }
  } else if (style === "mystery_lab") {
    ctx.fillStyle = `rgba(79, 143, 176, ${0.3 + pulse * 0.4})`
    ctx.fillRect(gate.x + 6, gate.y + 10, gate.w - 12, gate.h - 20)
    ctx.strokeStyle = "rgba(255,255,255,0.35)"
    ctx.lineWidth = 2
    for (let y = gate.y + 14; y < gate.y + gate.h - 10; y += 14) {
      ctx.beginPath()
      ctx.moveTo(gate.x + 8, y)
      ctx.lineTo(gate.x + gate.w - 8, y + 6)
      ctx.stroke()
    }
  } else if (style === "cooking_kitchen") {
    ctx.strokeStyle = "rgba(255,255,255,0.28)"
    ctx.lineWidth = 3
    for (let y = gate.y + 20; y < gate.y + gate.h - 10; y += 34) {
      ctx.beginPath()
      ctx.moveTo(gate.x + 8, y)
      ctx.lineTo(gate.x + gate.w - 8, y)
      ctx.stroke()
    }
  } else if (style === "treasure_island") {
    ctx.fillStyle = "rgba(255,255,255,0.14)"
    for (let y = gate.y + 12; y < gate.y + gate.h - 14; y += 30) {
      ctx.fillRect(gate.x + 7, y, gate.w - 14, 3)
    }
  } else {
    ctx.strokeStyle = "rgba(255,255,255,0.16)"
    ctx.lineWidth = 2
    for (let y = gate.y + 26; y < gate.y + gate.h - 10; y += 26) {
      ctx.beginPath()
      ctx.moveTo(gate.x + 6, y)
      ctx.lineTo(gate.x + gate.w - 6, y)
      ctx.stroke()
    }
  }

  // Lock emblem
  ctx.beginPath()
  ctx.arc(gate.x + gate.w / 2, gate.y + 78, 17, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(255, 196, 120, ${0.55 + pulse * 0.45})`
  ctx.fill()
  ctx.fillStyle = "#3f302b"
  ctx.font = "700 20px 'Plus Jakarta Sans', system-ui, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText("?", gate.x + gate.w / 2, gate.y + 80)

  ctx.fillStyle = palette.accent
  ctx.globalAlpha = 0.25 + pulse * 0.25
  ctx.fillRect(gate.x - 118, gate.y + gate.h - 8, 118, 8)
  ctx.globalAlpha = 1
}

function drawOrb(
  ctx: CanvasRenderingContext2D,
  orb: { x: number; y: number },
  level: Level,
  elapsed: number,
): void {
  const accent = level.map.palette.accent
  const bob = Math.sin(elapsed * 3 + orb.x * 0.02) * 4
  ctx.beginPath()
  ctx.arc(orb.x, orb.y + bob, ORB_RADIUS + 9, 0, Math.PI * 2)
  ctx.globalAlpha = 0.35
  ctx.fillStyle = accent
  ctx.fill()
  ctx.globalAlpha = 1

  if (level.map.mechanic === "stepping-stones") {
    // Treasure chest
    roundedRect(ctx, orb.x - 12, orb.y + bob - 9, 24, 18, 4)
    ctx.fillStyle = "#b98a3e"
    ctx.fill()
    ctx.fillRect(orb.x - 12, orb.y + bob - 3, 24, 3)
    ctx.fillStyle = "#6b5238"
    ctx.fillRect(orb.x - 2, orb.y + bob - 5, 4, 7)
    return
  }

  const gradient = ctx.createRadialGradient(orb.x - 4, orb.y + bob - 5, 2, orb.x, orb.y + bob, ORB_RADIUS)
  gradient.addColorStop(0, "#fff6dd")
  gradient.addColorStop(1, accent)
  ctx.beginPath()
  ctx.arc(orb.x, orb.y + bob, ORB_RADIUS, 0, Math.PI * 2)
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.strokeStyle = "rgba(255,255,255,0.8)"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(orb.x, orb.y + bob, ORB_RADIUS - 3, -1.4, 0.4)
  ctx.stroke()
}

function drawCheckpoint(
  ctx: CanvasRenderingContext2D,
  checkpoint: { x: number; y: number; w: number; h: number; reached: boolean },
  level: Level,
): void {
  const palette = level.map.palette
  ctx.fillStyle = "#6b5145"
  ctx.fillRect(checkpoint.x + checkpoint.w / 2 - 3, checkpoint.y, 6, checkpoint.h)
  ctx.beginPath()
  ctx.moveTo(checkpoint.x + checkpoint.w / 2 + 3, checkpoint.y + 6)
  ctx.lineTo(checkpoint.x + checkpoint.w / 2 + 40, checkpoint.y + 20)
  ctx.lineTo(checkpoint.x + checkpoint.w / 2 + 3, checkpoint.y + 34)
  ctx.closePath()
  ctx.fillStyle = checkpoint.reached ? palette.gateOpen : "rgba(180, 166, 158, 0.75)"
  ctx.fill()
}

function drawGoal(
  ctx: CanvasRenderingContext2D,
  goal: { x: number; y: number; w: number; h: number },
  level: Level,
  active: boolean,
  elapsed: number,
): void {
  const palette = level.map.palette
  const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2)
  ctx.beginPath()
  ctx.arc(goal.x + goal.w / 2, goal.y + goal.h / 2, goal.w, 0, Math.PI * 2)
  ctx.fillStyle = active ? palette.gateOpen : "rgba(120,110,105,0.16)"
  ctx.globalAlpha = active ? 0.3 + pulse * 0.2 : 0.16
  ctx.fill()
  ctx.globalAlpha = 1

  roundedRect(ctx, goal.x, goal.y, goal.w, goal.h, 14)
  ctx.fillStyle = active ? palette.accent : "#8d8078"
  ctx.fill()

  roundedRect(ctx, goal.x + 11, goal.y + 14, goal.w - 22, goal.h - 14, 10)
  const inner = ctx.createLinearGradient(goal.x, goal.y, goal.x, goal.y + goal.h)
  inner.addColorStop(0, active ? `rgba(255, 240, 214, ${0.55 + pulse * 0.4})` : "rgba(60,52,48,0.55)")
  inner.addColorStop(1, "rgba(60,52,48,0.82)")
  ctx.fillStyle = inner
  ctx.fill()

  ctx.fillStyle = "#fff"
  ctx.font = "700 12px 'Plus Jakarta Sans', system-ui, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(active ? "GOAL" : "LOCKED", goal.x + goal.w / 2, goal.y + goal.h / 2)
}

/* ------------------------------------------------------------------ *
 * Characters — male and female are drawn from different silhouettes
 * ------------------------------------------------------------------ */

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: Player,
  character: GameCharacter,
  elapsed: number,
): void {
  const cx = player.x + player.w / 2
  const feet = player.y + player.h
  const moving = Math.abs(player.vx) > 18
  const airborne = !player.onGround
  const walk = moving ? Math.sin(player.animTime * 14) : 0
  const squash = 1 + player.squish
  const idle = Math.sin(elapsed * 2.2 + player.x * 0.01) * character.idleBob

  const height = PLAYER_H * squash
  const top = feet - height + (airborne ? 0 : -idle)

  // Shadow
  ctx.beginPath()
  ctx.ellipse(cx, feet - 2, (PLAYER_W / squash) * 0.62, 7, 0, 0, Math.PI * 2)
  ctx.fillStyle = "rgba(63, 48, 43, 0.18)"
  ctx.fill()

  const shoulder = character.shoulderWidth
  const torsoTop = top + character.headRadius * 1.5
  const torsoBottom = torsoTop + character.torsoHeight
  const legTop = torsoBottom
  const legSwing = walk * character.walkAmplitude
  const legLift = airborne ? 3 : 0

  // Backpack
  ctx.fillStyle = character.backpack
  roundedRect(ctx, cx - shoulder / 2 - 8, torsoTop + 3, 9, 18, 4)
  ctx.fill()

  // Legs
  ctx.fillStyle = character.trousers
  ctx.fillRect(cx - shoulder / 2 + 3, legTop, 7, character.legLength + legSwing - legLift)
  ctx.fillRect(cx + shoulder / 2 - 10, legTop, 7, character.legLength - legSwing - legLift)
  ctx.fillStyle = character.shoes
  ctx.fillRect(cx - shoulder / 2 + 2, legTop + character.legLength + legSwing - legLift, 9, 5)
  ctx.fillRect(cx + shoulder / 2 - 11, legTop + character.legLength - legSwing - legLift, 9, 5)

  // Torso — tapered differently per character, flared for the female model
  ctx.beginPath()
  ctx.moveTo(cx - shoulder / 2, torsoTop)
  ctx.lineTo(cx + shoulder / 2, torsoTop)
  ctx.lineTo(cx + shoulder / 2 - character.torsoTaper, torsoBottom)
  ctx.lineTo(cx - shoulder / 2 + character.torsoTaper, torsoBottom)
  ctx.closePath()
  ctx.fillStyle = character.outfit
  ctx.fill()

  if (character.id === "female") {
    // Flared tunic hem
    ctx.beginPath()
    ctx.moveTo(cx - shoulder / 2 + character.torsoTaper, torsoBottom - 4)
    ctx.lineTo(cx + shoulder / 2 - character.torsoTaper, torsoBottom - 4)
    ctx.lineTo(cx + shoulder / 2 + 2, torsoBottom + 7)
    ctx.lineTo(cx - shoulder / 2 - 2, torsoBottom + 7)
    ctx.closePath()
    ctx.fillStyle = character.outfitAccent
    ctx.fill()
  } else {
    // Shoulder yoke
    ctx.fillStyle = character.outfitAccent
    roundedRect(ctx, cx - shoulder / 2, torsoTop, shoulder, 6, 3)
    ctx.fill()
  }

  // Arms
  ctx.fillStyle = character.outfit
  const armSwing = moving ? -walk * 4 : 0
  ctx.fillRect(cx + shoulder / 2 - 3, torsoTop + 4 + armSwing, 5, 14)
  ctx.fillRect(cx - shoulder / 2 - 2, torsoTop + 4 - armSwing, 5, 14)

  // Head
  const headY = top + character.headRadius
  ctx.beginPath()
  ctx.arc(cx, headY, character.headRadius, 0, Math.PI * 2)
  ctx.fillStyle = "#f2cfae"
  ctx.fill()

  // Hair — short crop vs long hair with length behind the shoulders
  if (character.hairStyle === "long") {
    ctx.beginPath()
    ctx.ellipse(cx, headY + 12, character.headRadius + 2, 14, 0, 0, Math.PI * 2)
    ctx.fillStyle = character.hairColor
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx, headY - 1, character.headRadius + 1, Math.PI * 1.02, Math.PI * 1.98)
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.arc(cx, headY - 2, character.headRadius + 1, Math.PI * 1.05, Math.PI * 1.95)
    ctx.fillStyle = character.hairColor
    ctx.fill()
    ctx.fillRect(cx - character.headRadius - 1, headY - 5, character.headRadius * 2 + 2, 5)
  }
  // Highlight so the hair reads as a distinct shape rather than a flat blob
  ctx.beginPath()
  ctx.arc(cx - character.headRadius * 0.35, headY - 4, 3.4, 0, Math.PI * 2)
  ctx.fillStyle = character.hairHighlight
  ctx.fill()

  // Face
  ctx.beginPath()
  ctx.arc(cx + player.facing * 5, headY + 2, 2.4, 0, Math.PI * 2)
  ctx.fillStyle = "#3f302b"
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx + player.facing * 4, headY + 6, 3.4, 0.15, Math.PI - 0.15)
  ctx.strokeStyle = "#3f302b"
  ctx.lineWidth = 1.4
  ctx.stroke()
}

function drawHazardHint(ctx: CanvasRenderingContext2D, world: World): void {
  // Reads the level's own death zones, so the warning stripe can never disagree
  // with the geometry that actually kills the player.
  ctx.fillStyle = "rgba(63, 48, 43, 0.22)"
  for (const hazard of world.level.hazards) {
    ctx.fillRect(hazard.x, world.level.groundY - 4, hazard.w, 4)
  }
}

/* ------------------------------------------------------------------ *
 * Public entry point
 * ------------------------------------------------------------------ */

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  world: World,
  viewport: Viewport,
  elapsed: number,
  character: GameCharacter,
): void {
  const level: Level = world.level
  ctx.save()

  /*
   * Frame reset.
   *
   * The drawing transform is scaled (device pixel ratio x the level scale), so
   * clearing in *world* units only erases the part of the backing store that
   * happens to fall inside the scaled rectangle — everything below and to the
   * right of it survives from the previous frame, and the moving character
   * leaves a translucent copy of itself behind on every step. That is the
   * ghosting/trail artifact.
   *
   * The fix is to reset the transform, clear the whole backing store in device
   * pixels, and only then restore the world transform. Composite state and alpha
   * are reset at the same time so a frame can never inherit them from the last
   * one.
   */
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = "source-over"
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()
  ctx.save()

  drawSky(ctx, level, viewport)
  drawDecor(ctx, world, viewport, elapsed)

  ctx.save()
  ctx.translate(-world.cameraX, 0)

  drawSolids(ctx, level)
  drawCeilings(ctx, level)
  drawHazardHint(ctx, world)

  const allOpen = level.gates.every((gate) => gate.opened)
  drawGoal(ctx, level.goal, level, allOpen, elapsed)

  level.checkpoints.forEach((checkpoint) => drawCheckpoint(ctx, checkpoint, level))
  level.movers.forEach((mover) => drawMover(ctx, mover, level))
  level.gates.forEach((gate) => drawGate(ctx, gate, level, elapsed))
  level.orbs.forEach((orb) => {
    if (!orb.taken) drawOrb(ctx, orb, level, elapsed)
  })

  for (const particle of world.particles) {
    const alpha = Math.max(0, particle.life / particle.maxLife)
    ctx.globalAlpha = alpha
    ctx.fillStyle = particle.color
    ctx.beginPath()
    ctx.arc(particle.x, particle.y, 4 * alpha + 1.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  drawPlayer(ctx, world.player, character, elapsed)
  ctx.restore()

  // Progress ribbon
  const openedGates = level.gates.filter((gate) => gate.opened).length
  const total = Math.max(1, level.gates.length)
  ctx.fillStyle = "rgba(63, 48, 43, 0.14)"
  ctx.fillRect(0, 0, viewport.width, 6)
  ctx.fillStyle = level.map.palette.accent
  ctx.fillRect(0, 0, (viewport.width * openedGates) / total, 6)

  ctx.restore()
}

export { LEVEL_HEIGHT, PLAYER_W, PLAYER_H }
