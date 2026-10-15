/**
 * Map catalogue.
 *
 * A map owns the *environment*: palette, physics, layout recipe and the style
 * of its obstacles. The material always owns the *content*: every question,
 * orb label and challenge inside a map comes from the uploaded document, so a
 * "Cooking Kitchen" level about normalisation asks database questions, never
 * random cooking trivia.
 *
 * Five maps ship by default and they differ structurally, not just visually:
 * layout recipe, gravity, gate width, platform rhythm and optional mechanics.
 */

export type MapMechanic = "none" | "moving-platforms" | "low-ceiling" | "stepping-stones" | "counters"

export type MapPalette = {
  skyTop: string
  skyBottom: string
  hillFar: string
  hillNear: string
  groundTop: string
  groundBody: string
  groundDeep: string
  platformTop: string
  platformBody: string
  platformEdge: string
  gateClosed: string
  gateClosedDark: string
  gateOpen: string
  accent: string
  ink: string
  decor: string
}

export type MapDefinition = {
  id: string
  name: string
  tagline: string
  description: string
  environment: string
  theme: string
  difficulty: "Easy" | "Medium" | "Hard"
  objective: string
  /** How many of the material's questions are used as gates in this map. */
  challengeCount: number
  /** Multiplier applied to gravity — the defining feel of the map. */
  gravityScale: number
  /** Ground slab length and pit width range, in world units. */
  runLength: number
  gapMin: number
  gapMax: number
  /** Gate slab width. */
  gateWidth: number
  /** What the orbs represent in this world. */
  collectibleName: string
  mechanic: MapMechanic
  /** Rows of floating geometry the builder should place per section. */
  platformRows: 1 | 2 | 3
  palette: MapPalette
}

const WARM: MapPalette = {
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
  accent: "#d96f4b",
  ink: "#3f302b",
  decor: "hills",
}

