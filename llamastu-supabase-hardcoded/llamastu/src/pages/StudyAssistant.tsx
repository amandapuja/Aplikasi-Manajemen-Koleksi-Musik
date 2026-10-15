import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button, PageHead } from "../components/common"
import { Icon } from "../components/Icon"
import { Markdown } from "../components/Markdown"
import { api } from "../lib/api"
import type { AppData, AssistantMessage, AssistantReply } from "../types"

type Props = {
  data: AppData
  toast: (message: string, error?: boolean) => void
}

type Failure = {
  detail: string
  missing?: string
  /** Kept so the learner can retry the exact question without retyping it. */
  question: string
}

const MAX_QUESTION_LENGTH = 4000

const TIPS = [
  "Explain a term from my material in simple words.",
  "Walk me through this step by step.",
  "Give me three practice questions on this topic.",
  "Summarise this section in five bullet points.",
  "Why does this code fail, and how do I fix it?",
]

function newMessage(role: AssistantMessage["role"], content: string): AssistantMessage {
  return {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `m-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  }
}

/**
 * AI Study Assistant.
 *
 * Every answer comes from the server endpoint. There is no canned reply here: if
 * the provider is not configured or the request fails, the interface says so and
 * offers a retry instead of pretending to be an assistant.
 */
export function StudyAssistant({ data, toast }: Props) {
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [materialId, setMaterialId] = useState("")
  const listRef = useRef<HTMLDivElement>(null)

  const readyMaterials = useMemo(
    () => data.materials.filter((material) => material.status === "ready"),
    [data.materials],
  )

  useEffect(() => {
    const node = listRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, sending, failure])

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim()
      if (!trimmed || sending) return
      if (trimmed.length > MAX_QUESTION_LENGTH) {
        setFailure({
          detail: `That question is ${trimmed.length} characters. Please keep it under ${MAX_QUESTION_LENGTH}.`,
          question: trimmed.slice(0, MAX_QUESTION_LENGTH),
        })
        return
      }

      setFailure(null)
      setSending(true)
      const history = messages.slice(-10)
      setMessages((current) => [...current, newMessage("user", trimmed)])
      setDraft("")

      try {
        const reply = await api<AssistantReply>("/assistant", {
          method: "POST",
          body: JSON.stringify({
            question: trimmed,
            materialId: materialId || null,
            messages: [...history, { role: "user", content: trimmed }],
          }),
        })

        if (reply.status === "ready" && reply.message?.content) {
          setMessages((current) => [
            ...current,
            {
              ...reply.message,
              materialId: reply.message.materialId ?? (materialId || null),
            },
          ])
          return
        }

        // A failure is reported as a failure — never as an answer.
        setFailure({
          detail: reply.detail ?? "The assistant could not answer that just now.",
          missing: reply.missing,
          question: trimmed,
        })
        if (reply.status === "rate_limited") {
          toast("The assistant is busy. Try again in a moment.", true)
        }
      } catch (reason) {
        setFailure({
          detail:
            reason instanceof Error
              ? reason.message
              : "The assistant could not be reached. Check your connection and try again.",
          question: trimmed,
        })
      } finally {
        setSending(false)
      }
    },
    [materialId, messages, sending, toast],
  )

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast("Answer copied.")
    } catch {
      toast("Could not copy. Select the text and copy it manually.", true)
    }
  }

  function retry() {
    if (!failure) return
    // The failed question was already appended to the transcript, so drop it
    // again before resending to avoid duplicating the turn.
    setMessages((current) => {
      const next = [...current]
      if (next.length && next[next.length - 1].role === "user") next.pop()
      return next
    })
    const question = failure.question
    setFailure(null)
    void send(question)
  }

  function startNew() {
    if (messages.length && !confirm("Start a new conversation? This transcript is not saved.")) return
    setMessages([])
    setFailure(null)
    setDraft("")
  }

  return (
    <>
      <PageHead
        eyebrow="ASK ANYTHING"
        title="AI Study Assistant"
        text="Ask about a concept you are stuck on, or pick one of your materials and have the answer grounded in that document. Answers are written in Indonesian."
        action={
          <Button variant="secondary" onClick={startNew} disabled={!messages.length && !failure}>
            New conversation
          </Button>
        }
      />

      <div className="assistant-shell">
        <aside className="card assistant-side">
          <div className="setting-title">
            <span className="eyebrow">GROUNDING</span>
            <h2>Study material</h2>
          </div>
          <p className="muted small">
            Pick a document and the assistant is given its most relevant passages before it answers.
            With nothing selected it still answers, but without quoting your material.
          </p>
          <label className="assistant-material">
            Material
            <select
              value={materialId}
              onChange={(event) => setMaterialId(event.target.value)}
              aria-label="Material to ground answers in"
            >
              <option value="">None — general answers</option>
              {readyMaterials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.title || material.name}
                </option>
              ))}
            </select>
          </label>
          <ul className="assistant-tips">
            {TIPS.map((tip) => (
              <li key={tip}>
                <button type="button" className="assistant-tip" onClick={() => setDraft(tip)}>
                  {tip}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="card assistant-chat" aria-label="Study assistant conversation">
          <div className="assistant-log" ref={listRef} role="log" aria-live="polite">
            {messages.length === 0 && !failure && (
              <div className="assistant-empty">
                <Icon name="spark" />
                <b>Ask your first question</b>
                <span>
                  Anything you are finding difficult — a definition, a worked example, a piece of
                  code, or a topic from one of your documents.
                </span>
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id} className={`assistant-turn ${message.role}`}>
                <span className="assistant-role">
                  <Icon name={message.role === "user" ? "user" : "spark"} size={13} />
                  {message.role === "user" ? "You" : "Assistant"}
                </span>
                <div className="assistant-bubble">
                  {message.role === "assistant" ? <Markdown text={message.content} /> : message.content}
                </div>
                {message.role === "assistant" && (
                  <div className="assistant-meta">
                    {message.reference && <small className="assistant-ref">From: {message.reference}</small>}
                    <button type="button" className="assistant-copy" onClick={() => void copy(message.content)}>
                      Copy
                    </button>
                  </div>
                )}
              </div>
            ))}

            {sending && (
              <div className="assistant-turn assistant" role="status">
                <span className="assistant-role">
                  <Icon name="spark" size={13} /> Assistant
                </span>
                <div className="assistant-bubble typing">
                  <i />
                  <i />
                  <i />
                  <span>Thinking…</span>
                </div>
              </div>
            )}

            {failure && (
              <div className="assistant-error" role="alert">
                <b>The assistant could not answer</b>
                <p>{failure.detail}</p>
                {failure.missing && (
                  <p className="small">
                    <b>Still required:</b> {failure.missing}
                  </p>
                )}
                <div className="assistant-error-actions">
                  <Button variant="secondary" onClick={retry} disabled={sending}>
                    Try again
                  </Button>
                  <Button variant="ghost" onClick={() => setFailure(null)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
          </div>

          <form
            className="assistant-composer"
            onSubmit={(event) => {
              event.preventDefault()
              void send(draft)
            }}
          >
            <label className="sr-only" htmlFor="assistant-input">
              Your question
            </label>
            <textarea
              id="assistant-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void send(draft)
                }
              }}
              placeholder="Ask about anything you are studying…"
              rows={2}
              maxLength={MAX_QUESTION_LENGTH}
              disabled={sending}
            />
            <div className="assistant-composer-foot">
              <span className="muted small">
                {draft.length}/{MAX_QUESTION_LENGTH} · Enter to send, Shift+Enter for a new line
              </span>
              <Button type="submit" disabled={sending || !draft.trim()}>
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </>
  )
}

export default StudyAssistant
