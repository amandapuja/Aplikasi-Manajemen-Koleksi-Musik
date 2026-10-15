import { normalizeText } from "./content"

/**
 * Client-side document text extraction.
 *
 * TXT / MD / CSV / JSON / HTML are read directly. PDF uses pdf.js (with a
 * built-in stream parser as a fallback). DOCX / PPTX / XLSX / ODT are OOXML or
 * OpenDocument zips, so they are unzipped in the browser with fflate and the
 * text nodes are read out of the XML. No server, no upload of the document to
 * a third party, and no API key is required.
 */

export type ExtractionResult = {
  text: string
  kind: string
  pages?: number
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

const PLAIN_TEXT_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".json",
  ".xml",
  ".html",
  ".htm",
  ".rtf",
  ".log",
  ".srt",
  ".vtt",
]

const ZIP_DOCUMENT_EXTENSIONS = [".docx", ".pptx", ".xlsx", ".odt", ".odp", ".ods"]

export const SUPPORTED_EXTENSIONS = [
  ".pdf",
  ...PLAIN_TEXT_EXTENSIONS,
  ...ZIP_DOCUMENT_EXTENSIONS,
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
]

/** Extensions we accept for storage but cannot turn into readable text. */
export const TEXT_UNSUPPORTED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".doc",
  ".ppt",
  ".xls",
]

export function extensionOf(name: string): string {
  const index = name.lastIndexOf(".")
  return index === -1 ? "" : name.slice(index).toLowerCase()
}

export function isAcceptedFile(file: File): boolean {
  return SUPPORTED_EXTENSIONS.includes(extensionOf(file.name))
}

export function isTextExtractable(file: File | { name: string }): boolean {
  const extension = extensionOf(file.name)
  return (
    PLAIN_TEXT_EXTENSIONS.includes(extension) ||
    ZIP_DOCUMENT_EXTENSIONS.includes(extension) ||
    extension === ".pdf"
  )
}

export function describeAcceptedTypes(): string {
  return "PDF, DOCX, PPTX, XLSX, ODT, TXT, MD, CSV, JSON, HTML, RTF, JPG or PNG · up to 25 MB"
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function rtfToText(rtf: string): string {
  return rtf
    .replace(/\\'([0-9a-f]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\par[d]?/gi, "\n")
    .replace(/\\tab/gi, "\t")
    .replace(/\{\\\*[^{}]*\}/g, " ")
    .replace(/\\[a-z]+-?\d* ?/gi, " ")
    .replace(/[{}]/g, " ")
}

/* ------------------------------------------------------------------ *
 * OOXML / ODF (zip based)
 * ------------------------------------------------------------------ */

async function readZipEntries(
  file: File,
  filter: (name: string) => boolean,
): Promise<Record<string, Uint8Array>> {
  const { unzipSync } = await import("fflate")
  const buffer = new Uint8Array(await file.arrayBuffer())
  try {
    return unzipSync(buffer, { filter: (entry) => filter(entry.name) })
  } catch {
    throw new Error(
      "This document could not be opened. It may be corrupted or password protected.",
    )
  }
}

function decodeXml(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes)
}

function parseXml(xml: string): Document {
  const parsed = new DOMParser().parseFromString(xml, "application/xml")
  const failure = parsed.querySelector("parsererror")
  if (failure) {
    throw new Error("The document structure could not be parsed.")
  }
  return parsed
}

function textFromDocxXml(xml: string): string {
  const document = parseXml(xml)
  const paragraphs = Array.from(document.getElementsByTagName("w:p"))
  const lines: string[] = []

  paragraphs.forEach((paragraph) => {
    const pieces: string[] = []
    Array.from(paragraph.getElementsByTagName("w:t")).forEach((node) => {
      pieces.push(node.textContent || "")
    })
    Array.from(paragraph.getElementsByTagName("w:tab")).forEach(() => pieces.push("\t"))
    const line = pieces.join("").trim()
    if (line) lines.push(line)
  })

  if (lines.length === 0) {
    // Some generators omit the w: prefix.
    Array.from(document.getElementsByTagName("p")).forEach((paragraph) => {
      const line = (paragraph.textContent || "").trim()
      if (line) lines.push(line)
    })
  }

  return lines.join("\n")
}

function textFromPptxSlides(entries: Record<string, Uint8Array>): string {
  const names = Object.keys(entries)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => {
      const leftIndex = Number(left.match(/(\d+)/)?.[1] || 0)
      const rightIndex = Number(right.match(/(\d+)/)?.[1] || 0)
      return leftIndex - rightIndex
    })

  return names
    .map((name, index) => {
      const document = parseXml(decodeXml(entries[name]))
      const texts = Array.from(document.getElementsByTagName("a:t"))
        .map((node) => (node.textContent || "").trim())
        .filter(Boolean)
      return `Slide ${index + 1}\n${texts.join("\n")}`
    })
    .join("\n\n")
}

