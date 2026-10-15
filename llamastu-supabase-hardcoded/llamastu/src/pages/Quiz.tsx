import { useEffect, useMemo, useState } from "react"
import { Button, Empty, Mascot, Progress } from "../components/common"
import { Icon } from "../components/Icon"
import { api } from "../lib/api"
import { readWorkspaceView, writeWorkspaceView } from "../lib/uiState"
import type { Material, QuizAttempt } from "../types"

type Props = {
  material: Material
  refresh: () => Promise<void>
  toast: (message: string, error?: boolean) => void
}

type SubmitResponse = {
  attempt: QuizAttempt
  correctMap: Record<string, boolean>
  explanations: Record<string, string>
}

export function Quiz({ material, refresh, toast }: Props) {
  const questions = material.questions
  const [index, setIndex] = useState(() => readWorkspaceView(material.id).quizIndex)
  const [answers, setAnswers] = useState<Record<string, number>>(
    () => readWorkspaceView(material.id).quizAnswers,
  )
  const [checked, setChecked] = useState<Record<string, boolean>>(
    () => readWorkspaceView(material.id).quizChecked,
  )
  const [result, setResult] = useState<SubmitResponse | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  // Keep the quiz position when the learner navigates to another page and back.
  useEffect(() => {
    writeWorkspaceView(material.id, {
      quizIndex: index,
      quizAnswers: answers,
      quizChecked: checked,
    })
  }, [material.id, index, answers, checked])

  const answeredCount = useMemo(
    () => questions.filter((question) => checked[question.id]).length,
    [questions, checked],
  )

  if (questions.length === 0) {
    return (
      <Empty
        icon="quiz"
        title="No generated questions"
        text="This material did not produce readable questions. Regenerate the material from the library."
      />
    )
  }

  const question = questions[Math.min(index, questions.length - 1)]
  const selected = answers[question.id]
  const isChecked = Boolean(checked[question.id])
  const isCorrect = isChecked && selected === question.answerIndex

  async function finish() {
    setSubmitting(true)
    setError("")
    try {
      const response = await api<SubmitResponse>("/quiz-attempts", {
        method: "POST",
        body: JSON.stringify({ materialId: material.id, answers }),
      })
      setResult(response)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The quiz could not be submitted.")
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    setAnswers({})
    setChecked({})
    setIndex(0)
    setResult(null)
    writeWorkspaceView(material.id, {
      quizIndex: 0,
      quizAnswers: {},
      quizChecked: {},
    })
  }

  if (result) {
    const percentage = Math.round((result.attempt.score / result.attempt.total) * 100)
    return (
      <div className="quiz-result card">
        <Mascot pose="celebrate" />
        <span className="eyebrow">QUIZ COMPLETE</span>
        <h2>
          {result.attempt.score} / {result.attempt.total}
        </h2>
        <Progress value={percentage} label={`${percentage}% correct`} />
        <p>
          {result.attempt.xpAwarded > 0
            ? `You earned ${result.attempt.xpAwarded} XP for the questions you answered correctly for the first time.`
            : "No new XP this round — every one of these questions had already been answered correctly before."}
        </p>
        <div className="quiz-review">
          <h3>Review</h3>
          {questions.map((item, position) => {
            const correct = result.correctMap[item.id]
            return (
              <div className={correct ? "review-row ok" : "review-row bad"} key={item.id}>
                <b>
                  {position + 1}. {item.question}
                </b>
                <span>
                  Your answer:{" "}
                  {answers[item.id] === undefined
                    ? "not answered"
                    : item.choices[answers[item.id]]}
                </span>
                {!correct && <span>Correct answer: {item.choices[item.answerIndex]}</span>}
                <small>{result.explanations[item.id] ?? item.explanation}</small>
              </div>
            )
          })}
        </div>
        <Button onClick={reset}>Retry quiz</Button>
      </div>
    )
  }

  return (
    <div className="quiz-shell card">
      <div className="quiz-top">
        <span>
          Question {index + 1} of {questions.length} · {answeredCount} checked
        </span>
        <Progress
          value={((index + 1) / questions.length) * 100}
          label={`Question ${index + 1} of ${questions.length}`}
        />
      </div>

      <div className="quiz-dots" role="tablist" aria-label="Question navigation">
        {questions.map((item, position) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={position === index}
            aria-label={`Go to question ${position + 1}`}
            className={`${position === index ? "active" : ""} ${
              checked[item.id] ? "done" : ""
            }`}
            onClick={() => setIndex(position)}
          />
        ))}
      </div>

      <h2>{question.question}</h2>

      <div className="answer-grid">
        {question.choices.map((choice, choiceIndex) => {
          const chosen = selected === choiceIndex
          const showCorrect = isChecked && choiceIndex === question.answerIndex
          const showWrong = isChecked && chosen && choiceIndex !== question.answerIndex
          return (
            <button
              key={`${choice}-${choiceIndex}`}
              type="button"
              className={`${chosen ? "selected" : ""} ${showCorrect ? "correct" : ""} ${
                showWrong ? "wrong" : ""
              }`}
              disabled={isChecked}
              aria-pressed={chosen}
              onClick={() => setAnswers((current) => ({ ...current, [question.id]: choiceIndex }))}
            >
              <i>{String.fromCharCode(65 + choiceIndex)}</i>
              <span>{choice}</span>
              {showCorrect && <Icon name="check" size={15} />}
            </button>
          )
        })}
      </div>

      {isChecked && (
        <div className={isCorrect ? "challenge-feedback ok" : "challenge-feedback"}>
          <b>{isCorrect ? "Correct" : "Not quite"}</b>
          <p>{question.explanation}</p>
        </div>
      )}

      {error && (
        <div className="form-alert error" role="alert">
          <Icon name="close" size={15} />
          {error}
        </div>
      )}

      <div className="quiz-actions">
        <span>
          {isChecked
            ? isCorrect
              ? "Nice work — move on when ready."
              : "Read the explanation, then continue."
            : selected === undefined
              ? "Choose an answer, then check it."
              : "Ready to check your answer."}
        </span>
        <div className="quiz-buttons">
          <Button
            variant="secondary"
            disabled={index === 0}
            onClick={() => setIndex((value) => Math.max(0, value - 1))}
          >
            <Icon name="chevron-left" size={15} /> Previous
          </Button>
          {!isChecked ? (
            <Button
              disabled={selected === undefined}
              onClick={() => setChecked((current) => ({ ...current, [question.id]: true }))}
            >
              Check answer
            </Button>
          ) : index < questions.length - 1 ? (
            <Button onClick={() => setIndex((value) => Math.min(questions.length - 1, value + 1))}>
              Next question <Icon name="arrow" size={15} />
            </Button>
          ) : (
            <Button
              disabled={answeredCount !== questions.length || submitting}
              onClick={finish}
            >
              {submitting ? (
                <>
                  <span className="button-spinner" /> Saving…
                </>
              ) : (
                "Finish and save"
              )}
            </Button>
          )}
        </div>
      </div>

      {index === questions.length - 1 && isChecked && answeredCount < questions.length && (
        <p className="muted small">
          {questions.length - answeredCount} question
          {questions.length - answeredCount === 1 ? "" : "s"} still unchecked. Use the numbered
          buttons above to jump to them — “Finish and save” unlocks once every question has been
          checked.
        </p>
      )}
      {answeredCount === questions.length && index === questions.length - 1 && isChecked && (
        <p className="muted small">
          All questions checked. Select “Finish and save” to store your attempt and XP.
        </p>
      )}
    </div>
  )
}

export default Quiz
