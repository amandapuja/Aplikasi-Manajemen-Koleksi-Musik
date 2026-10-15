/**
 * Grounded learning-content generation for the Edge Function.
 *
 * Two providers are supported:
 *
 *  1. A hosted model, used only when LLM_API_KEY (and optionally LLM_BASE_URL /
 *     LLM_MODEL) is present in the function environment. The model receives the
 *     extracted text and must return strict JSON.
 *  2. The built-in deterministic generator, which needs no API at all. Every
 *     summary, flashcard and question it produces is derived from the extract
 *     text: summaries are extractive, questions are cloze or definition
 *     questions anchored to real sentences, and every explanation quotes the
 *     sentence the answer came from.
 *
 * The API always reports which provider answered via /health, so the UI never
 * pretends a model was used when it was not.
 */

export type DraftQuestion = {
  question: string
  choices: string[]
  answerIndex: number
  explanation: string
  difficulty: "easy" | "medium" | "hard"
}

export type DraftFlashcard = { front: string; back: string }

export type GeneratedContent = {
  summary: string
  keyPoints: string[]
  objectives: string[]
  flashcards: DraftFlashcard[]
  questions: DraftQuestion[]
  wordCount: number
  language: "en" | "id"
  provider: "model" | "builtin"
}

const ENGLISH_STOPWORDS =
  "a about above after again against all also am an and any are aren't as at be because been before being below between both but by can cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he her here hers herself him himself his how however i if in into is isn't it its itself just let me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she should shouldn't so some such than that the their theirs them themselves then there these they this those through to too under until up very was wasn't we were weren't what when where which while who whom why with won't would wouldn't you your yours yourself yourselves will shall may might must upon within without using used use one two three first second next last new thus hence therefore moreover furthermore able following given well".split(
    " ",
  )

const INDONESIAN_STOPWORDS =
  "ada adalah agar akan antara apa apabila atas atau bagaimana bagi bahwa baik banyak baru beberapa begitu belum berada berdasarkan berikut besar bisa boleh buat bukan dalam dan dapat dari daripada dasar dengan di dia dimana digunakan yaitu jika juga karena ke kepada kemudian ketika kita lain lainnya lalu lebih maka maupun masih melainkan melalui masing memiliki membuat merupakan mengapa mengenai meskipun namun oleh pada paling para perlu pertama per sebuah sebagai secara setiap sehingga sejak seperti serta sesuai supaya tadi tanpa telah tetapi tidak ini itu untuk tersebut hanya saja anda kamu mereka kami saya sering waktu orang tahun umum jenis bagian contoh terhadap hal".split(
    " ",
  )

const STOPWORDS = new Set([...ENGLISH_STOPWORDS, ...INDONESIAN_STOPWORDS])

export function getAiApiKey(): string | undefined {
  return Deno.env.get("LLM_API_KEY") ?? Deno.env.get("LLM API AI key")
}

const DEFINITION_PATTERNS = [
  "\\bis\\b",
  "\\bare\\b",
  "\\brefers to\\b",
  "\\bmeans\\b",
  "\\bis defined as\\b",
  "\\bcan be defined as\\b",
  "\\badalah\\b",
  "\\bmerupakan\\b",
  "\\byaitu\\b",
  "\\bmerujuk pada\\b",
  "\\bberarti\\b",
]

export function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function countWords(text: string): number {
  return (text.toLowerCase().match(/[a-z0-9\u00c0-\u024f-]+/g) ?? []).length
}

