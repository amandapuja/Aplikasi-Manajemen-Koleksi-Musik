import type {
  CalendarCategory,
  CalendarEvent,
  NotificationPreferences,
  RepeatRule,
} from "../types"

/**
 * Calendar, agenda and reminder rules.
 *
 * A reminder is never a separate entity: it is derived from the event's start
 * time and its `reminderMinutes`, and the derived timestamp is stored alongside
 * the event so an edit or a delete can always update or cancel it. Editing an
 * event therefore moves its alarm, and deleting an event cancels it — there is
 * no way to leave an orphan reminder behind.
 */

export const REMINDER_OPTIONS: { value: number; label: string }[] = [
  { value: -1, label: "No reminder" },
  { value: 0, label: "At start time" },
  { value: 5, label: "5 minutes before" },
  { value: 10, label: "10 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
]

export const CATEGORY_META: Record<
  CalendarCategory,
  { label: string; color: string; icon: string }
> = {
  study: { label: "Study", color: "#d96f4b", icon: "book" },
  class: { label: "Class", color: "#4f6d92", icon: "calendar" },
  exam: { label: "Exam", color: "#bb563c", icon: "award" },
  assignment: { label: "Assignment", color: "#c98f5f", icon: "edit" },
  review: { label: "Review", color: "#8da789", icon: "spark" },
  other: { label: "Other", color: "#8a7d76", icon: "clock" },
}

export const REPEAT_OPTIONS: { value: RepeatRule; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
]

export function reminderLabel(minutes: number): string {
  return REMINDER_OPTIONS.find((option) => option.value === minutes)?.label ?? `${minutes} min before`
}

/** The exact moment a reminder for this event should fire. */
export function computeReminderAt(
  startAt: string,
  reminderMinutes: number,
  leadMinutes?: number,
): string | null {
  const start = new Date(startAt)
  if (Number.isNaN(start.getTime())) return null
  const minutes = leadMinutes ?? reminderMinutes
  if (minutes < 0) return null
  return new Date(start.getTime() - minutes * 60_000).toISOString()
}

export function dayKey(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ""
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date)
  const targetDay = next.getDate()
  next.setDate(1)
  next.setMonth(next.getMonth() + months)
  const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(targetDay, daysInMonth))
  return next
}

export type Occurrence = {
  event: CalendarEvent
  start: Date
  end: Date
  /** True when this is a later repeat, not the original entry. */
  isRepeat: boolean
}

/** Every occurrence of one event that starts inside [from, to]. */
export function occurrencesFor(
  event: CalendarEvent,
  from: Date,
  to: Date,
): Occurrence[] {
  const base = new Date(event.startAt)
  if (Number.isNaN(base.getTime())) return []
  const duration = Math.max(0, new Date(event.endAt).getTime() - base.getTime())
  const results: Occurrence[] = []

  if (event.repeatRule === "none") {
    if (base >= from && base <= to) {
      results.push({ event, start: base, end: new Date(base.getTime() + duration), isRepeat: false })
    }
    return results
  }

  // Walk forward from the original start until we pass the window.
  let cursor = base
  let guard = 0
  while (cursor <= to && guard < 800) {
    guard += 1
    if (cursor >= from) {
      results.push({
        event,
        start: cursor,
        end: new Date(cursor.getTime() + duration),
        isRepeat: cursor.getTime() !== base.getTime(),
      })
    }
    if (event.repeatRule === "daily") cursor = addDays(cursor, 1)
    else if (event.repeatRule === "weekly") cursor = addDays(cursor, 7)
    else cursor = addMonths(cursor, 1)
  }
  return results
}

export function occurrencesInRange(
  events: CalendarEvent[],
  from: Date,
  to: Date,
): Occurrence[] {
  return events
    .flatMap((event) => occurrencesFor(event, from, to))
    .sort((left, right) => left.start.getTime() - right.start.getTime())
}

/* ------------------------------------------------------------------ *
 * Month grid
 * ------------------------------------------------------------------ */

export type MonthGrid = {
  year: number
  month: number
  label: string
  /** Six weeks of days, Monday first. */
  weeks: Date[][]
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

export function weekdayLabels(): string[] {
  return WEEKDAY_LABELS
}

export function buildMonthGrid(year: number, month: number): MonthGrid {
  const first = new Date(year, month, 1)
  const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(first)
  // JS: 0 = Sunday. Convert so Monday is index 0.
  const offset = (first.getDay() + 6) % 7
  const gridStart = addDays(first, -offset)

  const weeks: Date[][] = []
  for (let week = 0; week < 6; week += 1) {
    const days: Date[] = []
    for (let day = 0; day < 7; day += 1) {
      days.push(addDays(gridStart, week * 7 + day))
    }
    weeks.push(days)
  }
  return { year, month, label, weeks }
}

export function isSameDay(left: Date, right: Date): boolean {
  return dayKey(left) === dayKey(right)
}

export function formatTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date)
}

export function formatEventRange(event: CalendarEvent): string {
  const start = new Date(event.startAt)
  const end = new Date(event.endAt)
  return `${formatTime(start)} – ${formatTime(end)}`
}

export function describeRepeat(rule: RepeatRule): string {
  return REPEAT_OPTIONS.find((option) => option.value === rule)?.label ?? "Does not repeat"
}

export function durationMinutes(startAt: string, endAt: string): number {
  const start = new Date(startAt).getTime()
  const end = new Date(endAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(0, Math.round((end - start) / 60_000))
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  studyReminders: true,
  gameReminders: true,
  agendaReminders: true,
  browserPush: false,
  leadMinutes: 15,
}
