import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Avatar, Button, Empty, Logo, Mascot, Progress } from "./components/common"
import { Icon } from "./components/Icon"
import {
  api,
  getSession,
  initBackend,
  isUnauthorised,
  signOut,
  subscribeToSession,
  type BackendStatus,
} from "./lib/api"
import { formatDate } from "./lib/rules"
import { setOpenNoteId } from "./lib/uiState"
import { describeRepeat, formatTime, occurrencesInRange } from "./lib/calendar"
import { showReminder } from "./lib/push"
import { Achievements } from "./pages/Achievements"
import { CalendarPage } from "./pages/CalendarPage"
import { AuthScreen } from "./pages/AuthScreen"
import { Dashboard } from "./pages/Dashboard"
import { StudyAssistant } from "./pages/StudyAssistant"
import { Materials } from "./pages/Materials"
import { NotesPage } from "./pages/NotesPage"
import { SchedulePage } from "./pages/SchedulePage"
import { CharactersPage } from "./pages/CharactersPage"
import { SettingsPage } from "./pages/SettingsPage"
import { Workspace } from "./pages/Workspace"
import type { AppData, AuthSession, CalendarEvent, Material, Page } from "./types"

type Boot = "loading" | "fatal" | "ready"

const nav: { page: Page; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { page: "home", label: "Home", icon: "home" },
  { page: "materials", label: "Materials", icon: "folder" },
  { page: "notes", label: "Notes", icon: "edit" },
  { page: "calendar", label: "Calendar", icon: "calendar" },
  { page: "schedule", label: "Timetable", icon: "clock" },
  { page: "characters", label: "Characters", icon: "user" },
  { page: "assistant", label: "Study Assistant", icon: "spark" },
  { page: "achievements", label: "Achievements", icon: "award" },
  { page: "settings", label: "Settings", icon: "settings" },
]

/* ------------------------------------------------------------------ *
 * Welcome / marketing screen
 * ------------------------------------------------------------------ */

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <main className="welcome-page">
      <header>
        <Logo />
        {/* This button opens the account screen, not the demo, so it is labelled
            for what it does. The demo has its own entry on that screen. */}
        <button onClick={onStart}>Sign in</button>
      </header>
      <div className="welcome-decor decor-book">
        <Icon name="book" />
      </div>
      <div className="welcome-decor decor-star">
        <Icon name="spark" />
      </div>
      <section className="welcome-content">
        <span className="welcome-kicker">LEARN · PLAY · GROW</span>
        <h1>
          Study becomes
          <br />
          an adventure.
        </h1>
        <p>
          Turn your own university materials into summaries, flashcards, challenges, and a world you
          can explore.
        </p>
        <Button onClick={onStart}>
          Start learning <Icon name="arrow" />
        </Button>
      </section>
      <section className="welcome-illustration">
        <div className="cozy-chair">
          <div className="chair-back" />
          <div className="chair-seat" />
        </div>
        <div className="welcome-llama">
          <Mascot pose="reading" />
        </div>
        <div className="floating-note note-one">
          <Icon name="file" />
        </div>
        <div className="floating-note note-two">
          <Icon name="spark" />
        </div>
      </section>
      <div className="welcome-footer">
        <span>Real material processing</span>
        <i />
        <span>Playable challenge gates</span>
        <i />
        <span>Collaborative study notes</span>
      </div>
    </main>
  )
}

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

type SearchResult = {
  id: string
  label: string
  hint: string
  page: Page
  material?: Material
  noteId?: string
}