function splitSentences(text: string): string[] {
  const flat = text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim()
  if (!flat) return []
  const guarded = flat
    .replace(/\b(Dr|Mr|Mrs|Ms|Prof|vs|etc|e\.g|i\.e|No|Fig|al)\./gi, "$1<DOT>")
    .replace(/(\d)\.(\d)/g, "$1<DOT>$2")
  const parts = guarded
    .split(/(?<=[.!?\u2026])\s+(?=[A-Z0-9"\u201c(])/)
    .map((part) => part.replace(/<DOT>/g, ".").trim())
    .filter(Boolean)
  return parts.length ? parts : [flat]
}

function contentWords(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word) && !/^\d+$/.test(word))
}

function detectLanguage(text: string): "en" | "id" {
  const tokens = (text.toLowerCase().match(/[a-z]+/g) ?? []).slice(0, 4000)
  if (!tokens.length) return "en"
  const en = tokens.filter((token) => ENGLISH_STOPWORDS.includes(token)).length
  const id = tokens.filter((token) => INDONESIAN_STOPWORDS.includes(token)).length
  return id > en * 1.15 ? "id" : "en"
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function shorten(text: string, limit: number): string {
  const clean = text.trim().replace(/\s+/g, " ")
  if (clean.length <= limit) return clean
  const clipped = clean.slice(0, limit)
  const boundary = Math.max(clipped.lastIndexOf(", "), clipped.lastIndexOf("; "), clipped.lastIndexOf(" "))
  const cut = boundary > limit * 0.55 ? clipped.slice(0, boundary) : clipped
  return `${cut.replace(/[,;:\s]+$/, "")}\u2026`
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const value = key(item)
    if (seen.has(value)) continue
    seen.add(value)
    out.push(item)
  }
  return out
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const temp = copy[index]
    copy[index] = copy[swap]
    copy[swap] = temp
  }
  return copy
}

type TermScore = { term: string; score: number; display: string }

function extractTerms(sentences: string[]): TermScore[] {
  const df = new Map<string, number>()
  const tf = new Map<string, number>()
  const display = new Map<string, string>()
  for (const sentence of sentences) {
    const seen = new Set<string>()
    for (const word of contentWords(sentence)) {
      tf.set(word, (tf.get(word) ?? 0) + 1)
      if (!seen.has(word)) {
        seen.add(word)
        df.set(word, (df.get(word) ?? 0) + 1)
      }
      if (!display.has(word)) {
        const match = sentence.match(new RegExp(`\\b${escapeRegExp(word)}\\b`, "i"))
        if (match) display.set(word, match[0])
      }
    }
  }
  const total = Math.max(sentences.length, 1)
  const scored: TermScore[] = []
  for (const [term, count] of tf) {
    const idf = Math.log(1 + total / (df.get(term) ?? 1))
    scored.push({
      term,
      score: Math.log(1 + count) * idf * (1 + Math.min(term.length, 14) / 20),
      display: display.get(term) ?? term,
    })
  }
  scored.sort((left, right) =>
    right.score === left.score ? left.term.localeCompare(right.term) : right.score - left.score,
  )
  return scored
}

