import { useRef, useState, type FormEvent } from "react"
import { Button, Empty, Mascot, PageHead, Progress } from "../components/common"
import { Icon } from "../components/Icon"
import { api, uploadMaterial } from "../lib/api"
import { describeAcceptedTypes } from "../lib/extract"
import { formatBytes, formatDate } from "../lib/rules"
import type { AppData, Material } from "../types"

type Props = {
  data: AppData
  refresh: () => Promise<void>
  openMaterial: (material: Material) => void
  toast: (message: string, error?: boolean) => void
}

type UploadState = { name: string; progress: number; stage: string } | null

export function Materials({ data, refresh, openMaterial, toast }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [upload, setUpload] = useState<UploadState>(null)
  const [editing, setEditing] = useState<Material | null>(null)
  const [pasting, setPasting] = useState(false)
  const [pasteBusy, setPasteBusy] = useState(false)
  const [pasteError, setPasteError] = useState("")
  const [busyId, setBusyId] = useState("")

  const filtered = data.materials.filter((item) => {
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    return (
      item.name.toLowerCase().includes(needle) ||
      (item.title ?? "").toLowerCase().includes(needle) ||
      (item.subject ?? "").toLowerCase().includes(needle)
    )
  })

  async function accept(file?: File) {
    if (!file || upload) return
    setUpload({ name: file.name, progress: 0, stage: "Preparing…" })
    try {
      const material = await uploadMaterial(
        file,
        {},
        (progress, stage) => setUpload({ name: file.name, progress, stage }),
      )
      await refresh()
      if (material.status === "ready") {
        toast(`${material.title} is ready with ${material.questions.length} challenges.`)
        setUpload(null)
        openMaterial(material)
      } else if (material.status === "needs_text") {
        toast(
          "The file is stored. Add its text to generate the study world.",
          true,
        )
        setUpload(null)
      } else {
        toast("The material was stored but could not be processed.", true)
        setUpload(null)
      }
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Upload failed. Please try again.", true)
      setUpload(null)
      await refresh()
    } finally {
      if (input.current) input.current.value = ""
    }
  }

  async function remove(material: Material) {
    if (!confirm(`Delete “${material.title || material.name}”? The stored file is removed too.`)) {
      return
    }
    setBusyId(material.id)
    try {
      await api(`/materials/${material.id}`, { method: "DELETE" })
      await refresh()
      toast("Material deleted.")
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Delete failed.", true)
    } finally {
      setBusyId("")
    }
  }

  async function reprocess(material: Material) {
    setBusyId(material.id)
    try {
      await api(`/materials/${material.id}/process`, {
        method: "POST",
        body: JSON.stringify({ questionCount: 10, difficulty: "medium" }),
      })
      await refresh()
      toast("Challenges regenerated from the stored text.")
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Processing failed.", true)
      await refresh()
    } finally {
      setBusyId("")
    }
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    const form = new FormData(event.currentTarget)
    try {
      await api(`/materials/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: String(form.get("title") ?? ""),
          subject: String(form.get("subject") ?? ""),
        }),
      })
      await refresh()
      setEditing(null)
      toast("Material details updated.")
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Update failed.", true)
    }
  }

  async function createFromText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasteError("")
    setPasteBusy(true)
    const form = new FormData(event.currentTarget)
    const text = String(form.get("text") ?? "").trim()
    const title = String(form.get("title") ?? "").trim() || "Pasted notes"
    if (text.length < 60) {
      setPasteError("Paste at least 60 words so questions can be generated.")
      setPasteBusy(false)
      return
    }
    try {
      const created = await api<Material>("/materials", {
        method: "POST",
        body: JSON.stringify({
          name: `${title}.txt`,
          title,
          type: "text/plain",
          size: new Blob([text]).size,
          extractedText: text,
          status: "processing",
        }),
      })
      await api(`/materials/${created.id}/process`, {
        method: "POST",
        body: JSON.stringify({ questionCount: 10, difficulty: "medium", text }),
      })
      await refresh()
      setPasting(false)
      toast("Study world created from your pasted text.")
    } catch (reason) {
      setPasteError(reason instanceof Error ? reason.message : "Processing failed.")
      await refresh()
    } finally {
      setPasteBusy(false)
    }
  }

  return (
    <>
      <PageHead
        eyebrow="YOUR LIBRARY"
        title="My Materials"
        text="Every item here is a real file you uploaded. Content is generated from its actual text."
        action={
          <div className="head-actions">
            <Button variant="secondary" icon="edit" onClick={() => setPasting(true)}>
              Paste text
            </Button>
            <Button icon="upload" onClick={() => input.current?.click()}>
              Upload material
            </Button>
          </div>
        }
      />

      <input
        ref={input}
        type="file"
        hidden
        accept=".pdf,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.rtf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.jpg,.jpeg,.png,.webp"
        onChange={(event) => accept(event.target.files?.[0])}
      />

      <div
        className="upload-zone"
        onClick={() => !upload && input.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          accept(event.dataTransfer.files?.[0])
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            if (!upload) input.current?.click()
          }
        }}
        aria-label="Upload course material"
      >
        {upload ? (
          <div className="active-upload">
            <Mascot pose="folder" />
            <div>
              <h2>{upload.name}</h2>
              <p>{upload.stage}</p>
              <Progress value={upload.progress} label={`${upload.progress}% uploaded`} />
              <b>{upload.progress}%</b>
            </div>
          </div>
        ) : (
          <>
            <div className="upload-mascot">
              <Mascot pose="folder" />
            </div>
            <h2>Drop course material here</h2>
            <p>
              or <b>choose a real file from your device</b>
            </p>
            <span>{describeAcceptedTypes()}</span>
          </>
        )}
      </div>

      <div className="material-toolbar">
        <div className="search">
          <Icon name="search" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your materials"
            aria-label="Search materials"
            type="search"
          />
        </div>
        <span>
          {filtered.length} material{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Empty
          icon="folder"
          title={query ? "No matching material" : "Your library is waiting"}
          text={
            query
              ? "Try another search term."
              : "Upload a PDF, DOCX, PPTX, XLSX or text file above. Nothing is pre-populated."
          }
          action={
            !query ? (
              <Button icon="upload" onClick={() => input.current?.click()}>
                Upload your first material
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="material-grid">
          {filtered.map((material) => (
            <article className="material-card" key={material.id}>
              <header className="material-card-top">
                <div className="material-thumb" aria-hidden="true">
                  <Icon name="file" size={20} />
                  <span>
                    {material.type.includes("pdf")
                      ? "PDF"
                      : material.type.startsWith("image")
                        ? "IMG"
                        : material.name.split(".").pop()?.toUpperCase().slice(0, 4) || "DOC"}
                  </span>
                </div>
                <div className="material-card-heading">
                  <div className={`status-pill ${material.status}`}>
                    {material.status === "processing" && <i className="pill-spinner" />}
                    {material.status === "ready"
                      ? "Ready"
                      : material.status === "processing"
                        ? "Processing"
                        : material.status === "failed"
                          ? "Failed"
                          : "Text needed"}
                  </div>
                  <h2 title={material.title || material.name}>
                    {material.title || material.name}
                  </h2>
                  <p className="material-file">
                    {material.name} · {formatBytes(material.size)}
                  </p>
                </div>
              </header>

              {material.status === "ready" && (
                <ul className="material-facts">
                  <li>
                    <Icon name="quiz" size={14} />
                    {material.questions.length} challenges
                  </li>
                  <li>
                    <Icon name="file" size={14} />
                    {material.wordCount} words
                  </li>
                  <li>
                    <Icon name="book" size={14} />
                    {material.flashcards.length} flashcards
                  </li>
                </ul>
              )}

              {material.errorMessage && <div className="inline-error">{material.errorMessage}</div>}

              <p className="material-date">Updated {formatDate(material.updatedAt)}</p>

              <footer className="material-card-actions">
                <Button
                  variant="primary"
                  disabled={material.status !== "ready" || busyId === material.id}
                  onClick={() => openMaterial(material)}
                >
                  {material.status === "needs_text" ? "Add text" : "Open workspace"}
                </Button>
                <Button
                  variant="secondary"
                  icon="spark"
                  disabled={
                    busyId === material.id ||
                    !material.extractedText ||
                    material.status === "processing"
                  }
                  onClick={() => reprocess(material)}
                >
                  {busyId === material.id ? "Working…" : "Regenerate"}
                </Button>
                <Button
                  variant="secondary"
                  icon="edit"
                  disabled={busyId === material.id}
                  onClick={() => setEditing(material)}
                >
                  Edit
                </Button>
                <Button
                  variant="danger"
                  icon="trash"
                  disabled={busyId === material.id}
                  onClick={() => remove(material)}
                >
                  Delete
                </Button>
              </footer>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <div className="modal-backdrop">
          <form className="modal card" onSubmit={saveDetails}>
            <div className="section-head">
              <div>
                <span className="eyebrow">MATERIAL DETAILS</span>
                <h2>Edit “{editing.name}”</h2>
              </div>
              <button type="button" onClick={() => setEditing(null)} aria-label="Close">
                <Icon name="close" />
              </button>
            </div>
            <label>
              Title
              <input name="title" defaultValue={editing.title} required />
            </label>
            <label>
              Subject
              <input name="subject" defaultValue={editing.subject ?? ""} placeholder="e.g. Databases" />
            </label>
            <Button type="submit" className="full">
              Save details
            </Button>
          </form>
        </div>
      )}

      {pasting && (
        <div className="modal-backdrop">
          <form className="modal card" onSubmit={createFromText}>
            <div className="section-head">
              <div>
                <span className="eyebrow">MANUAL MATERIAL</span>
                <h2>Paste text to study</h2>
              </div>
              <button type="button" onClick={() => setPasting(false)} aria-label="Close">
                <Icon name="close" />
              </button>
            </div>
            <p className="muted">
              Useful for scanned PDFs or slides you cannot convert. The text becomes the source for
              the summary, flashcards and challenges.
            </p>
            <label>
              Title
              <input name="title" placeholder="Week 4 — Normalisation" />
            </label>
            <label>
              Material text
              <textarea name="text" rows={10} required placeholder="Paste the material text…" />
            </label>
            {pasteError && (
              <div className="form-alert error" role="alert">
                <Icon name="close" size={15} />
                {pasteError}
              </div>
            )}
            <Button type="submit" className="full" disabled={pasteBusy}>
              {pasteBusy ? (
                <>
                  <span className="button-spinner" /> Generating study world…
                </>
              ) : (
                "Create study world"
              )}
            </Button>
          </form>
        </div>
      )}
    </>
  )
}

export default Materials
