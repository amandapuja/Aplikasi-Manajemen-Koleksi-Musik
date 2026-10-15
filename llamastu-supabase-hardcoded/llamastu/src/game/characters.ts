/**
 * Playable characters.
 *
 * These are genuinely different models, not a recolour: they differ in silhouette
 * (shoulder width, torso taper, leg length), hair shape, outfit construction and
 * the way they animate while idle, walking, jumping and landing.
 */

export type CharacterId = "male" | "female"

export type GameCharacter = {
  id: CharacterId
  name: string
  title: string
  blurb: string
  /** Body silhouette. */
  shoulderWidth: number
  torsoHeight: number
  torsoTaper: number
  legLength: number
  headRadius: number
  /** Hair. */
  hairStyle: "short" | "long"
  hairColor: string
  hairHighlight: string
  /** Outfit. */
  outfit: string
  outfitAccent: string
  trousers: string
  shoes: string
  backpack: string
  /** Animation character. */
  walkAmplitude: number
  idleBob: number
}

export const GAME_CHARACTERS: GameCharacter[] = [
  {
    id: "male",
    name: "Raka",
    title: "The Pathfinder",
    blurb: "Broader frame and a short cropped cut. Runs with a longer stride.",
    shoulderWidth: 20,
    torsoHeight: 25,
    torsoTaper: 3,
    legLength: 17,
    headRadius: 13,
    hairStyle: "short",
    hairColor: "#5c3a26",
    hairHighlight: "#7a4f33",
    outfit: "#4f7f6a",
    outfitAccent: "#d9a55c",
    trousers: "#3f5a6b",
    shoes: "#8a5a37",
    backpack: "#a97045",
    walkAmplitude: 7,
    idleBob: 1.1,
  },
  {
    id: "female",
    name: "Nara",
    title: "The Scholar",
    blurb: "Taller silhouette with long hair and a flared tunic. Lighter on her feet.",
    shoulderWidth: 16,
    torsoHeight: 24,
    torsoTaper: 6,
    legLength: 19,
    headRadius: 12,
    hairStyle: "long",
    hairColor: "#7a4a2d",
    hairHighlight: "#a86a42",
    outfit: "#c4566f",
    outfitAccent: "#f2d3a1",
    trousers: "#8f5f7a",
    shoes: "#6b4a5c",
    backpack: "#d97b8e",
    walkAmplitude: 6,
    idleBob: 1.5,
  },
]

export function getCharacter(id: string | null | undefined): GameCharacter {
  return GAME_CHARACTERS.find((character) => character.id === id) ?? GAME_CHARACTERS[0]
}

export function isKnownCharacter(id: string | null | undefined): boolean {
  return GAME_CHARACTERS.some((character) => character.id === id)
}
