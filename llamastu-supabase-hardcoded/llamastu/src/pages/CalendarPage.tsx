import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { Button, Empty, PageHead } from "../components/common"
import { Icon } from "../components/Icon"
import { api } from "../lib/api"
import { armPushForDevice } from "../lib/push"
import {
  buildMonthGrid,
  CATEGORY_META,
  dayKey,
  describeRepeat,
  durationMinutes,
  formatTime,
  isSameDay,
  occurrencesInRange,
  REMINDER_OPTIONS,
  REPEAT_OPTIONS,
  weekdayLabels,
  type Occurrence,
} from "../lib/calendar"
import type {
  AppData,
  CalendarCategory,
  CalendarEvent,
  NotificationPreferences,
  RepeatRule,
} from "../types"

type Props = {
  data: AppData
  refresh: () => Promise<void>
  toast: (message: string, error?: boolean) => void
  go: (page: "settings") => void
}

type View = "month" | "agenda"

/**
 * Renders the reminder as both the lead time and the exact clock time it will
 * fire, so the learner can see that moving an event really moves its alarm.
 */
function reminderLine(occurrence: Occurrence): string {
  const minutes = occurrence.event.reminderMinutes
  if (minutes < 0) return " · no reminder"
  const firesAt = new Date(occurrence.start.getTime() - minutes * 60_000)
  return ` · reminder ${minutes} min before, at ${formatTime(firesAt)}`
}

function toLocalDateTime(iso: string): { date: string; time: string } {
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return { date: "", time: "" }
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  }
}