export function generateBuiltin(
  rawText: string,
  options: { questionCount?: number } = {},
): GeneratedContent {
  const text = normalizeText(rawText)
  const wordCount = countWords(text)
  if (wordCount < 60) {
    throw new Error(
      "The extracted text is too short to build a study world (at least 60 words are required).",
    )
  }

  const language = detectLanguage(text)
  const all = splitSentences(text)
  const usableAll = all.filter((sentence) => sentence.length >= 40 && sentence.length <= 600)
  const usable = usableAll.length >= 3 ? usableAll : all.filter(Boolean)
  if (usable.length < 2) throw new Error("No complete sentences could be read from this material.")

  const terms = extractTerms(usable)
  if (terms.length < 6) {
    throw new Error("Not enough distinct terminology was found to build questions.")
  }
  const termScores = new Map(terms.map((item) => [item.term, item.score]))

  const ranked = usable
    .map((sentence, index) => {
      const tokens = contentWords(sentence)
      const sum = tokens.reduce((total, token) => total + (termScores.get(token) ?? 0), 0)
      return { sentence, index, score: tokens.length ? sum / Math.sqrt(tokens.length) : 0 }
    })
    .sort((left, right) => right.score - left.score)

  const summaryCount = Math.max(2, Math.min(6, Math.round(usable.length * 0.22)))
  const summary = ranked
    .slice(0, summaryCount)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.sentence)
    .join(" ")

  const keyPoints = ranked.slice(0, 6).map((item) => shorten(item.sentence, 150))
  const verbs =
    language === "id"
      ? ["Menjelaskan", "Menganalisis", "Menerapkan", "Membandingkan", "Mengevaluasi"]
      : ["Explain", "Analyse", "Apply", "Compare", "Evaluate"]
  const objectives = ranked
    .slice(0, 5)
    .map((item, index) => `${verbs[index % verbs.length]}: ${shorten(item.sentence, 132)}`)

  const random = createRandom(hashString(text))
  const requested = Math.max(3, Math.min(options.questionCount ?? 10, 25))

  const definitionQuestions: DraftQuestion[] = []
  for (const sentence of usable) {
    const pattern = new RegExp(DEFINITION_PATTERNS.join("|"), "i")
    const match = sentence.match(pattern)
    if (!match || match.index === undefined) continue
    const rawTerm = sentence.slice(0, match.index).trim()
    const rawDefinition = sentence.slice(match.index + match[0].length).trim()
    if (rawTerm.length < 3 || rawTerm.length > 48) continue
    if (rawDefinition.length < 25) continue
    const term = rawTerm.replace(/^[^A-Za-z0-9\u00c0-\u024f]+/, "").replace(/[,:;\s]+$/, "")
    if (term.split(/\s+/).length > 6) continue
    const correct = shorten(rawDefinition, 160)
    if (correct.length < 25) continue

    const pool = shuffle(
      uniqueBy(
        [
          ...usable.filter((item) => item !== sentence).map((item) => shorten(item, 160)),
          ...terms.map((item) => shorten(item.display, 160)),
        ],
        (value) => value.toLowerCase(),
      ),
      random,
    ).filter((value) => value.length >= 25 && value.toLowerCase() !== correct.toLowerCase())
    if (pool.length < 3) continue

    const choices = shuffle(
      uniqueBy([correct, ...pool.slice(0, 3)], (value) => value.toLowerCase()),
      random,
    )
    const answerIndex = choices.findIndex((choice) => choice === correct)
    if (answerIndex < 0) continue
    definitionQuestions.push({
      question: `According to the material, which statement best describes \u201c${term}\u201d?`,
      choices,
      answerIndex,
      explanation: `Source sentence: \u201c${sentence}\u201d`,
      difficulty: rawDefinition.length > 140 ? "hard" : "medium",
    })
  }

  const clozeQuestions: DraftQuestion[] = []
  const termPool = terms.slice(0, 24).map((item) => item.display)
  for (const item of ranked) {
    if (clozeQuestions.length >= requested * 2) break
    const present = terms
      .slice(0, 30)
      .find((term) => new RegExp(`\\b${escapeRegExp(term.term)}\\b`, "i").test(item.sentence))
    if (!present) continue
    const matcher = new RegExp(`\\b${escapeRegExp(present.term)}\\b`, "i")
    const display = item.sentence.match(matcher)?.[0]
    if (!display) continue
    const blanked = item.sentence.replace(matcher, "________")
    if (blanked === item.sentence) continue

    const lowSentence = item.sentence.toLowerCase()
    const distractors = shuffle(
      uniqueBy(
        termPool.filter(
          (value) =>
            value.toLowerCase() !== present.term && !lowSentence.includes(value.toLowerCase()),
        ),
        (value) => value.toLowerCase(),
      ),
      random,
    ).slice(0, 3)
    if (distractors.length < 3) continue

    const choices = shuffle(
      uniqueBy([display, ...distractors], (value) => value.toLowerCase()),
      random,
    )
    const answerIndex = choices.findIndex((choice) => choice.toLowerCase() === display.toLowerCase())
    if (answerIndex < 0) continue
    clozeQuestions.push({
      question: `Complete the statement from the material: \u201c${blanked}\u201d`,
      choices,
      answerIndex,
      explanation: `The material states: \u201c${item.sentence}\u201d \u2014 \u201c${display}\u201d is the term used there.`,
      difficulty:
        item.sentence.length > 220 ? "hard" : item.sentence.length < 130 ? "easy" : "medium",
    })
  }

  const questions = uniqueBy(
    [
      ...definitionQuestions.slice(0, Math.max(1, Math.floor(requested / 3))),
      ...clozeQuestions,
    ],
    (item) => item.question.toLowerCase(),
  )
    .slice(0, requested)
    .map((item) => ({ ...item, choices: item.choices.slice(0, 4) }))
    .map((item) => {
      const correct = item.choices[item.answerIndex]
      const choices = shuffle(item.choices, random)
      return { ...item, choices, answerIndex: choices.indexOf(correct) }
    })
    .filter((item) => item.answerIndex >= 0)

  if (!questions.length) {
    throw new Error(
      "Questions could not be generated from this material. Try a longer or more structured document.",
    )
  }

  const cards: DraftFlashcard[] = []
  for (const item of definitionQuestions) {
    const termMatch = item.question.match(/\u201c(.+)\u201d/)
    if (!termMatch) continue
    cards.push({ front: `What is \u201c${termMatch[1]}\u201d?`, back: item.choices[item.answerIndex] })
  }
  for (const item of ranked.slice(0, 14)) {
    const present = terms
      .slice(0, 30)
      .find((term) => new RegExp(`\\b${escapeRegExp(term.term)}\\b`, "i").test(item.sentence))
    if (!present) continue
    cards.push({
      front:
        language === "id"
          ? `Apa peran \u201c${present.display}\u201d dalam materi ini?`
          : `What role does \u201c${present.display}\u201d play in this material?`,
      back: shorten(item.sentence, 220),
    })
  }

  return {
    summary,
    keyPoints,
    objectives,
    flashcards: uniqueBy(cards, (item) => item.front.toLowerCase()).slice(0, 14),
    questions,
    wordCount,
    language,
    provider: "builtin",
  }
}