function textFromXlsx(entries: Record<string, Uint8Array>): string {
  const shared = entries["xl/sharedStrings.xml"]
  const sharedStrings: string[] = []
  if (shared) {
    const document = parseXml(decodeXml(shared))
    Array.from(document.getElementsByTagName("si")).forEach((node) => {
      sharedStrings.push((node.textContent || "").trim())
    })
  }

  const sheetNames = Object.keys(entries)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort()

  const lines: string[] = []
  sheetNames.forEach((name, index) => {
    const document = parseXml(decodeXml(entries[name]))
    const rows = Array.from(document.getElementsByTagName("row"))
    const rowText: string[] = []
    rows.forEach((row) => {
      const cells = Array.from(row.getElementsByTagName("c")).map((cell) => {
        const type = cell.getAttribute("t")
        const valueNode = cell.getElementsByTagName("v")[0]
        const inlineNode = cell.getElementsByTagName("is")[0]
        if (type === "s" && valueNode) {
          const sharedIndex = Number(valueNode.textContent || "-1")
          return sharedStrings[sharedIndex] || ""
        }
        if (inlineNode) return (inlineNode.textContent || "").trim()
        return (valueNode?.textContent || "").trim()
      })
      const line = cells.filter(Boolean).join(" | ")
      if (line) rowText.push(line)
    })
    if (rowText.length) lines.push(`Sheet ${index + 1}\n${rowText.join("\n")}`)
  })

  return lines.join("\n\n")
}

function textFromOdf(contentXml: string): string {
  const document = parseXml(contentXml)
  const paragraphs = Array.from(document.getElementsByTagName("text:p"))
  return paragraphs
    .map((node) => (node.textContent || "").trim())
    .filter(Boolean)
    .join("\n")
}

/* ------------------------------------------------------------------ *
 * PDF
 * ------------------------------------------------------------------ */

type PdfJsModule = typeof import("pdfjs-dist")

let pdfModulePromise: Promise<PdfJsModule> | null = null

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfModulePromise) {
    pdfModulePromise = (async () => {
      const pdfjs = await import("pdfjs-dist")
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })()
  }
  return pdfModulePromise
}

async function extractPdfWithPdfJs(file: File): Promise<ExtractionResult> {
  const pdfjs = await loadPdfJs()
  const data = new Uint8Array(await file.arrayBuffer())
  const document = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const pages: string[] = []

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    let line = ""
    const lines: string[] = []
    content.items.forEach((item) => {
      const textItem = item as { str?: string; hasEOL?: boolean }
      if (typeof textItem.str !== "string") return
      line += textItem.str
      if (textItem.hasEOL) {
        lines.push(line.trim())
        line = ""
      }
    })
    if (line.trim()) lines.push(line.trim())
    pages.push(lines.filter(Boolean).join("\n"))
    page.cleanup()
  }

  await document.destroy()
  return {
    text: pages.join("\n\n"),
    kind: "pdf",
    pages: pages.length,
  }
}

function decodePdfLiteralString(raw: string): string {
  let output = ""
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (character === "\\") {
      const next = raw[index + 1]
      index += 1
      if (next === undefined) break
      if (next === "n") output += "\n"
      else if (next === "r") output += "\n"
      else if (next === "t") output += "\t"
      else if (next === "b" || next === "f") output += " "
      else if (/[0-7]/.test(next)) {
        const octal = raw.slice(index, index + 3).match(/^[0-7]{1,3}/)?.[0] || next
        output += String.fromCharCode(parseInt(octal, 8))
        index += octal.length - 1
      } else output += next
    } else {
      output += character
    }
  }
  return output
}

function decodeHexString(hex: string): string {
  const clean = hex.replace(/[^0-9a-f]/gi, "")
  let output = ""
  for (let index = 0; index + 1 < clean.length; index += 2) {
    const code = parseInt(clean.slice(index, index + 2), 16)
    if (code === 0) continue
    output += String.fromCharCode(code)
  }
  return output
}

/**
 * Fallback extractor: walks raw PDF content streams and pulls out the text
 * showing operators. Works for uncompressed and Flate-compressed documents
 * (the common case) without pdf.js.
 */
