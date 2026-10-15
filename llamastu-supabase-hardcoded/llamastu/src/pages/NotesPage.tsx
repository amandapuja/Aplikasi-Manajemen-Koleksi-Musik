import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { Button, Empty, PageHead } from "../components/common"
import { Icon } from "../components/Icon"
import { api } from "../lib/api"
import { formatDate } from "../lib/rules"
import { getOpenNoteId, setOpenNoteId } from "../lib/uiState"
import type { AppData, Note, NoteShareMode, SharedNoteView } from "../types"

type Props = {
  data: AppData
  refresh: () => Promise<void>
  toast: (message: string, error?: boolean) => void
}

type FeedNote = {
  id: string
  title: string
  content: string
  materialId: string | null
  version: number
  updatedAt: string
}

type SyncState = "idle" | "syncing" | "synced" | "offline"

const FEED_INTERVAL_MS = 4000

/** `#/shared/<token>` deep link. */
function shareTokenFromLocation(): string {
  if (typeof window === "undefined") return ""
  const match = window.location.hash.match(/^#\/shared\/([A-Za-z0-9_-]+)$/)
  return match ? match[1] : ""
}

export function NotesPage({ data, refresh, toast }: Props) {
  const [selectedId, setSelectedId] = useState(() => getOpenNoteId() ?? data.notes[0]?.id ?? "")
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [materialId, setMaterialId] = useState("")
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed" | "idle" | "conflict">(
    "idle",
  )
  const [syncState, setSyncState] = useState<SyncState>("idle")
  const [share, setShare] = useState(false)
  const [shareMode, setShareMode] = useState<NoteShareMode>("private")
  const [sharedView, setSharedView] = useState<
    (SharedNoteView & { ownerName: string; token: string }) | null
  >(null)
  const [linkLoading, setLinkLoading] = useState(false)

  const editor = useRef<HTMLDivElement>(null)
  const loadedIdRef = useRef("")
  /** The revision the editor is currently based on. Every write carries it. */
  const loadedVersionRef = useRef(0)
  const dirtyRef = useRef(false)
  const sinceRef = useRef(new Date(0).toISOString())
  const channelRef = useRef<BroadcastChannel | null>(null)

  const listed = useMemo(
    () => data.notes.find((note) => note.id === selectedId) ?? null,
    [data.notes, selectedId],
  )
  /** A note opened through a share link when the account cannot otherwise see it. */
  const selected: Note | null = listed ?? (sharedView?.note.id === selectedId ? sharedView.note : null)

  const canEdit = useMemo(() => {
    if (!selected) return false
    if (sharedView && sharedView.note.id === selected.id) return sharedView.canEdit
    if (selected.ownerId === data.user.id) return true
    return selected.collaborators.some(
      (person) =>
        person.email.toLowerCase() === data.user.email.toLowerCase() &&
        person.permission === "editor",
    )
  }, [selected, sharedView, data.user.email, data.user.id])

  const isOwner = selected?.ownerId === data.user.id
  const noteList = useMemo(() => {
    if (!sharedView) return data.notes
    const known = data.notes.some((note) => note.id === sharedView.note.id)
    return known ? data.notes : [sharedView.note, ...data.notes]
  }, [data.notes, sharedView])

  /* ---------------- share-link deep link ---------------- */

  useEffect(() => {
    const token = shareTokenFromLocation()
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const result = await api<SharedNoteView & { ownerName: string }>(`/shared/${token}`)
        if (cancelled) return
        setSharedView({ ...result, token })
        loadedIdRef.current = ""
        setSelectedId(result.note.id)
        setOpenNoteId(result.note.id)
        toast(
          result.canEdit
            ? `Editing a note shared by ${result.ownerName}.`
            : `Viewing a read-only note shared by ${result.ownerName}.`,
        )
      } catch (reason) {
        if (cancelled) return
        toast(
          reason instanceof Error ? reason.message : "That share link could not be opened.",
          true,
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [toast])

  /* ---------------- note selection ---------------- */

  useEffect(() => {
    if (!noteList.length) {
      setSelectedId("")
      setOpenNoteId(null)
      return
    }
    if (!noteList.some((note) => note.id === selectedId)) {
      setSelectedId(noteList[0].id)
      setOpenNoteId(noteList[0].id)
    }
  }, [noteList, selectedId])

  // Load the editor only when a different note is opened, so typing never resets
  // the caret position.
  useEffect(() => {
    if (!selected) return
    if (loadedIdRef.current === selected.id) return
    loadedIdRef.current = selected.id
    loadedVersionRef.current = selected.version
    dirtyRef.current = false
    setTitle(selected.title)
    setContent(selected.content)
    setMaterialId(selected.materialId ?? "")
    setShareMode(selected.shareMode)
    if (editor.current) editor.current.innerHTML = selected.content
    setSaveState("idle")
  }, [selected])

  /* ---------------- saving, with optimistic concurrency ---------------- */

  useEffect(() => {
    if (!selected || !canEdit) return
    if (loadedIdRef.current !== selected.id) return
    if (
      title === selected.title &&
      content === selected.content &&
      materialId === (selected.materialId ?? "")
    ) {
      return
    }

    dirtyRef.current = true
    setSaveState("saving")
    const noteId = selected.id
    const timer = window.setTimeout(async () => {
      try {
        const saved = await api<Note>(`/notes/${noteId}`, {
          method: "PATCH",
          body: JSON.stringify({
            title,
            content,
            materialId: materialId || null,
            // The version the edit was based on. If the server has moved on, this
            // write is rejected rather than silently clobbering the newer text.
            expectedVersion: loadedVersionRef.current,
          }),
        })
        loadedVersionRef.current = saved.version
        dirtyRef.current = false
        setSaveState("saved")
        channelRef.current?.postMessage({ noteId, version: saved.version })
        await refresh()
      } catch (reason) {
        const code = (reason as { code?: string })?.code
        if (code === "VERSION_CONFLICT") {
          dirtyRef.current = true
          setSaveState("conflict")
        } else {
          dirtyRef.current = true
          setSaveState("failed")
          toast(reason instanceof Error ? reason.message : "The note could not be saved.", true)
        }
      }
    }, 900)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, materialId, selected?.id, canEdit])

  /* ---------------- real-time ---------------- */

  const pullChanges = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSyncState("offline")
      return
    }
    setSyncState("syncing")
    try {
      const feed = await api<{ serverTime: string; notes: FeedNote[] }>(
        `/notes/feed?since=${encodeURIComponent(sinceRef.current)}`,
      )
      sinceRef.current = feed.serverTime
      setSyncState("synced")

      const incoming = feed.notes.find((note) => note.id === loadedIdRef.current)
      if (!incoming) return
      if (incoming.version <= loadedVersionRef.current) return

      if (dirtyRef.current) {
        // Unsaved local edits plus a newer server version: never overwrite.
        setSaveState("conflict")
        return
      }

      loadedVersionRef.current = incoming.version
      setTitle(incoming.title)
      setContent(incoming.content)
      setMaterialId(incoming.materialId ?? "")
      if (editor.current) editor.current.innerHTML = incoming.content
      setSaveState("saved")
      await refresh()
    } catch {
      setSyncState("offline")
    }
  }, [refresh])

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return undefined
    const channel = new BroadcastChannel("llamastu-notes")
    channelRef.current = channel
    channel.onmessage = () => {
      void pullChanges()
    }
    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [pullChanges])

  useEffect(() => {
    // Reconnect immediately when the browser comes back online, then keep a
    // steady poll while the page is visible.
    const onOnline = () => void pullChanges()
    window.addEventListener("online", onOnline)
    const timer = window.setInterval(() => {
      if (document.hidden) return
      void pullChanges()
    }, FEED_INTERVAL_MS)
    void pullChanges()
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("online", onOnline)
    }
  }, [pullChanges])

  /* ---------------- actions ---------------- */

  async function create() {
    try {
      const note = await api<Note>("/notes", {
        method: "POST",
        body: JSON.stringify({ title: "Untitled note" }),
      })
      await refresh()
      loadedIdRef.current = ""
      setSelectedId(note.id)
      setOpenNoteId(note.id)
      toast("New note created.")
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "The note could not be created.", true)
    }
  }

  async function remove() {
    if (!selected || !confirm(`Delete “${selected.title}”? This cannot be undone.`)) return
    try {
      await api(`/notes/${selected.id}`, { method: "DELETE" })
      loadedIdRef.current = ""
      setSelectedId("")
      setOpenNoteId(null)
      await refresh()
      toast("Note deleted.")
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "The note could not be deleted.", true)
    }
  }

  function command(name: string, value?: string) {
    editor.current?.focus()
    document.execCommand(name, false, value)
    setContent(editor.current?.innerHTML ?? "")
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    try {
      await api(`/notes/${selected.id}/share`, {
        method: "POST",
        body: JSON.stringify({
          email: String(form.get("email") ?? ""),
          permission: form.get("permission"),
        }),
      })
      await refresh()
      formElement.reset()
      toast("Collaborator added.")
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Sharing failed.", true)
    }
  }

  async function removeCollaborator(personId: string, email: string) {
    if (!selected) return
    try {
      await api(`/notes/${selected.id}/collaborators/${personId}`, { method: "DELETE" })
      await refresh()
      toast(`${email} removed from this note.`)
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Could not remove the collaborator.", true)
    }
  }

  async function changeLinkMode(mode: NoteShareMode) {
    if (!selected) return
    setLinkLoading(true)
    try {
      const result = await api<{ shareToken: string | null; shareMode: NoteShareMode }>(
        `/notes/${selected.id}/share`,
        { method: "PATCH", body: JSON.stringify({ mode }) },
      )
      setShareMode(result.shareMode)
      await refresh()
      toast(
        result.shareMode === "private"
          ? "Sharing turned off. The old link no longer opens this note."
          : result.shareMode === "view"
            ? "Anyone with the link can read this note."
            : "Anyone with the link can edit this note.",
      )
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Sharing could not be changed.", true)
    } finally {
      setLinkLoading(false)
    }
  }

  async function revokeEverything() {
    if (!selected) return
    if (!confirm("Turn off link sharing and remove every collaborator?")) return
    setLinkLoading(true)
    try {
      await api(`/notes/${selected.id}/share`, { method: "DELETE" })
      await refresh()
      setShareMode("private")
      toast("All access revoked.")
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Access could not be revoked.", true)
    } finally {
      setLinkLoading(false)
    }
  }

  function copyLink() {
    if (!selected?.shareToken) return
    const url = `${window.location.origin}${window.location.pathname}#/shared/${selected.shareToken}`
    void navigator.clipboard?.writeText(url).then(
      () => toast("Share link copied."),
      () => toast(url, false),
    )
  }

  function reloadFromServer() {
    loadedIdRef.current = ""
    dirtyRef.current = false
    setSaveState("idle")
    void refresh()
    toast("Reloaded the newest saved version.")
  }

  const shareUrl = selected?.shareToken
    ? `${typeof window === "undefined" ? "" : window.location.origin + window.location.pathname}#/shared/${selected.shareToken}`
    : ""

  return (
    <>
      <PageHead
        eyebrow="COLLABORATIVE WORKSPACE"
        title="Notes"
        text="Notes save to your account, sync in real time while a note is open, and can be shared with another account or through a read-only link."
        action={
          <Button icon="plus" onClick={create}>
            New note
          </Button>
        }
      />

      {sharedView && (
        <div className="shared-banner" role="status">
          <Icon name="share" size={15} />
          <span>
            <b>{sharedView.canEdit ? "Shared with you for editing" : "Shared with you read-only"}</b>
            <small>
              Owner: {sharedView.ownerName}
              {sharedView.canEdit ? "" : " · you cannot change this note"}
            </small>
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              window.location.hash = ""
              setSharedView(null)
              setSelectedId(data.notes[0]?.id ?? "")
            }}
          >
            Leave shared note
          </button>
        </div>
      )}

      {noteList.length === 0 ? (
        <Empty
          icon="edit"
          title="Create your first note"
          text="Start a rich document here, or open any material and create a note connected to it."
          action={<Button onClick={create}>Create note</Button>}
        />
      ) : (
        <div className="notes-workspace">
          <aside className="card note-list">
            {noteList.map((note) => (
              <button
                key={note.id}
                className={selectedId === note.id ? "active" : ""}
                onClick={() => {
                  loadedIdRef.current = ""
                  setSelectedId(note.id)
                  setOpenNoteId(note.id)
                }}
              >
                <Icon name="file" size={16} />
                <span>
                  <b>{note.title}</b>
                  <small>{formatDate(note.updatedAt)}</small>
                </span>
                {(note.collaborators.length > 0 || note.shareMode !== "private") && (
                  <Icon name="share" size={14} />
                )}
              </button>
            ))}
          </aside>

          {selected ? (
            <section className="card document-editor">
              <div className="editor-top">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  aria-label="Note title"
                  disabled={!canEdit}
                />
                <div>
                  <span className={`save-state ${saveState}`}>
                    {saveState === "saving"
                      ? "Saving…"
                      : saveState === "saved"
                        ? "Saved"
                        : saveState === "failed"
                          ? "Save failed"
                          : saveState === "conflict"
                            ? "Newer version on the server"
                            : canEdit
                              ? "Up to date"
                              : "View only"}
                  </span>
                  <span className={`sync-state ${syncState}`} aria-live="polite">
                    {syncState === "syncing"
                      ? "Syncing…"
                      : syncState === "synced"
                        ? "Live"
                        : syncState === "offline"
                          ? "Offline"
                          : ""}
                  </span>
                  <Button
                    variant="secondary"
                    icon="share"
                    onClick={() => setShare(true)}
                    disabled={!isOwner}
                    ariaLabel="Share this note"
                  >
                    Share
                  </Button>
                  {isOwner && (
                    <button
                      className="icon-button danger"
                      onClick={remove}
                      aria-label={`Delete ${selected.title}`}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </div>
              </div>

              {saveState === "conflict" && (
                <div className="conflict-note" role="alert">
                  <b>This note changed somewhere else.</b>
                  <p>
                    Your edit is still in the box below and has not been sent, so nothing has been
                    overwritten. Reload the saved version to continue from the newest text.
                  </p>
                  <Button variant="secondary" onClick={reloadFromServer}>
                    Reload the newest version
                  </Button>
                </div>
              )}

              <div className="note-meta-row">
                <label>
                  Linked material
                  <select
                    value={materialId}
                    onChange={(event) => setMaterialId(event.target.value)}
                    disabled={!canEdit}
                  >
                    <option value="">Not linked</option>
                    {data.materials.map((material) => (
                      <option key={material.id} value={material.id}>
                        {material.title || material.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {canEdit && (
                <div className="editor-toolbar">
                  <button type="button" onClick={() => command("undo")} aria-label="Undo">
                    ↶
                  </button>
                  <button type="button" onClick={() => command("redo")} aria-label="Redo">
                    ↷
                  </button>
                  <select
                    onChange={(event) => command("formatBlock", event.target.value)}
                    defaultValue="p"
                    aria-label="Text style"
                  >
                    <option value="p">Body</option>
                    <option value="h2">Heading</option>
                    <option value="h3">Subheading</option>
                  </select>
                  <button type="button" onClick={() => command("bold")} aria-label="Bold">
                    <b>B</b>
                  </button>
                  <button type="button" onClick={() => command("italic")} aria-label="Italic">
                    <i>I</i>
                  </button>
                  <button type="button" onClick={() => command("underline")} aria-label="Underline">
                    <u>U</u>
                  </button>
                  <button
                    type="button"
                    onClick={() => command("insertUnorderedList")}
                    aria-label="Bulleted list"
                  >
                    • List
                  </button>
                  <button
                    type="button"
                    onClick={() => command("insertOrderedList")}
                    aria-label="Numbered list"
                  >
                    1. List
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const link = prompt("Paste a link")
                      if (link) command("createLink", link)
                    }}
                    aria-label="Insert link"
                  >
                    Link
                  </button>
                </div>
              )}

              <div
                ref={editor}
                className="editor-canvas"
                contentEditable={canEdit}
                suppressContentEditableWarning
                onInput={(event) => setContent(event.currentTarget.innerHTML)}
                aria-label={`Note content for ${selected.title}`}
              />

              <div className="collaborator-strip">
                <span>
                  <Icon name="user" size={13} /> Owner: {selected.ownerEmail || data.user.email}
                </span>
                {selected.collaborators.map((person) => (
                  <span key={person.id}>
                    <i />
                    {person.email} · {person.permission}
                    {isOwner && (
                      <button
                        type="button"
                        className="chip-remove"
                        aria-label={`Remove ${person.email}`}
                        onClick={() => removeCollaborator(person.id, person.email)}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    )}
                  </span>
                ))}
                {selected.shareMode !== "private" && (
                  <span className="link-chip">
                    <i />
                    Link sharing · {selected.shareMode === "view" ? "read-only" : "can edit"}
                  </span>
                )}
                <span className="muted small">Revision {selected.version}</span>
              </div>
            </section>
          ) : (
            <Empty
              icon="edit"
              title="Select a note"
              text="Choose a note from the list to start editing."
            />
          )}
        </div>
      )}

      {share && selected && (
        <div className="modal-backdrop">
          <div className="modal card share-modal">
            <div className="section-head">
              <div>
                <span className="eyebrow">SHARE</span>
                <h2>“{selected.title}”</h2>
              </div>
              <button type="button" onClick={() => setShare(false)} aria-label="Close">
                <Icon name="close" />
              </button>
            </div>

            <p className="muted small">
              This note is <b>{selected.shareMode === "private" ? "private" : "shared"}</b> right now.
              Access is enforced by the server on every read and write, not by this screen.
            </p>

            <label>
              Link access
              <select
                value={shareMode}
                onChange={(event) => void changeLinkMode(event.target.value as NoteShareMode)}
                disabled={linkLoading}
              >
                <option value="private">Private — only me and invited people</option>
                <option value="view">Anyone with the link can read</option>
                <option value="edit">Anyone with the link can edit</option>
              </select>
            </label>

            {shareMode !== "private" && shareUrl && (
              <div className="share-link">
                <input value={shareUrl} readOnly aria-label="Shareable link" />
                <Button variant="secondary" onClick={copyLink}>
                  Copy
                </Button>
              </div>
            )}

            <form className="share-invite" onSubmit={invite}>
              <span className="eyebrow">INVITE AN ACCOUNT</span>
              <div className="share-invite-row">
                <input name="email" type="email" required placeholder="teammate@campus.edu" />
                <select name="permission" defaultValue="editor" aria-label="Permission">
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <Button type="submit">Add</Button>
              </div>
            </form>

            <div className="share-people">
              <span className="eyebrow">PEOPLE WITH ACCESS</span>
              <div className="share-person">
                <b>{selected.ownerEmail || data.user.email}</b>
                <small>Owner</small>
              </div>
              {selected.collaborators.map((person) => (
                <div className="share-person" key={person.id}>
                  <b>{person.email}</b>
                  <small>{person.permission}</small>
                  <button
                    type="button"
                    className="chip-remove"
                    aria-label={`Remove ${person.email}`}
                    onClick={() => removeCollaborator(person.id, person.email)}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))}
            </div>

            <div className="share-footer">
              <Button variant="danger" onClick={revokeEverything} disabled={linkLoading}>
                Revoke all access
              </Button>
              <Button variant="ghost" onClick={() => setShare(false)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default NotesPage