export const MAPS: MapDefinition[] = [
  {
    id: "obstacle_adventure",
    name: "Obstacle Adventure",
    tagline: "Classic platformer",
    description:
      "Rolling hills, floating ledges and pits. The original course: run, jump and clear every gate on the way to the finish line.",
    environment: "Rolling green hills",
    theme: "Platform / obstacle course",
    difficulty: "Easy",
    objective: "Reach the finish line.",
    challengeCount: 6,
    gravityScale: 1,
    runLength: 700,
    gapMin: 120,
    gapMax: 168,
    gateWidth: 46,
    collectibleName: "Study orbs",
    mechanic: "none",
    platformRows: 2,
    palette: WARM,
  },
  {
    id: "cooking_kitchen",
    name: "Cooking Kitchen",
    tagline: "Serve every station",
    description:
      "A warm kitchen floor with raised counters. Collect ingredients from the walkways and unlock each cooking station by answering.",
    environment: "Kitchen with counters and tiled floor",
    theme: "Cooking / kitchen",
    difficulty: "Easy",
    objective: "Activate all cooking stations and reach the serving area.",
    challengeCount: 5,
    gravityScale: 1.15,
    // Long enough to fit three counter rows plus the walk-in to the gate.
    runLength: 780,
    gapMin: 96,
    gapMax: 130,
    gateWidth: 58,
    collectibleName: "Ingredients",
    mechanic: "counters",
    platformRows: 3,
    palette: {
      ...WARM,
      skyTop: "#fff6e6",
      skyBottom: "#ffe0bd",
      hillFar: "#f0d3b6",
      hillNear: "#e5bd9c",
      groundTop: "#e8c9a0",
      groundBody: "#d8b183",
      groundDeep: "#c19465",
      platformTop: "#f2e2c8",
      platformBody: "#d9c3a1",
      platformEdge: "#b99b74",
      gateClosed: "#c98f5f",
      gateClosedDark: "#a97045",
      gateOpen: "#e8c9a0",
      accent: "#d9734b",
      decor: "tiles",
    },
  },
  {
    id: "mystery_lab",
    name: "Mystery Lab",
    tagline: "Tight corridors, tight jumps",
    description:
      "A cool laboratory with low ceilings and narrow passages. Switches open the sealed doors that block the corridor.",
    environment: "Laboratory corridors with low ceilings",
    theme: "Laboratory / puzzle",
    difficulty: "Hard",
    objective: "Solve the laboratory challenges and unlock the exit.",
    challengeCount: 8,
    gravityScale: 1.28,
    runLength: 560,
    gapMin: 132,
    gapMax: 168,
    gateWidth: 46,
    collectibleName: "Data samples",
    mechanic: "low-ceiling",
    platformRows: 1,
    palette: {
      ...WARM,
      skyTop: "#e7eef5",
      skyBottom: "#cfdbe6",
      hillFar: "#c3d1de",
      hillNear: "#aebfcd",
      groundTop: "#9aa9b6",
      groundBody: "#8294a3",
      groundDeep: "#6c7d8c",
      platformTop: "#cfe0ea",
      platformBody: "#a9bcc9",
      platformEdge: "#8798a6",
      gateClosed: "#5f7a8c",
      gateClosedDark: "#45606f",
      gateOpen: "#7fa0b5",
      accent: "#4f8fb0",
      ink: "#2c3a44",
      decor: "grid",
    },
  },
  {
    id: "treasure_island",
    name: "Treasure Island",
    tagline: "Cross the water",
    description:
      "Wide water gaps crossed on stepping stones. Every chest is guarded by a challenge — the final one hides the treasure.",
    environment: "Island cliffs and shallow water",
    theme: "Island / adventure",
    difficulty: "Medium",
    objective: "Reach the treasure area.",
    challengeCount: 5,
    gravityScale: 1,
    runLength: 640,
    gapMin: 150,
    gapMax: 178,
    gateWidth: 50,
    collectibleName: "Coins",
    mechanic: "stepping-stones",
    platformRows: 1,
    palette: {
      ...WARM,
      skyTop: "#e9f7ff",
      skyBottom: "#bfe7f5",
      hillFar: "#cbe6de",
      hillNear: "#a8d3c6",
      groundTop: "#e0cf9c",
      groundBody: "#c9b378",
      groundDeep: "#a8945d",
      platformTop: "#e6d6a6",
      platformBody: "#c9b378",
      platformEdge: "#a8945d",
      gateClosed: "#8a6b4a",
      gateClosedDark: "#6b5238",
      gateOpen: "#a8d3c6",
      accent: "#e0a63c",
      decor: "waves",
    },
  },
  {
    id: "space_station",
    name: "Space Station",
    tagline: "Low gravity systems",
    description:
      "Low gravity, drifting platforms and energy gates. Restore each system by answering, then reach the control room.",
    environment: "Space station interior, low gravity",
    theme: "Futuristic space station",
    difficulty: "Medium",
    objective: "Restore the station systems and reach the control room.",
    challengeCount: 6,
    gravityScale: 0.66,
    runLength: 760,
    gapMin: 190,
    gapMax: 250,
    gateWidth: 44,
    collectibleName: "Energy cells",
    mechanic: "moving-platforms",
    platformRows: 3,
    palette: {
      ...WARM,
      skyTop: "#101a2e",
      skyBottom: "#22304d",
      hillFar: "#2c3d5e",
      hillNear: "#3a4f74",
      groundTop: "#5c6f92",
      groundBody: "#445573",
      groundDeep: "#2f3d57",
      platformTop: "#7f93b8",
      platformBody: "#5c6f92",
      platformEdge: "#3f4f6e",
      gateClosed: "#6d6f9c",
      gateClosedDark: "#4d4f75",
      gateOpen: "#7fe0c8",
      accent: "#7fe0c8",
      ink: "#eaf2ff",
      decor: "stars",
    },
  },
]

export const DEFAULT_MAP_ID = MAPS[0].id

export function getMap(mapId: string | null | undefined): MapDefinition {
  return MAPS.find((map) => map.id === mapId) ?? MAPS[0]
}

export function isKnownMap(mapId: string | null | undefined): boolean {
  return MAPS.some((map) => map.id === mapId)
}

/** How many gates this map will actually build for a material. */
export function gatesForMap(map: MapDefinition, questionCount: number): number {
  return Math.max(1, Math.min(map.challengeCount, questionCount))
}
