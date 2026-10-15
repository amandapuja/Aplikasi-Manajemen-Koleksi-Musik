/**
 * Small in-memory cache for view state that must survive navigating between
 * pages inside the app (workspace tab, quiz position, note selection).
 *
 * This deliberately holds *view* state only — never application data. All
 * learning data lives in the active backend, so a page refresh always
 * re-reads from the source of truth.
 */

type WorkspaceView = {
  tab: "study" | "quiz" | "game"
  quizIndex: number
  quizAnswers: Record<string, number>
  quizChecked: Record<string, boolean>
  noteDraft: string
  summaryDraft?: string
}

const workspaceViews = new Map<string, WorkspaceView>()
let openNoteId: string | null = null

export function readWorkspaceView(materialId: string): WorkspaceView {
  return (
    workspaceViews.get(materialId) ?? {
      tab: "study",
      quizIndex: 0,
      quizAnswers: {},
      quizChecked: {},
      noteDraft: "",
    }
  )
}

export function writeWorkspaceView(materialId: string, patch: Partial<WorkspaceView>): void {
  const current = readWorkspaceView(materialId)
  workspaceViews.set(materialId, { ...current, ...patch })
}

export function clearWorkspaceView(materialId: string): void {
  workspaceViews.delete(materialId)
}

export function getOpenNoteId(): string | null {
  return openNoteId
}

export function setOpenNoteId(noteId: string | null): void {
  openNoteId = noteId
}
