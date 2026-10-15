import type { AssistantReply, AssistantStatus } from "../types"

/**
 * One place that turns what the assistant endpoint said into the AssistantReply
 * the interface understands. Both drivers (on-device and cloud) use it, so the
 * wire format cannot drift between them again.
 *
 * Server contract:
 *   success → 200 { status: "ready", answer, reference }
 *   failure → 4xx/5xx { status, detail, missing? }   (or { error } for bad input)
 *
 * A failure is always reported as a failure. This function never invents text.
 */

export type AssistantWire = {
  status?: string
  answer?: string
  reference?: string | null
  detail?: string
  error?: string
  missing?: string
}

const KNOWN: AssistantStatus[] = ["missing_key", "unreachable", "rate_limited", "timeout", "error"]

function failure(
  id: string,
  now: string,
  status: AssistantStatus,
  detail: string,
  missing?: string,
): AssistantReply {
  return {
    message: { id, role: "assistant", content: "", createdAt: now },
    status,
    detail,
    ...(missing ? { missing } : {}),
  }
}

export function toAssistantReply(
  httpStatus: number,
  payload: AssistantWire | null,
  materialId: string | null,
  id: string,
  now: string = new Date().toISOString(),
): AssistantReply {
  const answer = String(payload?.answer ?? "").trim()
  if (httpStatus >= 200 && httpStatus < 300 && answer) {
    return {
      message: {
        id,
        role: "assistant",
        content: answer,
        createdAt: now,
        materialId,
        reference: payload?.reference ?? null,
      },
      status: "ready",
    }
  }

  const declared = KNOWN.includes(payload?.status as AssistantStatus)
    ? (payload?.status as AssistantStatus)
    : null
  const status: AssistantStatus =
    declared ??
    (httpStatus === 429
      ? "rate_limited"
      : httpStatus === 504
        ? "timeout"
        : httpStatus === 503
          ? "missing_key"
          : httpStatus >= 500 || httpStatus === 0
            ? "unreachable"
            : "error")

  const detail =
    payload?.detail ||
    payload?.error ||
    (status === "missing_key"
      ? "The AI Study Assistant needs a language model provider. The key is configured on the server only."
      : status === "rate_limited"
        ? "The assistant is busy right now. Try again in a moment."
        : status === "timeout"
          ? "The assistant took too long to answer. Please try again."
          : status === "unreachable"
            ? `The assistant could not be reached (HTTP ${httpStatus}).`
            : "The assistant could not answer that just now.")

  const missing =
    payload?.missing ??
    (status === "missing_key"
      ? "Set LLM_API_KEY (and LLM_MODEL) on the deployed Edge Function, then try again."
      : undefined)

  return failure(id, now, status, detail, missing)
}