/**
 * Uses a hosted model when one is configured. The model is asked for strict
 * JSON and its output is validated; if anything is off we fall back to the
 * deterministic generator rather than returning unchecked text.
 */
export async function generateContent(
  text: string,
  options: { questionCount?: number; difficulty?: string } = {},
): Promise<GeneratedContent> {
  const apiKey = getAiApiKey()
  if (!apiKey) return generateBuiltin(text, options)

  const baseUrl = Deno.env.get("LLM_BASE_URL") ?? "https://api.x.ai/v1"
  const model = Deno.env.get("LLM_MODEL") ?? "grok-4.7"
  const questionCount = Math.max(3, Math.min(options.questionCount ?? 10, 25))

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You build study material strictly from the text you are given. Never invent facts. Reply with JSON only.",
          },
          {
            role: "user",
            content: `From the material below produce JSON with this exact shape:
{"summary":string,"keyPoints":string[],"objectives":string[],"flashcards":[{"front":string,"back":string}],"questions":[{"question":string,"choices":string[4],"answerIndex":number,"explanation":string,"difficulty":"easy"|"medium"|"hard"}]}
Rules: produce exactly ${questionCount} questions; every question and explanation must be grounded in the text; explanations must quote the source sentence. Material:\n\n${text.slice(0, 24000)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    })

    if (!response.ok) return generateBuiltin(text, options)
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const raw = payload.choices?.[0]?.message?.content
    if (!raw) return generateBuiltin(text, options)

    const parsed = JSON.parse(raw) as Partial<GeneratedContent>
    const questions = (parsed.questions ?? []).filter(
      (item) =>
        typeof item?.question === "string" &&
        Array.isArray(item.choices) &&
        item.choices.length >= 2 &&
        Number.isInteger(item.answerIndex) &&
        item.answerIndex >= 0 &&
        item.answerIndex < item.choices.length,
    )
    if (!questions.length) return generateBuiltin(text, options)

    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(String) : [],
      objectives: Array.isArray(parsed.objectives) ? parsed.objectives.map(String) : [],
      flashcards: Array.isArray(parsed.flashcards)
        ? parsed.flashcards
            .filter((card) => card && typeof card.front === "string" && typeof card.back === "string")
            .map((card) => ({ front: String(card.front), back: String(card.back) }))
        : [],
      questions: questions.map((item) => ({
        question: String(item.question),
        choices: item.choices.map(String).slice(0, 4),
        answerIndex: item.answerIndex,
        explanation: String(item.explanation ?? ""),
        difficulty:
          item.difficulty === "easy" || item.difficulty === "hard" ? item.difficulty : "medium",
      })),
      wordCount: countWords(text),
      language: detectLanguage(text),
      provider: "model",
    }
  } catch {
    return generateBuiltin(text, options)
  }
}

export function isAiConfigured(): boolean {
  return Boolean(getAiApiKey())
}
