import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { api } from "../lib/api"
import { Icon } from "../components/Icon"
import { Button, Mascot, Progress } from "../components/common"
import { formatDate } from "../lib/rules"
import type { GameProgress, Material, Question } from "../types"
import { GAME_CHARACTERS, getCharacter } from "./characters"
import {
  createWorld,
  openGate,
  resetSession,
  stepWorld,
  updateCamera,
  worldSnapshot,
  type Input,
  type World,
  type WorldEvent,
} from "./engine"
import { LEVEL_HEIGHT } from "./constants"
import { buildLevel } from "./level"
import { getMap, gatesForMap, MAPS } from "./maps"
import { canvasMetrics, renderWorld } from "./render"

type Step = "loading" | "character" | "map" | "playing"

type Props = {
  material: Material
  refresh: () => Promise<void>
  toast: (message: string, error?: boolean) => void
  onExit: () => void
  preferredCharacter?: string
}

type HudState = {
  gatesOpened: number
  gatesTotal: number
  orbs: number
  orbTotal: number
  sessionXp: number
  finished: boolean
  deaths: number
  status: World["status"]
}

type Pending = {
  gates: Set<string>
  revealedGates: Set<string>
  collectibles: Set<string>
  checkpoints: Set<string>
  finished: boolean
  dirty: boolean
}

const emptyPending = (): Pending => ({
  gates: new Set(),
  revealedGates: new Set(),
  collectibles: new Set(),
  checkpoints: new Set(),
  finished: false,
  dirty: false,
})

const REVEAL_AFTER_ATTEMPTS = 3
const SAVE_DEBOUNCE_MS = 900

