import type { AssistantReply, AssistantMessage } from "../types"
import { toAssistantReply } from "./assistantReply"

/** Browser code never calls an AI provider directly or contains its credentials. */

export async function askGroq(args: {
  question: string
  history: Pick<AssistantMessage, "role" | "content">[]
  materialId: string | null
  materialTitle: string | null
  passages: string[]
  reference: string | null
  id: string
}): Promise<AssistantReply> {
  const { materialId, id } = args
  return toAssistantReply(
    503,
    {
      status: "missing_key",
      detail: "The assistant is not configured. Set an AI provider key on the server.",
    },
    materialId,
    id,
  )
}
