import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Button, PageHead } from "../components/common"
import { Icon } from "../components/Icon"
import { api } from "../lib/api"
import {
  buildExportCsv,
  buildExportJson,
  downloadFile,
  safeFileName,
  type ExportDocument,
} from "../lib/export"
import { armPushForDevice } from "../lib/push"
import type { AppData } from "../types"

type Props = {
  data: AppData
  refresh: () => Promise<void>
  dark: boolean
  setDark: (value: boolean) => void
  toast: (message: string, error?: boolean) => void
  onLogout: () => void
}

export function SettingsPage({ data, refresh, dark, setDark, toast, onLogout }: Props) {
  const [saving, setSaving] = useState(false)
  /** This device's real push state: configured on the backend? subscribed? */
  const [pushState, setPushState] = useState<{
    configured: boolean
    subscribed: boolean
  } | null>(null)
  const [arming, setArming] = useState(false)
  const [exporting, setExporting] = useState<"json" | "csv" | null>(null)
  const [exportedAt, setExportedAt] = useState("")
  const [permission, setPermission] = useState(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported",
  )

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    try {
      await api("/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          username: String(form.get("username") ?? ""),
          program: String(form.get("program") ?? ""),
          semester: String(form.get("semester") ?? ""),
          bio: String(form.get("bio") ?? ""),
        }),
      })
      await refresh()
      toast("Profile saved.")
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Your profile could not be saved.", true)
    } finally {
      setSaving(false)
    }
  }

  /**
   * Export.
   *
   * The file is built from `GET /export`, which re-reads the account's rows on
   * the server at the moment it is asked. Nothing here is assembled from what the
   * tab already has in memory, so a record edited in another session is still
   * current in the download. The button only reports success once the file has
   * actually been produced from a successful response.
   */
  async function runExport(format: "json" | "csv") {
    if (exporting) return
    setExporting(format)
    try {
      const document = await api<ExportDocument>("/export")
      if (!document || document.format !== "llamastu-export") {
        throw new Error("The export could not be generated.")
      }
      const stamp = new Date().toISOString().slice(0, 10)
      const base = `llamastu-export-${safeFileName(data.user.email || "learner")}-${stamp}`
      if (format === "json") {
        downloadFile(`${base}.json`, buildExportJson(document), "application/json")
      } else {
        downloadFile(`${base}.csv`, buildExportCsv(document), "text/csv")
      }
      setExportedAt(document.generatedAt)
      toast(
        `Export ready — ${document.materials.length} materials, ${document.notes.length} notes, ${
          document.studyActivity.length
        } study records.`,
      )
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "The export could not be generated.", true)
    } finally {
      setExporting(null)
    }
  }

  /**
   * Enables reminders on this device.
   *
   * Permission, the service worker, the push subscription and the server-side
   * record are four separate steps, and the result says which of them actually
   * happened. A granted permission alone is never reported as working background
   * push.
   */
  async function requestNotifications() {
    if (!("Notification" in window)) return
    if (arming) return
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
      await loadPushState()
      toast(result.message, !result.ok)
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Reminders could not be enabled.", true)
    } finally {
      setArming(false)
    }
  }

  const loadPushState = useCallback(async () => {
    try {
      const [key, subs] = await Promise.all([
        api<{ configured: boolean; publicKey?: string | null }>("/push/public-key"),
        api<{ count: number; active: boolean }>("/push/subscriptions"),
      ])
      const registration = await navigator.serviceWorker?.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      setPushState({
        configured: Boolean(key?.configured),
        subscribed: Boolean(subscription) || Number(subs?.count ?? 0) > 0,
      })
    } catch {
      setPushState({ configured: false, subscribed: false })
    }
  }, [])

  useEffect(() => {
    void loadPushState()
  }, [loadPushState])

  async function markAllRead() {
    try {
      const result = await api<{ count: number }>("/notifications/read-all", { method: "POST" })
      await refresh()
      toast(result.count ? `${result.count} notifications marked as read.` : "Nothing to mark.")
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Notifications could not be updated.", true)
    }
  }

  const unread = data.notifications.filter((item) => !item.read).length

  return (
    <>
      <PageHead
        eyebrow="ACCOUNT & PREFERENCES"
        title="Settings"
        text="Manage your profile, appearance and reminders."
      />

      <div className="settings-content">
        <section className="card preference-card">
          <div className="setting-title">
            <span className="eyebrow">PROFILE</span>
            <h2>Your details</h2>
          </div>
          <form className="profile-form" onSubmit={saveProfile}>
            <div className="form-grid">
              <label>
                Name
                <input name="name" defaultValue={data.profile.name} required />
              </label>
              <label>
                Username
                <input name="username" defaultValue={data.profile.username} />
              </label>
              <label>
                Email
                <input value={data.user.email} disabled />
              </label>
              <label>
                Program
                <input
                  name="program"
                  defaultValue={data.profile.program}
                  placeholder="Information Technology"
                />
              </label>
              <label>
                Semester
                <input name="semester" defaultValue={data.profile.semester} placeholder="4" />
              </label>
            </div>
            <label>
              Bio
              <textarea name="bio" defaultValue={data.profile.bio} />
            </label>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save profile"}
            </Button>
          </form>
        </section>

        <section className="card preference-card">
          <div className="setting-title">
            <span className="eyebrow">PREFERENCES</span>
            <h2>Appearance & reminders</h2>
          </div>
          <div className="setting-row">
            <div className="setting-icon">
              <Icon name="moon" />
            </div>
            <span>
              <b>Warm dark mode</b>
              <small>Use a darker palette for evening study.</small>
            </span>
            <button
              type="button"
              className={`switch ${dark ? "on" : ""}`}
              onClick={() => setDark(!dark)}
              aria-pressed={dark}
              aria-label="Toggle dark mode"
            >
              <i />
            </button>
          </div>
          <div className="setting-row">
            <div className="setting-icon">
              <Icon name="bell" />
            </div>
            <span>
              <b>Study reminders</b>
              <small>
                {permission === "unsupported"
                  ? "This browser does not support desktop notifications."
                  : permission === "denied"
                    ? "Blocked for this site in your browser settings. In-app reminders still work."
                    : permission === "granted"
                      ? pushState === null
                        ? "Notifications allowed. Checking this device…"
                        : pushState.subscribed
                          ? `Notifications allowed and armed on this device${
                              pushState.configured
                                ? ", including while Llamastu is closed."
                                : ". Background push needs a VAPID key on the backend."
                            }`
                          : "Notifications allowed, but this device has no push subscription yet."
                      : "Turn on reminders to be notified before your agenda starts."}
              </small>
            </span>
            <Button
              variant="secondary"
              onClick={requestNotifications}
              disabled={
                arming ||
                permission === "unsupported" ||
                permission === "denied" ||
                (permission === "granted" && Boolean(pushState?.subscribed))
              }
            >
              {arming
                ? "Enabling…"
                : permission === "granted" && pushState?.subscribed
                  ? "Enabled"
                  : permission === "granted"
                    ? "Arm push"
                    : "Enable reminders"}
            </Button>
          </div>
          <div className="setting-row">
            <div className="setting-icon">
              <Icon name="check" />
            </div>
            <span>
              <b>Notifications</b>
              <small>
                {unread} unread of {data.notifications.length}
              </small>
            </span>
            <Button variant="secondary" onClick={markAllRead}>
              Mark all as read
            </Button>
          </div>
          <div className="setting-row">
            <div className="setting-icon">
              <Icon name="download" />
            </div>
            <span>
              <b>Export your data</b>
              <small>
                {exportedAt
                  ? `Last export generated ${new Date(exportedAt).toLocaleString("en-GB")}.`
                  : "Reads your latest saved records from the server when you ask for them."}
              </small>
            </span>
            <div className="setting-actions">
              <Button
                variant="secondary"
                icon="download"
                onClick={() => void runExport("json")}
                disabled={exporting !== null}
              >
                {exporting === "json" ? "Preparing…" : "JSON"}
              </Button>
              <Button
                variant="secondary"
                icon="download"
                onClick={() => void runExport("csv")}
                disabled={exporting !== null}
              >
                {exporting === "csv" ? "Preparing…" : "CSV"}
              </Button>
            </div>
          </div>
        </section>

        <section className="card preference-card danger-card">
          <div className="setting-title">
            <span className="eyebrow">SESSION</span>
            <h2>Sign out</h2>
          </div>
          <p className="muted">
            Signing out ends your session on this device. Your materials, notes, agenda and progress
            stay saved, and they come back when you sign in again.
          </p>
          <button className="logout-button" onClick={onLogout}>
            <Icon name="logout" /> Sign out
          </button>
        </section>
      </div>
    </>
  )
}

export default SettingsPage