async function extractPdfFallback(file: File): Promise<ExtractionResult> {
  const { inflateSync } = await import("fflate")
  const bytes = new Uint8Array(await file.arrayBuffer())
  const latin = new TextDecoder("latin1").decode(bytes)
  const pieces: string[] = []

  const streamPattern = /stream\r?\n?/g
  let match: RegExpExecArray | null
  let pageHint = 0

  while ((match = streamPattern.exec(latin)) !== null) {
    const start = match.index + match[0].length
    const end = latin.indexOf("endstream", start)
    if (end === -1) break
    const raw = latin.slice(start, end)
    let content = raw
    const dictionaryStart = Math.max(0, match.index - 900)
    const dictionary = latin.slice(dictionaryStart, match.index)

    if (/\/FlateDecode/.test(dictionary)) {
      try {
        const binary = new Uint8Array(raw.length)
        for (let index = 0; index < raw.length; index += 1) {
          binary[index] = raw.charCodeAt(index) & 0xff
        }
        content = new TextDecoder("latin1").decode(inflateSync(binary))
      } catch {
        streamPattern.lastIndex = end
        continue
      }
    }

    if (!/(Tj|TJ)/.test(content)) {
      streamPattern.lastIndex = end
      continue
    }

    pageHint += 1
    const collected: string[] = []
    const tokenPattern = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\bTj\b|\bTJ\b|\bTd\b|\bTD\b|\bT\*\b|\bET\b|\bBT\b/g
    let token: RegExpExecArray | null
    let currentLine = ""
    while ((token = tokenPattern.exec(content)) !== null) {
      const value = token[0]
      if (value.startsWith("(")) currentLine += decodePdfLiteralString(value.slice(1, -1))
      else if (value.startsWith("<")) currentLine += decodeHexString(value)
      else if (value === "Td" || value === "TD" || value === "T*" || value === "ET") {
        if (currentLine.trim()) collected.push(currentLine.trim())
        currentLine = ""
      }
    }
    if (currentLine.trim()) collected.push(currentLine.trim())
    if (collected.length) pieces.push(collected.join("\n"))
    streamPattern.lastIndex = end
  }

  return {
    text: pieces.join("\n\n"),
    kind: "pdf",
    pages: pageHint || undefined,
  }
}

/* ------------------------------------------------------------------ *
 * Public entry point
 * ------------------------------------------------------------------ */

export async function extractText(file: File): Promise<ExtractionResult> {
  const extension = extensionOf(file.name)
  const mime = file.type || ""

  if (extension === ".pdf" || mime === "application/pdf") {
    let best = ""
    try {
      const result = await extractPdfWithPdfJs(file)
      if (result.text.trim().length > 40) return result
      best = result.text
    } catch {
      // fall through to the built-in parser
    }
    const fallback = await extractPdfFallback(file)
    if (fallback.text.trim().length > 40) return fallback
    if (fallback.text.trim().length > best.trim().length) best = fallback.text
    throw new Error(NO_TEXT_LAYER_MESSAGE)
  }

  if (PLAIN_TEXT_EXTENSIONS.includes(extension) || mime.startsWith("text/")) {
    const raw = await file.text()
    const text =
      extension === ".html" || extension === ".htm" || mime.includes("html")
        ? stripHtml(raw)
        : extension === ".rtf" || mime.includes("rtf")
          ? rtfToText(raw)
          : raw
    return { text: normalizeText(text), kind: "text" }
  }

  if (extension === ".docx") {
    const entries = await readZipEntries(file, (name) => name === "word/document.xml")
    const document = entries["word/document.xml"]
    if (!document) {
      throw new Error("This DOCX file does not contain a readable document body.")
    }
    return { text: normalizeText(textFromDocxXml(decodeXml(document))), kind: "docx" }
  }

  if (extension === ".pptx") {
    const entries = await readZipEntries(file, (name) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name),
    )
    return { text: normalizeText(textFromPptxSlides(entries)), kind: "pptx" }
  }

  if (extension === ".xlsx") {
    const entries = await readZipEntries(
      file,
      (name) => name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
    )
    return { text: normalizeText(textFromXlsx(entries)), kind: "xlsx" }
  }

  if (extension === ".odt" || extension === ".odp" || extension === ".ods") {
    const entries = await readZipEntries(file, (name) => name === "content.xml")
    const content = entries["content.xml"]
    if (!content) throw new Error("This OpenDocument file has no readable content.")
    return { text: normalizeText(textFromOdf(decodeXml(content))), kind: extension.slice(1) }
  }

  if (mime.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp"].includes(extension)) {
    throw new Error(IMAGE_ONLY_MESSAGE)
  }

  if (TEXT_UNSUPPORTED_EXTENSIONS.includes(extension)) {
    throw new Error(
      `“.${extension}” is a legacy binary format that cannot be read in the browser. Save it as .docx, .pdf or .txt and upload it again, or use “Paste text” to add the content directly.`,
    )
  }

  throw new Error(
    `“.${extension || "unknown"}” files are not supported for text extraction. Accepted formats: ${describeAcceptedTypes()}.`,
  )
}

/**
 * Messages shown when a file is stored but yields no readable text. They are
 * deliberately precise: the app never claims to have processed a document it
 * could not actually read.
 */
export const NO_TEXT_LAYER_MESSAGE =
  "This document has no extractable text layer. It looks like a scan or an image-only PDF, so there is nothing to summarise. Use “Paste text” to add the content and generate the study world."

export const IMAGE_ONLY_MESSAGE =
  "This is an image, so it contains no text that can be read directly. Automatic OCR is not available in this build. Use “Paste text” to add the content and generate the study world."

/** The right explanation for a file that is stored but yields no readable text. */
export function unsupportedReason(file: { name: string; type?: string }): string {
  const extension = extensionOf(file.name)
  const mime = file.type ?? ""
  if (mime.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp"].includes(extension)) {
    return IMAGE_ONLY_MESSAGE
  }
  if (extension === ".pdf" || mime === "application/pdf") return NO_TEXT_LAYER_MESSAGE
  return `“.${extension || "unknown"}” cannot be converted to text in the browser. Use “Paste text” to add the content and generate the study world.`
}