export function GameWorld({ material, refresh, toast, onExit, preferredCharacter }: Props) {
  const [step, setStep] = useState<Step>("loading")
  const [characterId, setCharacterId] = useState(preferredCharacter ?? "male")
  const [mapId, setMapId] = useState("")
  const [loadError, setLoadError] = useState("")
  const [hud, setHud] = useState<HudState>({
    gatesOpened: 0,
    gatesTotal: 0,
    orbs: 0,
    orbTotal: 0,
    sessionXp: 0,
    finished: false,
    deaths: 0,
    status: "playing",
  })
  const [challenge, setChallenge] = useState<{ gateId: string; question: Question } | null>(null)
  const [wrongPicks, setWrongPicks] = useState<number[]>([])
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle")
  const [summary, setSummary] = useState<{
    xp: number
    orbs: number
    orbTotal: number
    gates: number
    seconds: number
  } | null>(null)
  const [reminderAdded, setReminderAdded] = useState(false)
  /**
   * Browsers stop requestAnimationFrame for hidden tabs, so the world freezes
   * while the learner is away. Surfacing that explicitly turns a silent stall
   * into a clear, resumable state instead of a canvas that looks broken.
   */
  const [tabHidden, setTabHidden] = useState(
    typeof document !== "undefined" ? document.hidden : false,
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const worldRef = useRef<World | null>(null)
  /**
   * The one loop that is allowed to drive this canvas.
   *
   * A remount, a map change or a re-render must never leave an older animation
   * loop alive: two loops stepping and drawing the same world is what makes the
   * character appear more than once and what doubles the simulation.
   */
  const frameRef = useRef(0)
  const loopOwnerRef = useRef<symbol | null>(null)
  const inputRef = useRef<Input>({ left: false, right: false, jump: false })
  const pendingRef = useRef<Pending>(emptyPending())
  const saveTimerRef = useRef<number | null>(null)
  const challengeRef = useRef(false)
  const startedAtRef = useRef(0)
  const toastRef = useRef(toast)
  const refreshRef = useRef(refresh)

  toastRef.current = toast
  refreshRef.current = refresh

  const questionsById = useMemo(() => {
    const map = new Map<string, Question>()
    material.questions.forEach((question) => map.set(question.id, question))
    return map
  }, [material.questions])

  const activeMap = mapId ? getMap(mapId) : null
  const character = useMemo(() => getCharacter(characterId), [characterId])

  /* ---------------- save pipeline ---------------- */

  const flush = useCallback(
    async () => {
      const pending = pendingRef.current
      if (!pending.dirty || !mapId) return
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      const world = worldRef.current
      const payload = {
        materialId: material.id,
        mapId,
        characterId,
        orbTotal: world?.level.orbCount ?? 0,
        elapsedSeconds: Math.round((Date.now() - startedAtRef.current) / 1000),
        events: {
          gates: Array.from(pending.gates),
          revealedGates: Array.from(pending.revealedGates),
          collectibles: Array.from(pending.collectibles),
          checkpoints: Array.from(pending.checkpoints),
          finished: pending.finished,
          position: world?.player.x ?? 0,
        },
      }
      pendingRef.current = emptyPending()
      setSaveState("saving")
      try {
        await api("/game-progress", { method: "POST", body: JSON.stringify(payload) })
        setSaveState("saved")
        await refreshRef.current()
      } catch (reason) {
        setSaveState("failed")
        toastRef.current(
          reason instanceof Error
            ? `Progress could not be saved: ${reason.message}`
            : "Progress could not be saved.",
          true,
        )
      }
    },
    [material.id, mapId, characterId],
  )

  const scheduleSave = useCallback(() => {
    pendingRef.current.dirty = true
    setSaveState("saving")
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      void flush()
    }, SAVE_DEBOUNCE_MS)
  }, [flush])

  /* ---------------- load one world ---------------- */

  const loadWorld = useCallback(
    async (nextMapId: string, nextCharacterId: string) => {
      setLoadError("")
      setSummary(null)
      setReminderAdded(false)
      setStep("loading")
      try {
        const saved = await api<GameProgress>(`/game-progress/${material.id}/${nextMapId}`)
        const level = buildLevel(material, getMap(nextMapId), saved.openedGates ?? [])
        const restored = {
          openedGates: saved.openedGates ?? [],
          collected: saved.collected ?? [],
          checkpoints: saved.checkpoints ?? [],
          finished: saved.finished ?? false,
        }
        const world = createWorld(level, restored)
        /**
         * Opening a map always begins a NEW gameplay session.
         *
         * Earned progress is kept — unlocked gates, collected orbs and reached
         * checkpoints come back exactly as saved — but the session state is
         * reset: a fresh spawn at the right checkpoint, zeroed velocity and
         * timers, an empty particle list, no active challenge, no leftover
         * death counter and a session SP counter of 0. Reopening a finished map
         * therefore gives a playable world rather than a frozen one, and
         * replaying can never re-award XP because the reward keys are unchanged.
         */
        resetSession(world, restored)
        worldRef.current = world
        startedAtRef.current = Date.now()
        setCharacterId(nextCharacterId)
        setMapId(nextMapId)
        setHud({
          gatesOpened: level.gates.filter((gate) => gate.opened).length,
          gatesTotal: level.gates.length,
          orbs: level.orbs.filter((orb) => orb.taken).length,
          orbTotal: level.orbCount,
          sessionXp: 0,
          finished: world.status === "finished",
          deaths: 0,
          status: world.status,
        })
        setSaveState("idle")
        setStep("playing")
      } catch (reason) {
        setLoadError(reason instanceof Error ? reason.message : "The world could not be loaded.")
      }
    },
    [material],
  )

  useEffect(() => {
    if (preferredCharacter) setCharacterId(preferredCharacter)
    setStep("character")
  }, [material.id, preferredCharacter])

  /* ---------------- input ---------------- */

  useEffect(() => {
    const claimFocus = () => {
      const active = document.activeElement as HTMLElement | null
      if (!active || active === document.body) return
      if (containerRef.current?.contains(active)) return
      const tag = active.tagName.toLowerCase()
      if (tag === "button" || tag === "a") containerRef.current?.focus({ preventScroll: true })
    }

    const isGameKey = (key: string) =>
      key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "ArrowUp" ||
      key === " " ||
      ["a", "d", "w"].includes(key.toLowerCase())

    const down = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key
      const lower = key.toLowerCase()
      if (isGameKey(key)) {
        claimFocus()
        if (!challengeRef.current) event.preventDefault()
      }
      if (key === "ArrowLeft" || lower === "a") {
        inputRef.current.left = true
        inputRef.current.right = false
      } else if (key === "ArrowRight" || lower === "d") {
        inputRef.current.right = true
        inputRef.current.left = false
      } else if (key === " " || key === "ArrowUp" || lower === "w") {
        inputRef.current.jump = true
      }
    }
    const up = (event: KeyboardEvent) => {
      const key = event.key
      const lower = key.toLowerCase()
      if (key === "ArrowLeft" || lower === "a") inputRef.current.left = false
      else if (key === "ArrowRight" || lower === "d") inputRef.current.right = false
      else if (key === " " || key === "ArrowUp" || lower === "w") inputRef.current.jump = false
    }
    const release = () => {
      inputRef.current = { left: false, right: false, jump: false }
    }
    const onVisibility = () => {
      release()
      setTabHidden(document.hidden)
    }

    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", release)
    document.addEventListener("visibilitychange", onVisibility)

    // Also bind to the stage itself so keys still arrive when the game area
    // holds focus inside an embedded context where they do not bubble to the
    // window (for example when the app is framed).
    const stage = containerRef.current
    stage?.addEventListener("keydown", down as EventListener)
    stage?.addEventListener("keyup", up as EventListener)

    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", release)
      document.removeEventListener("visibilitychange", onVisibility)
      stage?.removeEventListener("keydown", down as EventListener)
      stage?.removeEventListener("keyup", up as EventListener)
    }
  }, [])

  useEffect(() => {
    challengeRef.current = Boolean(challenge)
    if (challenge) inputRef.current = { left: false, right: false, jump: false }
  }, [challenge])

  useEffect(() => {
    if (step !== "playing") return
    containerRef.current?.focus({ preventScroll: true })
  }, [step])

  /* ---------------- game loop ---------------- */

  useEffect(() => {
    if (step !== "playing") return
    const canvas = canvasRef.current
    const container = containerRef.current
    const world = worldRef.current
    if (!canvas || !container || !world) return
    const context = canvas.getContext("2d")
    if (!context) {
      setLoadError("This browser cannot render the adventure canvas.")
      return
    }

    const owner = Symbol("llamastu-world-loop")
    loopOwnerRef.current = owner

    let last = performance.now()
    let accumulator = 0
    let disposed = false
    /**
     * The drawing transform scales world units by `dpr * (cssHeight / LEVEL_HEIGHT)`,
     * so the visible world is `cssWidth / scale` wide and exactly LEVEL_HEIGHT
     * tall — NOT `cssWidth x cssHeight`. Reporting the wrong rectangle here is
     * what left the lower part of the canvas unpainted and uncleared, and it is
     * the reason the character used to smear a translucent copy of itself across
     * the screen.
     */
    let viewport = { width: 800, height: LEVEL_HEIGHT }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cssWidth = container.clientWidth || 800
      const cssHeight = container.clientHeight || 420
      const metrics = canvasMetrics(cssWidth, cssHeight, dpr)
      canvas.width = metrics.pixelWidth
      canvas.height = metrics.pixelHeight
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
      context.setTransform(metrics.transformScale, 0, 0, metrics.transformScale, 0, 0)
      viewport = metrics.viewport
      world.viewWidth = metrics.viewport.width
    }

    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    const handleEvents = (events: WorldEvent[]) => {
      const pending = pendingRef.current
      let immediate = false
      for (const event of events) {
        if (event.type === "orb") {
          pending.collectibles.add(event.id)
          pending.dirty = true
        } else if (event.type === "checkpoint") {
          pending.checkpoints.add(event.id)
          pending.dirty = true
          immediate = true
        } else if (event.type === "gate-trigger") {
          const question = questionsById.get(event.questionId)
          const gate = world.level.gates.find((item) => item.id === event.gateId) ?? null
          if (question && gate) {
            setChallenge({ gateId: gate.id, question })
            setWrongPicks([])
            setFeedback(null)
          }
        } else if (event.type === "goal") {
          pending.finished = true
          pending.dirty = true
          immediate = true
          setSummary({
            xp: world.sessionXp,
            orbs: world.level.orbs.filter((orb) => orb.taken).length,
            orbTotal: world.level.orbCount,
            gates: world.level.gates.length,
            seconds: Math.round((Date.now() - startedAtRef.current) / 1000),
          })
          toastRef.current("Map completed. Your progress has been saved.")
        } else if (event.type === "died") {
          toastRef.current("You fell. Back to the last checkpoint.", true)
        }
      }
      if (pending.dirty) {
        if (immediate) void flush()
        else scheduleSave()
      }
      const snapshot = worldSnapshot(world)
      setHud({
        gatesOpened: snapshot.openedGates.length,
        gatesTotal: world.level.gates.length,
        orbs: snapshot.collected.length,
        orbTotal: snapshot.orbCount,
        sessionXp: world.sessionXp,
        finished: snapshot.finished,
        deaths: world.deaths,
        status: snapshot.status,
      })
    }

    const loop = (timestamp: number) => {
      // Anyone other than the newest loop stops scheduling immediately, so a
      // superseded loop can never draw one more frame over the current one.
      if (disposed || loopOwnerRef.current !== owner) return
      const elapsedSeconds = Math.min((timestamp - last) / 1000, 0.5)
      last = timestamp
      accumulator += elapsedSeconds

      let events: WorldEvent[] = []
      let steps = 0
      while (accumulator >= 1 / 120 && steps < 12) {
        events = events.concat(stepWorld(world, inputRef.current, 1 / 120))
        accumulator -= 1 / 120
        steps += 1
      }
      if (steps > 0) updateCamera(world, elapsedSeconds)
      if (events.length) handleEvents(events)

      renderWorld(context, world, viewport, timestamp / 1000, character)
      frameRef.current = window.requestAnimationFrame(loop)
    }

    frameRef.current = window.requestAnimationFrame(loop)

    return () => {
      disposed = true
      window.cancelAnimationFrame(frameRef.current)
      if (loopOwnerRef.current === owner) loopOwnerRef.current = null
      observer.disconnect()
      // Only clear the ref if it still points at THIS world: switching maps
      // assigns the next world before the previous effect tears down, and
      // clearing it blindly would wipe the world that is about to be played.
      if (worldRef.current === world) worldRef.current = null
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      // Anything earned is flushed, then the session state is discarded. The
      // saved rows are untouched, so a reopen restores gates, orbs and
      // checkpoints while starting a genuinely new session.
      if (pendingRef.current.dirty) void flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mapId, material.id, character])

  useEffect(
    () => () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    },
    [],
  )

  /* ---------------- challenge ---------------- */

  async function persistCharacter(model: string) {
    try {
      await api("/character", { method: "PATCH", body: JSON.stringify({ model }) })
      await refreshRef.current()
    } catch {
      // A failed preference write must never block play.
    }
  }

  function answer(choiceIndex: number) {
    if (!challenge) return
    const world = worldRef.current
    if (!world) return
    if (choiceIndex === challenge.question.answerIndex) {
      const gate = world.level.gates.find((item) => item.id === challenge.gateId)
      if (gate) {
        openGate(world, gate)
        pendingRef.current.gates.add(gate.questionId)
        pendingRef.current.dirty = true
      }
      setFeedback({ text: challenge.question.explanation, ok: true })
      setChallenge(null)
      setWrongPicks([])
      toast("Gate opened. +30 XP")
      void flush()
      return
    }
    setWrongPicks((current) => (current.includes(choiceIndex) ? current : [...current, choiceIndex]))
    setFeedback({ text: `Not quite. ${challenge.question.explanation}`, ok: false })
  }

  function revealAnswer() {
    if (!challenge) return
    const world = worldRef.current
    if (!world) return
    const gate = world.level.gates.find((item) => item.id === challenge.gateId)
    if (gate) {
      openGate(world, gate)
      pendingRef.current.revealedGates.add(gate.questionId)
      pendingRef.current.dirty = true
    }
    setChallenge(null)
    setWrongPicks([])
    setFeedback(null)
    toast("Gate opened without XP so you can continue.", false)
    void flush()
  }

  async function addReviewReminder() {
    if (!activeMap) return
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000)
    start.setHours(19, 0, 0, 0)
    const end = new Date(start.getTime() + 45 * 60 * 1000)
    try {
      await api("/calendar", {
        method: "POST",
        body: JSON.stringify({
          title: `Review: ${material.title || material.name} — ${activeMap.name}`,
          description: `Practice run on the ${activeMap.name} world.`,
          category: "review",
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          reminderMinutes: 15,
          repeatRule: "none",
          materialId: material.id,
        }),
      })
      await refreshRef.current()
      setReminderAdded(true)
      toast(`Review reminder scheduled for ${formatDate(start.toISOString())}.`)
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "The reminder could not be created.", true)
    }
  }

  /* ---------------- screens ---------------- */

  if (material.questions.length === 0) {
    return (
      <div className="card">
        <Mascot pose="study" />
        <h2>No challenge gates yet</h2>
        <p className="muted">
          This material has no generated questions, so there is no world to build. Regenerate the
          material from the library first.
        </p>
        <Button variant="secondary" onClick={onExit}>
          Back to materials
        </Button>
      </div>
    )
  }

  if (step === "character") {
    return (
      <div className="game-setup">
        <div className="section-head">
          <div>
            <span className="eyebrow">STEP 1 OF 2</span>
            <h2>Choose Your Character</h2>
          </div>
          <Button variant="ghost" onClick={onExit}>
            Back to workspace
          </Button>
        </div>
        <p className="muted">
          Characters have different builds and animations. Your choice is remembered on your
          profile.
        </p>
        <div className="character-select-grid">
          {GAME_CHARACTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`character-select-card ${characterId === option.id ? "selected" : ""}`}
              onClick={() => {
                setCharacterId(option.id)
                void persistCharacter(option.id)
              }}
              aria-pressed={characterId === option.id}
            >
              <div className={`character-portrait portrait-${option.id}`}>
                <svg viewBox="0 0 120 160" role="img" aria-label={`${option.name} portrait`}>
                  <ellipse cx="60" cy="150" rx="30" ry="7" fill="rgba(63,48,43,0.16)" />
                  <rect
                    x={60 - option.shoulderWidth / 2}
                    y="72"
                    width={option.shoulderWidth}
                    height={option.torsoHeight}
                    rx="7"
                    fill={option.outfit}
                  />
                  <rect x="52" y="96" width="7" height={option.legLength} rx="3" fill={option.trousers} />
                  <rect x="61" y="96" width="7" height={option.legLength} rx="3" fill={option.trousers} />
                  <rect x="50" y={96 + option.legLength} width="10" height="6" rx="3" fill={option.shoes} />
                  <rect x="60" y={96 + option.legLength} width="10" height="6" rx="3" fill={option.shoes} />
                  {option.hairStyle === "long" && (
                    <ellipse cx="60" cy="48" rx={option.headRadius + 4} ry="22" fill={option.hairColor} />
                  )}
                  <circle cx="60" cy="40" r={option.headRadius} fill="#f2cfae" />
                  <path
                    d={`M ${60 - option.headRadius - 1} 40 A ${option.headRadius + 1} ${option.headRadius + 1} 0 0 1 ${60 + option.headRadius + 1} 40 Z`}
                    fill={option.hairColor}
                  />
                  <circle cx="54" cy="40" r="2.6" fill="#3f302b" />
                  <circle cx="66" cy="40" r="2.6" fill="#3f302b" />
                  {option.id === "female" ? (
                    <path d="M48 96 L72 96 L76 106 L44 106 Z" fill={option.outfitAccent} />
                  ) : (
                    <rect x={60 - option.shoulderWidth / 2} y="72" width={option.shoulderWidth} height="6" rx="3" fill={option.outfitAccent} />
                  )}
                </svg>
              </div>
              <b>{option.name}</b>
              <span className="character-role">{option.title}</span>
              <p>{option.blurb}</p>
              {characterId === option.id && (
                <span className="selected-flag">
                  <Icon name="check" size={12} /> Selected
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="game-setup-actions">
          <Button onClick={() => setStep("map")}>Continue to map selection</Button>
        </div>
      </div>
    )
  }

  if (step === "map") {
    return (
      <div className="game-setup">
        <div className="section-head">
          <div>
            <span className="eyebrow">STEP 2 OF 2</span>
            <h2>Choose a Map</h2>
          </div>
          <Button variant="ghost" onClick={() => setStep("character")}>
            <Icon name="chevron-left" size={15} /> Change character
          </Button>
        </div>
        <p className="muted">
          Playing as <b>{character.name}</b>. Every map runs on the same material, so the questions
          always come from <b>{material.title || material.name}</b>.
        </p>
        <div className="map-select-grid">
          {MAPS.map((map) => {
            const gates = gatesForMap(map, material.questions.length)
            return (
              <button
                key={map.id}
                type="button"
                className="map-select-card"
                onClick={() => void loadWorld(map.id, characterId)}
              >
                <div className={`map-preview map-preview-${map.id}`}>
                  <span className="map-sky" style={{ background: map.palette.skyTop }} />
                  <span className="map-ground" style={{ background: map.palette.groundBody }} />
                  <span className="map-accent" style={{ background: map.palette.accent }} />
                  <span className={`map-difficulty difficulty-${map.difficulty.toLowerCase()}`}>
                    {map.difficulty}
                  </span>
                </div>
                <div className="map-card-body">
                  <small>{map.tagline}</small>
                  <b>{map.name}</b>
                  <p>{map.description}</p>
                  <dl>
                    <div>
                      <dt>Objective</dt>
                      <dd>{map.objective}</dd>
                    </div>
                    <div>
                      <dt>Challenges</dt>
                      <dd>{gates} gates from your material</dd>
                    </div>
                    <div>
                      <dt>Collectibles</dt>
                      <dd>{map.collectibleName}</dd>
                    </div>
                  </dl>
                </div>
                <span className="map-start">
                  Start <Icon name="play" size={13} />
                </span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="card">
        <Mascot pose="study" />
        <h2>The adventure world could not open</h2>
        <p className="muted">{loadError}</p>
        <div className="game-modal-actions">
          <Button onClick={() => setStep("map")}>Choose another map</Button>
          <Button variant="secondary" onClick={onExit}>
            Back to materials
          </Button>
        </div>
      </div>
    )
  }

  if (summary) {
    const minutes = Math.floor(summary.seconds / 60)
    const seconds = summary.seconds % 60
    return (
      <div className="map-complete card">
        <Mascot pose="celebrate" />
        <span className="eyebrow">MAP COMPLETED</span>
        <h2>{activeMap?.name}</h2>
        <p className="muted">{material.title || material.name}</p>
        <div className="complete-stats">
          <div>
            <b>{summary.gates}</b>
            <span>Challenges cleared</span>
          </div>
          <div>
            <b>
              {summary.orbs}/{summary.orbTotal}
            </b>
            <span>{activeMap?.collectibleName}</span>
          </div>
          <div>
            <b>+{summary.xp}</b>
            <span>XP this run</span>
          </div>
          <div>
            <b>
              {minutes}:{String(seconds).padStart(2, "0")}
            </b>
            <span>Time</span>
          </div>
        </div>
        <div className="complete-actions">
          <Button onClick={() => void loadWorld(mapId, characterId)}>Play again</Button>
          <Button variant="secondary" onClick={() => setStep("map")}>
            Choose another map
          </Button>
          <Button variant="ghost" icon="calendar" onClick={addReviewReminder} disabled={reminderAdded}>
            {reminderAdded ? "Review reminder added" : "Add review reminder"}
          </Button>
        </div>
        <p className="muted small">
          Replaying is always available. XP for a gate, a collectible or a finished map is only ever
          granted once per account, so practice runs cannot farm XP.
        </p>
      </div>
    )
  }

  return (
    <div className="learning-world">
      <div className="world-hud">
        <div>
          <small>WORLD</small>
          <b>{activeMap?.name}</b>
        </div>
        <div>
          <small>PLAYING AS</small>
          <b>{character.name}</b>
        </div>
        <div>
          <small>GATES</small>
          <b>
            {hud.gatesOpened}/{hud.gatesTotal}
          </b>
        </div>
        <div>
          <small>COLLECTED</small>
          <b>
            {hud.orbs}/{hud.orbTotal}
          </b>
        </div>
        <div>
          <small>SESSION XP</small>
          <b>+{hud.sessionXp}</b>
        </div>
        <div>
          <small>SAVE</small>
          <b>
            {saveState === "saving" ? "Saving…" : saveState === "failed" ? "Retrying" : "Saved"}
          </b>
        </div>
      </div>

      <div
        className="game-stage"
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-label={`${activeMap?.name} world for ${material.title || material.name}. Use A and D or the arrow keys to move, Space to jump.`}
      >
        <canvas ref={canvasRef} className="game-canvas" />
        {step === "loading" && (
          <div className="game-loading">
            <Mascot pose="reading" />
            <p>Building your world…</p>
          </div>
        )}
        {hud.finished && (
          <div className="game-complete-banner">
            <b>World complete</b>
            <span>
              {hud.orbs}/{hud.orbTotal} collected · saving to your account
            </span>
          </div>
        )}
        {tabHidden && step === "playing" && (
          <div className="game-paused" role="status">
            <Icon name="play" size={22} />
            <b>Paused</b>
            <span>Switch back to this tab to keep playing. Your progress is already saved.</span>
          </div>
        )}
      </div>

      <div className="world-controls">
        <div className="touch-pad">
          <button
            type="button"
            aria-label="Move left"
            onPointerDown={(event) => {
              event.preventDefault()
              inputRef.current.left = true
            }}
            onPointerUp={() => {
              inputRef.current.left = false
            }}
            onPointerLeave={() => {
              inputRef.current.left = false
            }}
            onPointerCancel={() => {
              inputRef.current.left = false
            }}
          >
            <Icon name="chevron-left" />
          </button>
          <button
            type="button"
            aria-label="Move right"
            onPointerDown={(event) => {
              event.preventDefault()
              inputRef.current.right = true
            }}
            onPointerUp={() => {
              inputRef.current.right = false
            }}
            onPointerLeave={() => {
              inputRef.current.right = false
            }}
            onPointerCancel={() => {
              inputRef.current.right = false
            }}
          >
            <Icon name="chevron-right" />
          </button>
        </div>
        <span className="control-hint">
          <b>A</b> / <b>←</b> left · <b>D</b> / <b>→</b> right · <b>Space</b> / <b>↑</b> jump. Gates
          block the path until you answer.
        </span>
        <div className="touch-pad">
          <button
            type="button"
            className="jump"
            aria-label="Jump"
            onPointerDown={(event) => {
              event.preventDefault()
              inputRef.current.jump = true
            }}
            onPointerUp={() => {
              inputRef.current.jump = false
            }}
            onPointerLeave={() => {
              inputRef.current.jump = false
            }}
            onPointerCancel={() => {
              inputRef.current.jump = false
            }}
          >
            JUMP
          </button>
        </div>
      </div>

      <div className="world-progress-row">
        <Progress value={hud.gatesTotal ? Math.round((hud.gatesOpened / hud.gatesTotal) * 100) : 0} />
        <span>
          {hud.deaths > 0 ? `${hud.deaths} respawn${hud.deaths === 1 ? "" : "s"}` : "No deaths yet"}
        </span>
        <Button variant="ghost" onClick={() => setStep("map")}>
          Change map
        </Button>
      </div>

      {challenge && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Challenge gate">
          <div className="modal card gap-modal">
            <div className="section-head">
              <div>
                <span className="eyebrow">GATE CHALLENGE</span>
                <h2>Answer to open the gate</h2>
              </div>
              <span className="gate-badge">+30 XP</span>
            </div>
            <p className="gate-question">{challenge.question.question}</p>
            <div className="answer-grid">
              {challenge.question.choices.map((choice, index) => {
                const isWrong = wrongPicks.includes(index)
                return (
                  <button
                    key={`${choice}-${index}`}
                    type="button"
                    className={isWrong ? "wrong" : ""}
                    disabled={isWrong}
                    onClick={() => answer(index)}
                  >
                    <i>{String.fromCharCode(65 + index)}</i>
                    <span>{choice}</span>
                  </button>
                )
              })}
            </div>
            {feedback && (
              <div className={feedback.ok ? "challenge-feedback ok" : "challenge-feedback"}>
                <b>{feedback.ok ? "Correct — the gate is opening." : "Not quite yet."}</b>
                <p>{feedback.text}</p>
              </div>
            )}
            <div className="game-modal-actions">
              {wrongPicks.length >= REVEAL_AFTER_ATTEMPTS && (
                <Button variant="secondary" onClick={revealAnswer}>
                  Show me the answer
                </Button>
              )}
              <Button variant="ghost" onClick={onExit}>
                Leave the world
              </Button>
            </div>
            <p className="muted small">
              The gate stays closed until the challenge is solved. Wrong answers are disabled so you
              can keep trying.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default GameWorld
