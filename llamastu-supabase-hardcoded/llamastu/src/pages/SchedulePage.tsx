import { useState, type FormEvent } from "react"
import { Button, Empty, PageHead } from "../components/common"
import { Icon } from "../components/Icon"
import { api } from "../lib/api"
import type { AppData, Schedule } from "../types"

type Props = {
  data: AppData
  refresh: () => Promise<void>
  toast: (message: string, error?: boolean) => void
}

function toLocalInputs(iso: string): { date: string; time: string } {
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return { date: "", time: "" }
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  }
}

export function SchedulePage({ data, refresh, toast }: Props) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [busyId, setBusyId] = useState("")

  const now = Date.now()
  const upcoming = data.schedules.filter((item) => new Date(item.endAt).getTime() >= now)
  const past = data.schedules
    .filter((item) => new Date(item.endAt).getTime() < now)
    .sort((left, right) => right.startAt.localeCompare(left.startAt))

  function openCreate() {
    setEditing(null)
    setOpen(true)
  }

  function openEdit(item: Schedule) {
    setEditing(item)
    setOpen(true)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const date = String(form.get("date") ?? "")
    const start = String(form.get("start") ?? "")
    const end = String(form.get("end") ?? "")
    const startAt = new Date(`${date}T${start}`)
    const endAt = new Date(`${date}T${end}`)

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      toast("Enter a valid date and time.", true)
      return
    }
    if (endAt <= startAt) {
      toast("The end time must be after the start time.", true)
      return
    }

    const body = {
      course: String(form.get("course") ?? ""),
      lecturer: String(form.get("lecturer") ?? ""),
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      room: String(form.get("room") ?? ""),
      notes: String(form.get("notes") ?? ""),
      repeatRule: form.get("repeat") === "weekly" ? "weekly" : "none",
      reminderMinutes: Number(form.get("reminder") ?? 0),
    }

    setBusyId(editing?.id ?? "new")
    try {
      if (editing) {
        await api(`/schedules/${editing.id}`, { method: "PUT", body: JSON.stringify(body) })
        toast("Class updated.")
      } else {
        await api("/schedules", { method: "POST", body: JSON.stringify(body) })
        toast("Class saved to your schedule.")
      }
      await refresh()
      setOpen(false)
      setEditing(null)
      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission()
      }
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "The class could not be saved.", true)
    } finally {
      setBusyId("")
    }
  }

  async function remove(item: Schedule) {
    if (!confirm(`Delete ${item.course}?`)) return
    setBusyId(item.id)
    try {
      await api(`/schedules/${item.id}`, { method: "DELETE" })
      await refresh()
      toast("Class removed.")
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "The class could not be removed.", true)
    } finally {
      setBusyId("")
    }
  }

  const editDefaults = editing
    ? {
        date: toLocalInputs(editing.startAt).date,
        start: toLocalInputs(editing.startAt).time,
        end: toLocalInputs(editing.endAt).time,
      }
    : { date: "", start: "", end: "" }

  return (
    <>
      <PageHead
        eyebrow="UNIVERSITY PLANNER"
        title="Schedule"
        text="Classes are stored in your account. Browser reminders fire while Llamastu is open."
        action={
          <Button icon="plus" onClick={openCreate}>
            Add class
          </Button>
        }
      />

      {data.schedules.length === 0 ? (
        <Empty
          icon="calendar"
          title="No classes planned"
          text="Add a real class with its date, room, and reminder."
          action={<Button onClick={openCreate}>Add your first class</Button>}
        />
      ) : (
        <>
          <h2 className="section-title">Upcoming ({upcoming.length})</h2>
          {upcoming.length === 0 ? (
            <p className="muted">No upcoming classes. Everything is in the past list below.</p>
          ) : (
            <div className="schedule-list">
              {upcoming.map((item) => (
                <article className="card schedule-item" key={item.id}>
                  <div className="schedule-date">
                    <b>{new Date(item.startAt).getDate()}</b>
                    <span>
                      {new Intl.DateTimeFormat("en-GB", { month: "short" }).format(
                        new Date(item.startAt),
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="eyebrow">
                      {new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(
                        new Date(item.startAt),
                      )}
                      {item.repeatRule === "weekly" ? " · weekly" : ""}
                    </span>
                    <h2>{item.course}</h2>
                    <p>
                      {item.lecturer || "Lecturer not set"} · {item.room || "Room not set"}
                    </p>
                    {item.notes && <small className="muted">{item.notes}</small>}
                  </div>
                  <div className="schedule-clock">
                    <Icon name="clock" />
                    <b>
                      {new Intl.DateTimeFormat("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(item.startAt))}
                    </b>
                    <span>{item.reminderMinutes || 0} min reminder</span>
                  </div>
                  <div className="schedule-actions">
                    <button
                      className="icon-button"
                      onClick={() => openEdit(item)}
                      aria-label={`Edit ${item.course}`}
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    <button
                      className="icon-button danger"
                      onClick={() => remove(item)}
                      disabled={busyId === item.id}
                      aria-label={`Delete ${item.course}`}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {past.length > 0 && (
            <>
              <h2 className="section-title">Past ({past.length})</h2>
              <div className="schedule-list past">
                {past.slice(0, 8).map((item) => (
                  <article className="card schedule-item" key={item.id}>
                    <div className="schedule-date">
                      <b>{new Date(item.startAt).getDate()}</b>
                      <span>
                        {new Intl.DateTimeFormat("en-GB", { month: "short" }).format(
                          new Date(item.startAt),
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="eyebrow">PAST CLASS</span>
                      <h2>{item.course}</h2>
                      <p>
                        {item.lecturer || "Lecturer not set"} · {item.room || "Room not set"}
                      </p>
                    </div>
                    <div className="schedule-actions">
                      <button
                        className="icon-button"
                        onClick={() => openEdit(item)}
                        aria-label={`Edit ${item.course}`}
                      >
                        <Icon name="edit" size={16} />
                      </button>
                      <button
                        className="icon-button danger"
                        onClick={() => remove(item)}
                        aria-label={`Delete ${item.course}`}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {open && (
        <div className="modal-backdrop">
          <form className="modal card schedule-form" onSubmit={save}>
            <div className="section-head">
              <div>
                <span className="eyebrow">{editing ? "EDIT CLASS" : "NEW CLASS"}</span>
                <h2>{editing ? editing.course : "Add to schedule"}</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setEditing(null)
                }}
                aria-label="Close"
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="form-grid">
              <label>
                Course
                <input name="course" defaultValue={editing?.course ?? ""} required />
              </label>
              <label>
                Lecturer
                <input name="lecturer" defaultValue={editing?.lecturer ?? ""} />
              </label>
              <label>
                Date
                <input name="date" type="date" defaultValue={editDefaults.date} required />
              </label>
              <label>
                Room
                <input name="room" defaultValue={editing?.room ?? ""} />
              </label>
              <label>
                Start time
                <input name="start" type="time" defaultValue={editDefaults.start} required />
              </label>
              <label>
                End time
                <input name="end" type="time" defaultValue={editDefaults.end} required />
              </label>
              <label>
                Repeat
                <select name="repeat" defaultValue={editing?.repeatRule ?? "none"}>
                  <option value="none">Does not repeat</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
              <label>
                Reminder
                <select name="reminder" defaultValue={String(editing?.reminderMinutes ?? 15)}>
                  <option value="0">At start time</option>
                  <option value="5">5 minutes before</option>
                  <option value="15">15 minutes before</option>
                  <option value="30">30 minutes before</option>
                </select>
              </label>
            </div>
            <label>
              Notes
              <textarea name="notes" defaultValue={editing?.notes ?? ""} />
            </label>
            <Button type="submit" className="full" disabled={busyId !== ""}>
              {busyId ? (
                <>
                  <span className="button-spinner" /> Saving…
                </>
              ) : editing ? (
                "Save changes"
              ) : (
                "Save class"
              )}
            </Button>
          </form>
        </div>
      )}
    </>
  )
}

export default SchedulePage