function Shell({
  page,
  setPage,
  data,
  backendStatus,
  dark,
  setDark,
  children,
  refresh,
  openMaterial,
}: {
  page: Page
  setPage: (page: Page) => void
  data: AppData
  backendStatus: BackendStatus
  dark: boolean
  setDark: (value: boolean) => void
  children: React.ReactNode
  refresh: () => Promise<void>
  openMaterial: (material: Material) => void
}) {
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const unread = data.notifications.filter((item) => !item.read).length

  const results = useMemo<SearchResult[]>(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length < 2) return []
    const found: SearchResult[] = []
    data.materials.forEach((material) => {
      if (
        (material.title ?? "").toLowerCase().includes(needle) ||
        material.name.toLowerCase().includes(needle) ||
        (material.subject ?? "").toLowerCase().includes(needle)
      ) {
        found.push({
          id: `m-${material.id}`,
          label: material.title || material.name,
          hint: `Material · ${material.status}`,
          page: "workspace",
          material,
        })
      }
    })
    data.notes.forEach((note) => {
      if (
        note.title.toLowerCase().includes(needle) ||
        note.content.toLowerCase().includes(needle)
      ) {
        found.push({
          id: `n-${note.id}`,
          label: note.title,
          hint: "Note",
          page: "notes",
          noteId: note.id,
        })
      }
    })
    data.schedules.forEach((item) => {
      if (
        item.course.toLowerCase().includes(needle) ||
        (item.room ?? "").toLowerCase().includes(needle)
      ) {
        found.push({
          id: `s-${item.id}`,
          label: item.course,
          hint: `Class · ${formatDate(item.startAt)}`,
          page: "schedule",
        })
      }
    })
    return found.slice(0, 8)
  }, [query, data])

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!searchRef.current?.contains(event.target as Node)) setSearchOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  async function markRead(id: string) {
    try {
      await api(`/notifications/${id}`, { method: "PATCH", body: JSON.stringify({ read: true }) })
      await refresh()
    } catch {
      /* the toast layer reports request failures elsewhere */
    }
  }

  async function markAllRead() {
    await api("/notifications/read-all", { method: "POST" })
    await refresh()
  }

  async function removeNotification(id: string) {
    await api(`/notifications/${id}`, { method: "DELETE" })
    await refresh()
  }

  return (
    <>
      {/* Layout is fully responsive: the shell adapts to the viewport on its
          own, with no device selector exposed to the learner. */}
      <div className={`app-shell ${dark ? "dark" : ""}`}>
        <aside className="sidebar">
          <Logo />
          <nav>
            {nav.map((item) => (
              <button
                key={item.page}
                type="button"
                className={page === item.page ? "active" : ""}
                onClick={() => setPage(item.page)}
                aria-current={page === item.page ? "page" : undefined}
                aria-label={`${item.label} page`}
                title={item.label}
              >
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="streak-card">
            <Icon name="flame" />
            <b>{data.progress.streak} day study streak</b>
            <span>
              {data.progress.streak > 0
                ? "Come back tomorrow to keep it growing."
                : "Upload or answer a question today to start one."}
            </span>
            <Progress value={Math.min(data.progress.streak * 14, 100)} label="Streak progress" />
          </div>
          <button className="profile-mini" onClick={() => setPage("settings")}>
            <Avatar character={data.progress.character} />
            <span>
              <b>{data.profile.name || "Learner"}</b>
              <small>Level {data.progress.level}</small>
            </span>
            <Icon name="settings" size={15} />
          </button>
        </aside>

        <main className="main">
          <header className="topbar">
            <div className="search global-search" ref={searchRef}>
              <Icon name="search" size={16} />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setSearchOpen(true)
                }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Search materials, notes and classes"
                aria-label="Search your library"
                type="search"
              />
              {searchOpen && query.trim().length >= 2 && (
                <div className="search-results">
                  {results.length === 0 ? (
                    <p className="muted">No matches for “{query}”.</p>
                  ) : (
                    results.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => {
                          setSearchOpen(false)
                          setQuery("")
                          if (result.material) openMaterial(result.material)
                          else {
                            if (result.noteId) setOpenNoteId(result.noteId)
                            setPage(result.page)
                          }
                        }}
                      >
                        <Icon name="file" size={15} />
                        <span>
                          <b>{result.label}</b>
                          <small>{result.hint}</small>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="top-actions">
              <button title="Toggle theme" onClick={() => setDark(!dark)} aria-label="Toggle theme">
                <Icon name="moon" size={17} />
              </button>
              <button
                className="notification"
                title="Notifications"
                aria-label={`Notifications, ${unread} unread`}
                onClick={() => setNotificationsOpen(!notificationsOpen)}
              >
                <Icon name="bell" size={17} />
                {unread > 0 && <i />}
              </button>
              <div className="top-avatar">
                <Avatar character={data.progress.character} />
              </div>
            </div>

            {notificationsOpen && (
              <div className="notification-panel">
                <div className="section-head">
                  <div>
                    <span className="eyebrow">ACTIVITY</span>
                    <h2>Notifications</h2>
                  </div>
                  <div className="notice-actions">
                    {unread > 0 && (
                      <button className="text-button" onClick={markAllRead}>
                        Mark all read
                      </button>
                    )}
                    <button
                      onClick={() => setNotificationsOpen(false)}
                      aria-label="Close notifications"
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                </div>
                {data.notifications.length === 0 ? (
                  <p className="muted">
                    No notifications yet. Uploads, quizzes and gates you clear appear here.
                  </p>
                ) : (
                  data.notifications.map((item) => (
                    <div className={item.read ? "notice read" : "notice"} key={item.id}>
                      <button className="notice-body" onClick={() => markRead(item.id)}>
                        <b>{item.title}</b>
                        <span>{item.message}</span>
                        <small>{formatDate(item.createdAt)}</small>
                      </button>
                      <button
                        className="notice-delete"
                        onClick={() => removeNotification(item.id)}
                        aria-label={`Delete notification ${item.title}`}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </header>

          <div className="content">
            {backendStatus.mode === "local" || !backendStatus.supabaseAvailable ? (
              <div className="form-alert error" role="status">
                {backendStatus.mode === "local"
                  ? backendStatus.detail
                  : "Cloud sync is unavailable. Your data remains in Supabase and will not be copied to this device."}
                {backendStatus.reason ? ` ${backendStatus.reason}` : ""}
              </div>
            ) : null}
            {children}
          </div>
        </main>

        <nav className="bottom-nav">
          {nav.slice(0, 5).map((item) => (
            <button
              key={item.page}
              type="button"
              className={page === item.page ? "active" : ""}
              onClick={() => setPage(item.page)}
              aria-label={`${item.label} page`}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Authenticated application
 * ------------------------------------------------------------------ */

function AppContent({
  onLogout,
  backend,
}: {
  onLogout: () => void
  /** Used only to key the session, so a backend switch starts a fresh session. */
  backend: BackendStatus
}) {
  const [data, setData] = useState<AppData | null>(null)
  const [page, setPage] = useState<Page>("home")
  const [activeMaterialId, setActiveMaterialId] = useState("")
  const [loadError, setLoadError] = useState("")
  const [dark, setDarkState] = useState(false)
  const [toastState, setToastState] = useState<{ message: string; error: boolean } | null>(null)
  const toastTimer = useRef<number | null>(null)
  const preferenceInitialized = useRef(false)
  const preferenceSaveQueue = useRef<Promise<void>>(Promise.resolve())
  /** The missed-reminder sweep runs once per session, not on every refresh. */
  const catchUpDone = useRef(false)

  const toast = useCallback((message: string, error = false) => {
    setToastState({ message, error })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastState(null), 5200)
  }, [])

  const setDark = useCallback((value: boolean) => {
    setDarkState(value)
    const saving = preferenceSaveQueue.current
      .catch(() => undefined)
      .then(async () => {
        await api("/preferences", {
          method: "PATCH",
          body: JSON.stringify({ darkMode: value }),
        })
      })
    preferenceSaveQueue.current = saving
    void saving.catch((reason) => {
      toast(
        reason instanceof Error
          ? `Theme preference could not be saved: ${reason.message}`
          : "Theme preference could not be saved.",
        true,
      )
    })
  }, [toast])

  const refresh = useCallback(async () => {
    try {
      const next = await api<AppData>("/bootstrap")
      if (!preferenceInitialized.current) {
        const legacyTheme =
          typeof localStorage !== "undefined" ? localStorage.getItem("llamastu-theme") : null
        const storedDarkMode = next.preferences?.darkMode
        const hasStoredDarkMode = typeof storedDarkMode === "boolean"
        const darkMode = hasStoredDarkMode ? storedDarkMode : legacyTheme === "dark"
        setDarkState(darkMode)
        if (!hasStoredDarkMode) {
          try {
            await api("/preferences", {
              method: "PATCH",
              body: JSON.stringify({ darkMode }),
            })
            if (typeof localStorage !== "undefined") localStorage.removeItem("llamastu-theme")
            preferenceInitialized.current = true
          } catch (reason) {
            toast(
              reason instanceof Error
                ? `Theme preference could not be synced: ${reason.message}`
                : "Theme preference could not be synced.",
              true,
            )
          }
        } else {
          preferenceInitialized.current = true
        }
      }
      setData(next)
      setLoadError("")
    } catch (reason) {
      if (isUnauthorised(reason)) {
        onLogout()
        return
      }
      setLoadError(
        reason instanceof Error
          ? reason.message
          : "Your data could not be loaded. Please try again.",
      )
    }
  }, [onLogout, toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Realtime refresh.
   *
   * Stores raise this event whenever they change something another screen would
   * want to know about — a shared note saved elsewhere in the same browser, a
   * study activity recorded, an achievement unlocked. Re-reading the bootstrap
   * payload keeps every screen on the same numbers instead of each holding its
   * own copy.
   */
  useEffect(() => {
    const onChange = () => {
      void refresh()
    }
    window.addEventListener("llamastu:data-changed", onChange)
    return () => window.removeEventListener("llamastu:data-changed", onChange)
  }, [refresh])

  /**
   * Reminder scheduler.
   *
   * Every timer is derived from a calendar occurrence and its reminder lead
   * time, so editing an event moves its alarm and deleting the event removes
   * its timer on the next render — an orphan reminder is not representable.
   */
  useEffect(() => {
    if (!data) return
    const preferences = data.notificationPreferences
    if (!preferences.enabled || !preferences.agendaReminders) return

    const now = Date.now()
    const horizon = now + 6 * 60 * 60 * 1000
    const occurrences = occurrencesInRange(data.calendarEvents, new Date(now), new Date(horizon))
    const maxDelay = 2_147_483_000

    const timers = occurrences.map((occurrence) => {
      const lead =
        occurrence.event.reminderMinutes >= 0
          ? occurrence.event.reminderMinutes
          : preferences.leadMinutes
      const fireAt = occurrence.start.getTime() - lead * 60_000
      const delay = fireAt - Date.now()
      if (delay <= 0 || delay > maxDelay) return undefined
      const title = occurrence.isRepeat
        ? `${occurrence.event.title} (${describeRepeat(occurrence.event.repeatRule)})`
        : occurrence.event.title
      return window.setTimeout(() => {
        const body = `${formatTime(occurrence.start)} · ${
          lead === 0 ? "starting now" : `starts in ${lead} minutes`
        }`
        // Notification permission and the browser transport are separate from
        // the in-app alert: the toast always shows, and a system notification is
        // added only when the learner has actually enabled it.
        const delivered: Promise<boolean> = preferences.browserPush
          ? showReminder("Study Reminder", `${title}\n${body}`)
          : Promise.resolve(false)
        toast(`Study Reminder — ${title} ${lead === 0 ? "starts now" : `in ${lead} min`}.`)
        // Recording the delivery is what makes a second alert for the same
        // occurrence impossible; a rescheduled event clears the marker so it can
        // fire again at its new time.
        void delivered
          .then((shown) =>
            api(`/reminders/${occurrence.event.id}/delivered`, {
              method: "POST",
              body: JSON.stringify({
                channel: shown ? "browser" : "in-app",
                status: "delivered",
                detail: `lead ${lead} min`,
              }),
            }),
          )
          .catch(() => undefined)
      }, delay)
    })

    return () => timers.forEach((timer) => timer && window.clearTimeout(timer))
  }, [data, toast])

  /**
   * Catch-up for reminders that came due while no tab was open.
   *
   * A timer cannot run in a closed tab, so on the next open the server is asked
   * which reminders are already due and unsent. Those from the last day are
   * reported as late rather than silently dropped, and each is marked delivered
   * so it cannot be repeated.
   *
   * True background delivery — an alert reaching the device with the site fully
   * closed — needs Web Push with VAPID keys and a scheduled server job; see the
   * README and `.env.example`. This path is the honest fallback when push is not
   * configured.
   */
  useEffect(() => {
    if (!data || catchUpDone.current) return
    const preferences = data.notificationPreferences
    if (!preferences.enabled || !preferences.agendaReminders) return
    catchUpDone.current = true

    ;(async () => {
      try {
        const due = await api<CalendarEvent[]>("/reminders/due?horizonMinutes=0")
        const now = Date.now()
        const missed = due
          .filter((event) => {
            const at = event.reminderAt ? new Date(event.reminderAt).getTime() : Number.NaN
            return Number.isFinite(at) && at <= now && now - at < 24 * 60 * 60 * 1000
          })
          .slice(0, 5)
        for (const event of missed) {
          toast(`Reminder passed while you were away — ${event.title}.`)
          await api(`/reminders/${event.id}/delivered`, {
            method: "POST",
            body: JSON.stringify({
              channel: "in-app",
              status: "delivered",
              detail: "delivered late: the app was opened after the reminder time",
            }),
          })
        }
        if (missed.length) await refresh()
      } catch {
        // Reminders are best-effort; a failure here must never block the app.
      }
    })()
  }, [data, toast, refresh])

  function openMaterial(material: Material) {
    setActiveMaterialId(material.id)
    setPage("workspace")
  }

  const activeMaterial = data?.materials.find((item) => item.id === activeMaterialId)

  if (!data) {
    if (loadError) {
      return (
        <div className="app-loading">
          <Mascot pose="study" />
          <h2>We could not load your study world</h2>
          <p>{loadError}</p>
          <div className="head-actions">
            <Button onClick={() => refresh()}>Try again</Button>
            <Button variant="secondary" onClick={onLogout}>
              Sign out
            </Button>
          </div>
        </div>
      )
    }
    return (
      <div className="app-loading">
        <Mascot pose="reading" />
        <h2>Opening your study world…</h2>
        <p>Loading your saved data.</p>
      </div>
    )
  }

  return (
    <Shell
      page={page}
      setPage={setPage}
      data={data}
      backendStatus={backend}
      dark={dark}
      setDark={setDark}
      refresh={refresh}
      openMaterial={openMaterial}
    >
      {page === "home" && (
        <Dashboard data={data} go={setPage} openMaterial={openMaterial} />
      )}
      {page === "materials" && (
        <Materials data={data} refresh={refresh} openMaterial={openMaterial} toast={toast} />
      )}
      {page === "calendar" && (
        <CalendarPage data={data} refresh={refresh} toast={toast} go={setPage} />
      )}
      {page === "workspace" &&
        (activeMaterial ? (
          <Workspace
            material={activeMaterial}
            data={data}
            go={setPage}
            refresh={refresh}
            toast={toast}
          />
        ) : (
          <Empty
            icon="folder"
            title="Choose a material first"
            text="Open a processed material to enter its workspace."
            action={<Button onClick={() => setPage("materials")}>View materials</Button>}
          />
        ))}
      {page === "notes" && <NotesPage data={data} refresh={refresh} toast={toast} />}
      {page === "schedule" && <SchedulePage data={data} refresh={refresh} toast={toast} />}
      {page === "characters" && <CharactersPage data={data} refresh={refresh} toast={toast} />}
      {page === "assistant" && <StudyAssistant data={data} toast={toast} />}
      {page === "achievements" && <Achievements data={data} />}
      {page === "settings" && (
        <SettingsPage
          data={data}
          refresh={refresh}
          dark={dark}
          setDark={setDark}
          toast={toast}
          onLogout={onLogout}
        />
      )}
      {toastState && (
        <div className={`toast ${toastState.error ? "error" : ""}`} role="status">
          <Icon name={toastState.error ? "close" : "check"} />
          <span>{toastState.message}</span>
        </div>
      )}
    </Shell>
  )
}

/* ------------------------------------------------------------------ *
 * Root
 * ------------------------------------------------------------------ */

export default function App() {
  const [boot, setBoot] = useState<Boot>("loading")
  const [bootMessage, setBootMessage] = useState("")
  const [backend, setBackend] = useState<BackendStatus | null>(null)
  const [session, setSession] = useState<AuthSession | null>(null)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const status = await initBackend()
        if (cancelled) return
        setBackend(status)
        const active = await getSession()
        if (cancelled) return
        setSession(active)
        setBoot("ready")
      } catch (reason) {
        if (cancelled) return
        setBootMessage(
          reason instanceof Error
            ? reason.message
            : "The application could not start. Please reload the page.",
        )
        setBoot("fatal")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * The provider is the authority on the session, so its changes are mirrored
   * here rather than assumed. This is what makes a revocation, an expired token
   * or a sign-out in another tab take effect without a reload.
   */
  useEffect(() => {
    if (!backend) return
    let cancelled = false
    let unsubscribe: () => void = () => undefined
    void subscribeToSession((next) => {
      if (!cancelled) setSession(next)
    }).then((stop) => {
      if (cancelled) stop()
      else unsubscribe = stop
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [backend])

  async function handleLogout() {
    try {
      await signOut()
    } catch {
      /* signing out locally must succeed even if the network call fails */
    }
    setSession(null)
    setEntered(true)
  }

  if (boot === "loading") {
    return (
      <div className="app-loading">
        <Mascot pose="reading" />
        <h2>Starting Llamastu…</h2>
        <p>Getting everything ready.</p>
      </div>
    )
  }

  if (boot === "fatal" || !backend) {
    return (
      <div className="app-loading">
        <Mascot pose="study" />
        <h2>The application could not start</h2>
        <p>{bootMessage}</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    )
  }

  if (session) {
    return (
      <AppContent
        key={`${backend.mode}:${session.userId}`}
        onLogout={handleLogout}
        backend={backend}
      />
    )
  }

  if (!entered) return <Welcome onStart={() => setEntered(true)} />

  return (
    <AuthScreen
      backend={backend}
      onAuthenticated={async () => {
        const active = await getSession()
        setSession(active)
      }}
    />
  )
}
