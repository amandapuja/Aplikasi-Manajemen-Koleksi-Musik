import type { ReactNode } from "react"

/**
 * A small, safe renderer for assistant answers: paragraphs, bullet and numbered
 * lists, headings, **bold**, *italic*, `inline code` and fenced code blocks.
 * It builds React elements only — no HTML string is ever injected — so nothing a
 * model (or a document it quotes) returns can run as markup.
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g
  let last = 0
  let index = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > last) out.push(text.slice(last, start))
    const token = match[0]
    const key = `${keyPrefix}-${index++}`
    if (token.startsWith("`")) out.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (token.startsWith("**")) out.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    else out.push(<em key={key}>{token.slice(1, -1)}</em>)
    last = start + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim().startsWith("```")) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++])
      i++
      blocks.push(
        <pre key={key++} className="assistant-code">
          <code>{code.join("\n")}</code>
        </pre>,
      )
      continue
    }

    if (!line.trim()) {
      i++
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push(
        <p key={key++} className="assistant-heading">
          <strong>{inline(heading[2], `h${key}`)}</strong>
        </p>,
      )
      i++
      continue
    }

    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ""))
      blocks.push(
        <ul key={key++}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, `u${key}-${n}`)}</li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""))
      blocks.push(
        <ol key={key++}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, `o${key}-${n}`)}</li>
          ))}
        </ol>,
      )
      continue
    }

    const paragraph: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      paragraph.push(lines[i++])
    }
    blocks.push(<p key={key++}>{inline(paragraph.join("\n"), `p${key}`)}</p>)
  }

  return <div className="assistant-md">{blocks}</div>
}