export function CalendarPage({ data, refresh, toast, go }: Props) {
  const today = new Date()
  const [view, setView] = useState<View>("month")
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [creating, setCreating] = useState(false)
  const [selectedDay, setSelectedDay] = useState<string | null>(dayKey(today))
  const [busy, setBusy] = useState(false)
  const [permission, setPermission] = useState(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  )
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    data.notificationPreferences,
  )
  /**
   * Whether this installation can deliver a reminder with every tab closed.
   * Reported honestly: without VAPID keys configured on the backend, push is
   * simply not available and reminders only arrive while a tab is open.
   */
  const [pushInfo, setPushInfo] = useState<{
    configured: boolean
    subscribed: boolean
    count: number
  } | null>(null)
  const [arming, setArming] = useState(false)

  useEffect(() => setPreferences(data.notificationPreferences), [data.notificationPreferences])

  const loadPushState = useCallback(async () => {
    try {
      const [key, subs] = await Promise.all([
        api<{ configured: boolean; publicKey?: string | null }>("/push/public-key"),
        api<{ count: number; active: boolean }>("/push/subscriptions"),
      ])
      const registration = await navigator.serviceWorker?.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      setPushInfo({
        configured: Boolean(key?.configured),
        subscribed: Boolean(subscription),
        count: Number(subs?.count ?? 0),
      })
    } catch {
      setPushInfo({ configured: false, subscribed: false, count: 0 })
    }
  }, [])

  useEffect(() => {
    void loadPushState()
  }, [loadPushState])

  /**
   * The reminders that are actually waiting.
   *
   * Derived from the stored `reminderAt` on each event, which is itself derived
   * from the event's start time and lead time — so this count and the next
   * firing time are consequences of the agenda rather than a second schedule
   * that could drift out of step with it.
   */
  const scheduledReminders = useMemo(() => {
    const now = Date.now()
    return data.calendarEvents
      .filter((event) => {
        if (!event.reminderAt || event.reminderSentAt) return false
        return new Date(event.reminderAt).getTime() > now
      })
      .sort((left, right) => String(left.reminderAt).localeCompare(String(right.reminderAt)))
  }, [data.calendarEvents])
  const nextReminder = scheduledReminders[0]

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor])

  /** Every occurrence shown in the current month, repeats expanded. */
  const monthOccurrences = useMemo(() => {
    const from = new Date(cursor.year, cursor.month, 1)
    const to = new Date(cursor.year, cursor.month + 1, 0, 23, 59, 59)
    return occurrencesInRange(data.calendarEvents, from, to)
  }, [data.calendarEvents, cursor])

  const byDay = useMemo(() => {
    const map = new Map<string, typeof monthOccurrences>()
    monthOccurrences.forEach((occurrence) => {
      const key = dayKey(occurrence.start)
      const list = map.get(key) ?? []
      list.push(occurrence)
      map.set(key, list)
    })
    return map
  }, [monthOccurrences])

  const upcoming = useMemo(
    () =>
      occurrencesInRange(
        data.calendarEvents,
        new Date(),
        new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      ).slice(0, 40),
    [data.calendarEvents],
  )

  const dayAgenda = selectedDay ? (byDay.get(selectedDay) ?? []) : []

  async function pushPreferences(next: Partial<NotificationPreferences>) {
    const merged = { ...preferences, ...next }
    setPreferences(merged)
    try {
      await api("/notification-preferences", {
        method: "PATCH",
        body: JSON.stringify(next),
      })
      await refresh()
    } catch (reason) {
      setPreferences(preferences)
      toast(reason instanceof Error ? reason.message : "Preferences could not be saved.", true)
    }
  }

  /**
   * Enables reminders on this device.
   *
   * This runs the whole chain — permission, service worker, push subscription
   * and the server-side record — and reports which parts actually succeeded. A
   * granted permission is not reported as background push being armed.
   */
  async function enableBrowserReminders() {
    if (!("Notification" in window)) {
      toast("This browser does not support desktop notifications.", true)
      return
    }
    setArming(true)
    try {
      const result = await armPushForDevice(
        () => api<{ configured: boolean; publicKey?: string | null }>("/push/public-key"),
        async (subscription) => {
          await api("/push/subscribe", {
            method: "POST",
            body: JSON.stringify({ subscription, userAgent: navigator.userAgent }),
          })
        },
      )
      setPermission(Notification.permission)
      // Foreground alerts need only the permission; background push needs the
      // subscription. The preference follows what is really available.
      await pushPreferences({ browserPush: result.permitted, enabled: result.permitted })
      await loadPushState()
      toast(result.message, !result.ok)
      if (result.ok) {
        new Notification("Study reminders enabled", {
          body: "Llamastu will remind you before each agenda item.",
        })
      }
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Notifications could not be enabled.", true)
    } finally {
      setArming(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const date = String(form.get("date") ?? "")
    const start = String(form.get("start") ?? "")
    const duration = Number(form.get("duration") ?? 60)
    const reminderMinutes = Number(form.get("reminder") ?? -1)

    const startAt = new Date(`${date}T${start}`)
    if (Number.isNaN(startAt.getTime())) {
      toast("Enter a valid date and start time.", true)
      return
    }
    const endAt = new Date(startAt.getTime() + Math.max(5, duration) * 60_000)

    const body = {
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? ""),
      category: form.get("category") as CalendarCategory,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      location: String(form.get("location") ?? ""),
      reminderMinutes,
      repeatRule: form.get("repeat") as RepeatRule,
      materialId: (form.get("materialId") as string) || null,
    }
    if (!body.title) {
      toast("Give the agenda item a title.", true)
      return
    }

    setBusy(true)
    try {
      if (editing) {
        await api(`/calendar/${editing.id}`, { method: "PUT", body: JSON.stringify(body) })
        toast("Agenda updated — its reminder moved with it.")
      } else {
        await api("/calendar", { method: "POST", body: JSON.stringify(body) })
        toast(
          reminderMinutes >= 0
            ? `Agenda saved. Reminder set for ${reminderMinutes} minutes before.`
            : "Agenda saved with no reminder.",
        )
      }
      await refresh()
      setEditing(null)
      setCreating(false)
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "The agenda could not be saved.", true)
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: CalendarEvent) {
    if (!confirm(`Delete “${item.title}”? Its reminder is cancelled with it.`)) return
    setBusy(true)
    try {
      const result = await api<{ cancelledReminder: boolean }>(`/calendar/${item.id}`, {
        method: "DELETE",
      })
      await refresh()
      toast(
        result?.cancelledReminder
          ? "Agenda deleted and its reminder cancelled."
          : "Agenda deleted.",
      )
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "The agenda could not be deleted.", true)
    } finally {
      setBusy(false)
    }
  }

  const defaults = editing
    ? {
        ...toLocalDateTime(editing.startAt),
        duration: String(Math.max(5, durationMinutes(editing.startAt, editing.endAt))),
        title: editing.title,
        description: editing.description,
        category: editing.category,
        location: editing.location ?? "",
        reminder: String(editing.reminderMinutes),
        repeat: editing.repeatRule,
        materialId: editing.materialId ?? "",
      }
    : {
        date: selectedDay ?? dayKey(today),
        time: "19:00",
        duration: "60",
        title: "",
        description: "",
        category: "study" as CalendarCategory,
        location: "",
        reminder: "15",
        repeat: "none" as RepeatRule,
        materialId: "",
      }

  const formOpen = creating || Boolean(editing)

  return (
    <>
      <PageHead
        eyebrow="PLANNER"
        title="Calendar & Agenda"
        text="Plan study sessions, attach a reminder to each one, and get notified before it starts."
        action={
          <div className="head-actions">
            <div className="view-toggle" role="tablist" aria-label="Calendar view">
              <button
                type="button"
                role="tab"
                aria-selected={view === "month"}
                className={view === "month" ? "active" : ""}
                onClick={() => setView("month")}
              >
                Month
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "agenda"}
                className={view === "agenda" ? "active" : ""}
                onClick={() => setView("agenda")}
              >
                Agenda
              </button>
            </div>
            <Button
              icon="plus"
              onClick={() => {
                setEditing(null)
                setCreating(true)
              }}
            >
              New agenda
            </Button>
          </div>
        }
      />

      {permission !== "granted" && (
        <div className="reminder-banner" role="status">
          <Icon name="bell" size={16} />
          <div>
            <b>Allow notifications to receive study reminders</b>
            <span>
              {permission === "denied"
                ? "Notifications are disabled in your browser settings. Enable them for this site to receive reminders."
                : "Reminders also appear in the in-app notification centre. Enable browser notifications to be alerted even when this tab is in the background."}
            </span>
          </div>
          {permission !== "unsupported" && (
            <Button variant="secondary" onClick={enableBrowserReminders} disabled={arming}>
              {arming ? "Enabling…" : pushInfo?.subscribed ? "Re-arm push" : "Enable notifications"}
            </Button>
          )}
        </div>
      )}

      {/* Scheduling status: what is actually waiting, when it will fire, and
          whether this device can be reached while the site is closed. */}
      <div className="card reminder-status" role="status">
        <Icon name="clock" size={17} />
        <div>
          <b>
            {scheduledReminders.length} reminder
            {scheduledReminders.length === 1 ? "" : "s"} scheduled
          </b>
          <span>
            {nextReminder?.reminderAt
              ? `Next: ${nextReminder.title} at ${formatTime(nextReminder.reminderAt)}`
              : "No reminder is waiting. Set a lead time on an agenda item and it is scheduled here."}
          </span>
          {/* Permission, this device's subscription and the server side are
              three different things; they are reported separately so a granted
              permission is never mistaken for working background delivery. */}
          <small>
            Permission:{" "}
            {permission === "granted"
              ? "granted"
              : permission === "denied"
                ? "denied in your browser settings"
                : permission === "unsupported"
                  ? "not supported by this browser"
                  : "not requested yet"}
            {" · "}
            {pushInfo === null
              ? "checking this device…"
              : pushInfo.subscribed
                ? "this device has a push subscription"
                : "this device is not subscribed to push"}
            {" · "}
            {pushInfo === null
              ? "checking background delivery…"
              : pushInfo.configured
                ? `background delivery is configured (${pushInfo.count} device subscription${
                    pushInfo.count === 1 ? "" : "s"
                  } on this account)`
                : "no VAPID public key on the backend, so reminders arrive while Llamastu is open"}
          </small>
        </div>
      </div>

      {view === "month" ? (
        <div className="calendar-layout">
          <section className="card calendar-card">
            <div className="calendar-head">
              <button
                type="button"
                className="icon-button"
                aria-label="Previous month"
                onClick={() =>
                  setCursor((current) =>
                    current.month === 0
                      ? { year: current.year - 1, month: 11 }
                      : { ...current, month: current.month - 1 },
                  )
                }
              >
                <Icon name="chevron-left" size={17} />
              </button>
              <h2>{grid.label}</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Next month"
                onClick={() =>
                  setCursor((current) =>
                    current.month === 11
                      ? { year: current.year + 1, month: 0 }
                      : { ...current, month: current.month + 1 },
                  )
                }
              >
                <Icon name="chevron-right" size={17} />
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  const now = new Date()
                  setCursor({ year: now.getFullYear(), month: now.getMonth() })
                  setSelectedDay(dayKey(now))
                }}
              >
                Today
              </button>
            </div>

            <div className="calendar-grid">
              {weekdayLabels().map((label) => (
                <div className="calendar-weekday" key={label}>
                  {label}
                </div>
              ))}
              {grid.weeks.flat().map((day) => {
                const key = dayKey(day)
                const items = byDay.get(key) ?? []
                const outside = day.getMonth() !== cursor.month
                return (
                  <button
                    type="button"
                    key={key}
                    className={`calendar-day ${outside ? "outside" : ""} ${
                      selectedDay === key ? "selected" : ""
                    } ${isSameDay(day, today) ? "today" : ""}`}
                    onClick={() => setSelectedDay(key)}
                    aria-label={`${key}, ${items.length} agenda item${items.length === 1 ? "" : "s"}`}
                  >
                    <span className="day-number">{day.getDate()}</span>
                    <span className="day-dots">
                      {items.slice(0, 3).map((occurrence, index) => (
                        <i
                          key={`${occurrence.event.id}-${index}`}
                          style={{ background: CATEGORY_META[occurrence.event.category].color }}
                        />
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="card day-panel">
            <div className="section-head">
              <div>
                <span className="eyebrow">SELECTED DAY</span>
                <h2>
                  {selectedDay
                    ? new Intl.DateTimeFormat("en-GB", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      }).format(new Date(`${selectedDay}T00:00:00`))
                    : "Pick a day"}
                </h2>
              </div>
            </div>
            {dayAgenda.length === 0 ? (
              <p className="muted">
                Nothing planned. Use “New agenda” to add a study session with a reminder.
              </p>
            ) : (
              <div className="agenda-list">
                {dayAgenda.map((occurrence, index) => (
                  <article className="agenda-item" key={`${occurrence.event.id}-${index}`}>
                    <span
                      className="agenda-dot"
                      style={{ background: CATEGORY_META[occurrence.event.category].color }}
                    />
                    <div>
                      <span className="eyebrow">
                        {formatTime(occurrence.start)}
                        {occurrence.isRepeat ? ` · ${describeRepeat(occurrence.event.repeatRule)}` : ""}
                      </span>
                      <b>{occurrence.event.title}</b>
                      <small>
                        {CATEGORY_META[occurrence.event.category].label} ·{" "}
                        {durationMinutes(
                          occurrence.event.startAt,
                          occurrence.event.endAt,
                        )}{" "}
                        min
                        {reminderLine(occurrence)}
                      </small>
                      {occurrence.event.description && <p>{occurrence.event.description}</p>}
                    </div>
                    <div className="agenda-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Edit ${occurrence.event.title}`}
                        onClick={() => {
                          setEditing(occurrence.event)
                          setCreating(false)
                        }}
                      >
                        <Icon name="edit" size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        aria-label={`Delete ${occurrence.event.title}`}
                        onClick={() => remove(occurrence.event)}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : upcoming.length === 0 ? (
        <Empty
          icon="calendar"
          title="No upcoming agenda"
          text="Create your first agenda item and attach a reminder to it."
          action={
            <Button
              onClick={() => {
                setEditing(null)
                setCreating(true)
              }}
            >
              New agenda
            </Button>
          }
        />
      ) : (
        <div className="agenda-list wide">
          {upcoming.map((occurrence, index) => (
            <article className="card agenda-item" key={`${occurrence.event.id}-${index}`}>
              <div className="agenda-date">
                <b>{occurrence.start.getDate()}</b>
                <span>
                  {new Intl.DateTimeFormat("en-GB", { month: "short" }).format(occurrence.start)}
                </span>
              </div>
              <span
                className="agenda-dot"
                style={{ background: CATEGORY_META[occurrence.event.category].color }}
              />
              <div>
                <span className="eyebrow">
                  {new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(occurrence.start)} ·{" "}
                  {formatTime(occurrence.start)}
                  {occurrence.isRepeat ? ` · ${describeRepeat(occurrence.event.repeatRule)}` : ""}
                </span>
                <h2>{occurrence.event.title}</h2>
                <small>
                  {CATEGORY_META[occurrence.event.category].label}
                  {occurrence.event.location ? ` · ${occurrence.event.location}` : ""}
                  {reminderLine(occurrence)}
                </small>
              </div>
              <div className="agenda-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Edit ${occurrence.event.title}`}
                  onClick={() => {
                    setEditing(occurrence.event)
                    setCreating(false)
                  }}
                >
                  <Icon name="edit" size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label={`Delete ${occurrence.event.title}`}
                  onClick={() => remove(occurrence.event)}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="card reminder-settings">
        <div className="section-head">
          <div>
            <span className="eyebrow">REMINDERS</span>
            <h2>Notification settings</h2>
          </div>
          <button
            type="button"
            className={`switch ${preferences.enabled ? "on" : ""}`}
            onClick={() => pushPreferences({ enabled: !preferences.enabled })}
            aria-pressed={preferences.enabled}
            aria-label="Toggle notifications"
          >
            <i />
          </button>
        </div>
        <div className="setting-row">
          <div className="setting-icon">
            <Icon name="calendar" />
          </div>
          <span>
            <b>Agenda reminders</b>
            <small>Reminders for calendar items you create.</small>
          </span>
          <button
            type="button"
            className={`switch ${preferences.agendaReminders ? "on" : ""}`}
            onClick={() => pushPreferences({ agendaReminders: !preferences.agendaReminders })}
            aria-pressed={preferences.agendaReminders}
            aria-label="Toggle agenda reminders"
          >
            <i />
          </button>
        </div>
        <div className="setting-row">
          <div className="setting-icon">
            <Icon name="book" />
          </div>
          <span>
            <b>Study reminders</b>
            <small>When a material finishes processing or a quiz is scored.</small>
          </span>
          <button
            type="button"
            className={`switch ${preferences.studyReminders ? "on" : ""}`}
            onClick={() => pushPreferences({ studyReminders: !preferences.studyReminders })}
            aria-pressed={preferences.studyReminders}
            aria-label="Toggle study reminders"
          >
            <i />
          </button>
        </div>
        <div className="setting-row">
          <div className="setting-icon">
            <Icon name="play" />
          </div>
          <span>
            <b>Game reminders</b>
            <small>When you open a gate or complete a map.</small>
          </span>
          <button
            type="button"
            className={`switch ${preferences.gameReminders ? "on" : ""}`}
            onClick={() => pushPreferences({ gameReminders: !preferences.gameReminders })}
            aria-pressed={preferences.gameReminders}
            aria-label="Toggle game reminders"
          >
            <i />
          </button>
        </div>
        <div className="setting-row">
          <div className="setting-icon">
            <Icon name="bell" />
          </div>
          <span>
            <b>Browser reminders</b>
            <small>Permission: {permission}</small>
          </span>
          {permission === "granted" ? (
            <button
              type="button"
              className={`switch ${preferences.browserPush ? "on" : ""}`}
              onClick={() => pushPreferences({ browserPush: !preferences.browserPush })}
              aria-pressed={preferences.browserPush}
              aria-label="Toggle browser reminders"
            >
              <i />
            </button>
          ) : (
            <Button variant="secondary" onClick={enableBrowserReminders}>
              Enable notifications
            </Button>
          )}
        </div>
        <p className="muted small">
          Your reminders are shown while Llamastu is open, and again in your notifications so you
          never miss an agenda item.
        </p>
        <Button variant="ghost" onClick={() => go("settings")}>
          Open full settings
        </Button>
      </section>

      {formOpen && (
        <div className="modal-backdrop">
          <form className="modal card schedule-form" onSubmit={save}>
            <div className="section-head">
              <div>
                <span className="eyebrow">{editing ? "EDIT AGENDA" : "NEW AGENDA"}</span>
                <h2>{editing ? editing.title : "Plan a study session"}</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditing(null)
                  setCreating(false)
                }}
                aria-label="Close"
              >
                <Icon name="close" />
              </button>
            </div>
            <label>
              Title
              <input
                name="title"
                defaultValue={defaults.title}
                placeholder="Belajar Struktur Data"
                required
              />
            </label>
            <div className="form-grid">
              <label>
                Date
                <input name="date" type="date" defaultValue={defaults.date} required />
              </label>
              <label>
                Start time
                <input name="start" type="time" defaultValue={defaults.time} required />
              </label>
              <label>
                Duration (minutes)
                <input
                  name="duration"
                  type="number"
                  min={5}
                  max={600}
                  step={5}
                  defaultValue={defaults.duration}
                />
              </label>
              <label>
                Category
                <select name="category" defaultValue={defaults.category}>
                  {(Object.keys(CATEGORY_META) as CalendarCategory[]).map((key) => (
                    <option key={key} value={key}>
                      {CATEGORY_META[key].label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reminder
                <select name="reminder" defaultValue={defaults.reminder}>
                  {REMINDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Repeat
                <select name="repeat" defaultValue={defaults.repeat}>
                  {REPEAT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Location
                <input name="location" defaultValue={defaults.location} placeholder="Library" />
              </label>
              <label>
                Linked material
                <select name="materialId" defaultValue={defaults.materialId}>
                  <option value="">Not linked</option>
                  {data.materials.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.title || material.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Description
              <textarea name="description" defaultValue={defaults.description} />
            </label>
            <p className="muted small">
              The reminder is derived from the start time and the lead time you choose, so changing
              the date, the time or the reminder always moves the alarm with it.
            </p>
            <Button type="submit" className="full" disabled={busy}>
              {busy ? (
                <>
                  <span className="button-spinner" /> Saving…
                </>
              ) : editing ? (
                "Save changes"
              ) : (
                "Save agenda"
              )}
            </Button>
          </form>
        </div>
      )}
    </>
  )
}

export default CalendarPage
