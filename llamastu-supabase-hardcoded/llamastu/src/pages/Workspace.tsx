import { useEffect, useRef, useState } from "react"
import { Button, Empty, Mascot, PageHead, Progress } from "../components/common"
import { Icon } from "../components/Icon"
import { GameWorld } from "../game/GameWorld"
import { api, resolveMaterialFileUrl } from "../lib/api"
import { buildStudyPack, downloadFile, safeFileName } from "../lib/export"
import { formatBytes, formatDate, materialProgress } from "../lib/rules"
import { readWorkspaceView, setOpenNoteId, writeWorkspaceView } from "../lib/uiState"
import type { AppData, Material, Note, Page } from "../types"
import { Quiz } from "./Quiz"

type Props = {
  material: Material
  data: AppData
  go: (page: Page) => void
  refresh: () => Promise<void>
  toast: (message: string, error?: boolean) => void
}

export function Workspace({ material, data, go, refresh, toast }: Props) {
  const stored = readWorkspaceView(material.id)
  const [tab, setTab] = useState<"study" | "quiz" | "game">(stored.tab)
  const [fileUrl, setFileUrl] = useState("")
  const [fileError, setFileError] = useState("")
  const [loadingFile, setLoadingFile] = useState(false)
  const [summary, setSummary] = useState(material.summary ?? "")
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState(stored.noteDraft)
  const [flashIndex, setFlashIndex] = useState(0)
  const [showBack, setShowBack] = useState(false)
  const [manualText, setManualText] = useState(material.extractedText ?? "")
  const [processing, setProcessing] = useState(false)
  const [processError, setProcessError] = useState("")
  const [addingToCalendar, setAddingToCalendar] = useState(false)
  const objectUrlRef = useRef("")

  useEffect(() => {
    setTab(readWorkspaceView(material.id).tab)
    setSummary(material.summary ?? "")
    setFlashIndex(0)
    setShowBack(false)
  }, [material.id, material.summary])

  useEffect(() => {
    writeWorkspaceView(material.id, { tab })
  }, [material.id, tab])

  useEffect(() => {
    writeWorkspaceView(material.id, { noteDraft: note })
  }, [material.id, note])

  useEffect(() => {
    let cancelled = false
    // Materials created by pasting text (and the seeded demo materials) have no
    // stored file at all. Trying to resolve one would surface a pointless error
    // in the viewer, so the extracted text is shown directly instead.
    if (!material.storagePath) {
      setFileUrl("")
      setFileError("")
      setLoadingFile(false)
      return
    }
    setLoadingFile(true)
    setFileError("")
    resolveMaterialFileUrl(material)
      .then((url) => {
        if (cancelled) {
          if (url.startsWith("blob:")) URL.revokeObjectURL(url)
          return
        }
        objectUrlRef.current = url
        setFileUrl(url)
      })
      .catch((reason) => {
        if (!cancelled) {
          setFileError(
            reason instanceof Error ? reason.message : "The stored file could not be opened.",
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingFile(false)
      })
    return () => {
      cancelled = true
      if (objectUrlRef.current.startsWith("blob:")) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = ""
      }
    }
  }, [material.id, material.storagePath])

  async function saveSummary() {
    setSaving(true)
    try {
      await api(`/materials/${material.id}`, {
        method: "PATCH",
        body: JSON.stringify({ summary }),
      })
      await refresh()
      toast("Summary saved to your account.")
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "The summary could not be saved.", true)
    } finally {
      setSaving(false)
    }
  }

  async function createNote() {
    try {
      const created = await api<Note>("/notes", {
        method: "POST",
        body: JSON.stringify({
          title: `Notes — ${material.title || material.name}`,
          materialId: material.id,
          content: note.trim() ? `<p>${note.replace(/\n/g, "</p><p>")}</p>` : "",
        }),
      })
      await refresh()
      setOpenNoteId(created.id)
      go("notes")
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "The note could not be created.", true)
    }
  }

  async function submitManualText() {
    setProcessError("")
    if (manualText.trim().length < 60) {
      setProcessError("Paste at least 60 words so questions can be generated.")
      return
    }
    setProcessing(true)
    try {
      await api(`/materials/${material.id}/process`, {
        method: "POST",
        body: JSON.stringify({ questionCount: 10, difficulty: "medium", text: manualText }),
      })
      await refresh()
      toast("Your study world is ready.")
    } catch (reason) {
      setProcessError(reason instanceof Error ? reason.message : "Processing failed.")
      await refresh()
    } finally {
      setProcessing(false)
    }
  }

  /** Creates a linked study agenda with a 15-minute reminder. */
  async function addToCalendar() {
    setAddingToCalendar(true)
    try {
      const start = new Date()
      start.setDate(start.getDate() + 1)
      start.setHours(19, 0, 0, 0)
      const end = new Date(start.getTime() + 60 * 60 * 1000)
      await api("/calendar", {
        method: "POST",
        body: JSON.stringify({
          title: `Study: ${material.title || material.name}`,
          description: `Focused study session for ${material.name}.`,
          category: "study",
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          reminderMinutes: 15,
          repeatRule: "none",
          materialId: material.id,
        }),
      })
      await refresh()
      toast(`Agenda created for ${formatDate(start.toISOString())} with a 15-minute reminder.`)
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "The agenda could not be created.", true)
    } finally {
      setAddingToCalendar(false)
    }
  }

  function exportPack() {
    downloadFile(
      `${safeFileName(material.title || material.name)}-study-pack.md`,
      buildStudyPack(material),
    )
    toast("Study pack downloaded.")
  }

  const relatedNotes = data.notes.filter((item) => item.materialId === material.id)
  const ready = material.status === "ready"

  return (
    <>
      <PageHead
        eyebrow={material.subject || "STUDY WORKSPACE"}
        title={material.title || material.name}
        text="Read the source, refine the grounded summary, take the quiz, or enter its generated world."
        action={
          <div className="head-actions">
            <Button
              variant="secondary"
              icon="calendar"
              onClick={addToCalendar}
              disabled={!ready || addingToCalendar}
            >
              {addingToCalendar ? "Adding…" : "Add to Calendar"}
            </Button>
            <Button variant="secondary" icon="download" onClick={exportPack} disabled={!ready}>
              Study pack
            </Button>
            <Button variant="secondary" onClick={() => go("materials")}>
              Back to materials
            </Button>
          </div>
        }
      />

      {(material.status === "needs_text" || material.status === "failed") && (
        <section className="card manual-text-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">TEXT REQUIRED</span>
              <h2>Add the material text</h2>
            </div>
            <Mascot pose="study" />
          </div>
          <p className="muted">
            {material.errorMessage ??
              "This file could not be converted to text automatically. Paste its content below and Llamastu will build the summary, flashcards and challenges from it."}
          </p>
          <textarea
            rows={8}
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
            placeholder="Paste the material text…"
            aria-label="Material text"
          />
          {processError && (
            <div className="form-alert error" role="alert">
              <Icon name="close" size={15} />
              {processError}
            </div>
          )}
          <Button onClick={submitManualText} disabled={processing}>
            {processing ? (
              <>
                <span className="button-spinner" /> Generating…
              </>
            ) : (
              "Generate study world"
            )}
          </Button>
        </section>
      )}

      {ready && (
        <>
          <div className="workspace-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "study"}
              className={tab === "study" ? "active" : ""}
              onClick={() => setTab("study")}
            >
              <Icon name="book" /> Study
            </button>
            <button
              role="tab"
              aria-selected={tab === "quiz"}
              className={tab === "quiz" ? "active" : ""}
              onClick={() => setTab("quiz")}
            >
              <Icon name="quiz" /> Quiz ({material.questions.length})
            </button>
            <button
              role="tab"
              aria-selected={tab === "game"}
              className={tab === "game" ? "active" : ""}
              onClick={() => setTab("game")}
            >
              <Icon name="play" /> Adventure world
            </button>
          </div>

          {tab === "study" && (
            <div className="study-workspace">
              <aside className="card material-navigation">
                <span className="eyebrow">MATERIAL</span>
                <h3>{material.name}</h3>
                <p>
                  {formatBytes(material.size)} · {material.wordCount} words
                </p>
                <p className="muted small">Processed {formatDate(material.processedAt ?? material.updatedAt)}</p>
                <Progress
                  value={materialProgress(data, material.id)}
                  label={`World progress ${materialProgress(data, material.id)}%`}
                />
                <small className="muted">
                  {data.games[material.id]?.openedGates.length ?? 0} of{" "}
                  {material.questions.length} gates cleared in the adventure world
                </small>

                <div className="objective-list">
                  <b>Learning objectives</b>
                  {material.objectives.length === 0 ? (
                    <span className="muted">No objectives were generated.</span>
                  ) : (
                    material.objectives.map((item, position) => (
                      <span key={`${item}-${position}`}>
                        <i>{position + 1}</i>
                        {item}
                      </span>
                    ))
                  )}
                </div>

                <div className="objective-list">
                  <b>Key points</b>
                  {material.keyPoints.length === 0 ? (
                    <span className="muted">No key points were generated.</span>
                  ) : (
                    material.keyPoints.map((item, position) => (
                      <span key={`${item}-${position}`}>
                        <i>{position + 1}</i>
                        {item}
                      </span>
                    ))
                  )}
                </div>

                <div className="objective-list">
                  <b>Connected notes</b>
                  {relatedNotes.length === 0 ? (
                    <span className="muted">No notes linked to this material yet.</span>
                  ) : (
                    relatedNotes.map((item) => (
                      <button
                        key={item.id}
                        className="link-row"
                        onClick={() => {
                          setOpenNoteId(item.id)
                          go("notes")
                        }}
                      >
                        <Icon name="edit" size={14} />
                        {item.title}
                      </button>
                    ))
                  )}
                </div>
              </aside>

              <section className="card document-viewer">
                {loadingFile ? (
                  <div className="viewer-loading">Loading your stored file…</div>
                ) : fileError ? (
                  <div className="viewer-loading error">{fileError}</div>
                ) : material.type === "application/pdf" && fileUrl ? (
                  <iframe src={fileUrl} title={material.name} />
                ) : material.type.startsWith("image/") && fileUrl ? (
                  <img src={fileUrl} alt={`Uploaded material ${material.name}`} />
                ) : material.extractedText ? (
                  <div className="extracted-view">
                    <span className="eyebrow">EXTRACTED TEXT</span>
                    <pre>{material.extractedText}</pre>
                    {fileUrl && (
                      <a className="file-link" href={fileUrl} download={material.name}>
                        <Icon name="download" size={15} /> Download the original file
                      </a>
                    )}
                  </div>
                ) : fileUrl ? (
                  <div className="viewer-loading">
                    This format cannot be previewed.{" "}
                    <a href={fileUrl} download={material.name}>
                      Download the original file
                    </a>
                  </div>
                ) : (
                  <div className="viewer-loading">No stored file for this material.</div>
                )}
              </section>

              <aside className="card notes-panel">
                <div className="section-head">
                  <div>
                    <span className="eyebrow">EXTRACTIVE SUMMARY</span>
                    <h2>Editable summary</h2>
                  </div>
                  <span className={saving ? "save-state saving" : "save-state"}>
                    {saving ? "Saving…" : "Ready"}
                  </span>
                </div>
                <textarea
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  aria-label="Material summary"
                />
                <Button className="full" onClick={saveSummary} disabled={saving}>
                  Save summary
                </Button>

                <div className="notes-divider" />
                <span className="eyebrow">FLASHCARDS</span>
                {material.flashcards.length === 0 ? (
                  <p className="muted">No flashcards were generated for this material.</p>
                ) : (
                  <div className="flashcard">
                    <div className="flashcard-counter">
                      Card {flashIndex + 1} of {material.flashcards.length}
                    </div>
                    <div className="flashcard-body">
                      {showBack
                        ? material.flashcards[flashIndex].back
                        : material.flashcards[flashIndex].front}
                    </div>
                    <div className="flashcard-actions">
                      <Button
                        variant="secondary"
                        onClick={() => setShowBack((value) => !value)}
                      >
                        {showBack ? "Show question" : "Show answer"}
                      </Button>
                      <button
                        className="icon-button"
                        aria-label="Previous flashcard"
                        disabled={flashIndex === 0}
                        onClick={() => {
                          setFlashIndex((value) => Math.max(0, value - 1))
                          setShowBack(false)
                        }}
                      >
                        <Icon name="chevron-left" size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Next flashcard"
                        disabled={flashIndex >= material.flashcards.length - 1}
                        onClick={() => {
                          setFlashIndex((value) =>
                            Math.min(material.flashcards.length - 1, value + 1),
                          )
                          setShowBack(false)
                        }}
                      >
                        <Icon name="chevron-right" size={16} />
                      </button>
                    </div>
                  </div>
                )}

                <div className="notes-divider" />
                <span className="eyebrow">PERSONAL NOTE</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Write a thought while studying…"
                  aria-label="Personal note draft"
                />
                <Button variant="secondary" className="full" onClick={createNote}>
                  Create connected note
                </Button>
              </aside>
            </div>
          )}

          {tab === "quiz" && <Quiz material={material} refresh={refresh} toast={toast} />}

          {tab === "game" && (
            <GameWorld
              material={material}
              refresh={refresh}
              toast={toast}
              onExit={() => go("materials")}
              preferredCharacter={data.progress.character.model}
            />
          )}
        </>
      )}

      {material.status === "processing" && (
        <Empty
          icon="spark"
          title="Still processing"
          text="Llamastu is generating your summary, flashcards and challenges. Refresh in a moment."
          action={
            <Button variant="secondary" onClick={() => refresh()}>
              Refresh
            </Button>
          }
        />
      )}
    </>
  )
}

export default Workspace
