import type { Flashcard, Question } from "../types"

/**
 * Deterministic, grounded learning-content generation.
 *
 * Everything produced here is derived from the text the user actually
 * uploaded: summaries are extractive, questions are cloze/definition
 * questions anchored to real source sentences, and every explanation
 * quotes the sentence the answer came from. Nothing is invented and no
 * network model is required.
 *
 * The same text always produces the same content because every random
 * choice goes through a seeded PRNG keyed on a hash of the text.
 */

export type DraftFlashcard = Omit<Flashcard, "id">
export type DraftQuestion = Omit<Question, "id" | "position">

export type GeneratedContent = {
  summary: string
  keyPoints: string[]
  objectives: string[]
  flashcards: DraftFlashcard[]
  questions: DraftQuestion[]
  wordCount: number
  language: "en" | "id"
}

export type GenerateOptions = {
  questionCount?: number
  difficulty?: "easy" | "medium" | "hard"
}

const ENGLISH_STOPWORDS = `a about above after again against all also am an and any are aren't as at be because been before being below between both but by can cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he her here hers herself him himself his how however i if in into is isn't it its itself just let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she should shouldn't so some such than that the their theirs them themselves then there these they this those through to too under until up very was wasn't we were weren't what when where which while who whom why with won't would wouldn't you your yours yourself yourselves will shall may might must upon within without using used use one two three first second next last new e.g i.e thus hence therefore however moreover furthermore also may be able following given such as well`
  .split(/\s+/)
  .filter(Boolean)

const INDONESIAN_STOPWORDS = `ada adalah agar akan antara apa apabila atas atau bagaimana bagi bahwa baik banyak baru beberapa begitu belum berada berdasarkan berikut besar bisa boleh buat bukan dalam dan dapat dari daripada dasar dengan di adalah dia dimana digunakan yaitu jika juga karena ke kepada kemudian ketika kita lain lainnya lalu lebih maka maupun masih melainkan melalui masing membutuhkan memiliki membuat merupakan mengapa mengenai meskipun namun oleh pada paling para perlu pertama per sebuah sebagai secara setiap sehingga sejak seperti serta sesuai supaya tadi tanpa telah tetapi tidak ini itu untuk tersebut yaitu hanya saja anda kamu mereka kami saya akan sering pada waktu orang tahun secara umum jenis bagian contoh dengan terhadap hal tersebut`
  .split(/\s+/)
  .filter(Boolean)

const STOPWORDS = new Set([...ENGLISH_STOPWORDS, ...INDONESIAN_STOPWORDS])

const DEFINITION_PATTERNS = [
  /\bis\b/i,
  /\bare\b/i,
  /\brefers to\b/i,
  /\bmeans\b/i,
  /\bis defined as\b/i,
  /\bcan be defined as\b/i,
  /\badalah\b/i,
  /\bmerupakan\b/i,
  /\byaitu\b/i,
  /\bmerujuk pada\b/i,
  /\bberarti\b/i,
]

export function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Small deterministic PRNG (mulberry32). */
function createRandom(seed: number) {
  let state = seed >>> 0
  return function random() {
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

export function splitSentences(text: string): string[] {
  const flattened = text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim()
  if (!flattened) return []
  // Protect common abbreviations so they do not split mid-sentence.
  const protectedText = flattened
    .replace(/\b(Dr|Mr|Mrs|Ms|Prof|vs|etc|e\.g|i\.e|No|Fig|al)\./gi, "$1<DOT>")
    .replace(/(\d)\.(\d)/g, "$1<DOT>$2")

  const parts = protectedText
    .split(/(?<=[.!?…])\s+(?=[A-Z0-9"“(])/)
    .map((part) => part.replace(/<DOT>/g, ".").trim())
    .filter(Boolean)

  return parts.length ? parts : [flattened]
}

function words(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
}

function contentWords(sentence: string): string[] {
  return words(sentence).filter(
    (word) => word.length >= 4 && !STOPWORDS.has(word) && !/^\d+$/.test(word),
  )
}

export function detectLanguage(text: string): "en" | "id" {
  const tokens = words(text).slice(0, 4000)
  if (!tokens.length) return "en"
  const englishHits = tokens.filter((token) => ENGLISH_STOPWORDS.includes(token)).length
  const indonesianHits = tokens.filter((token) =>
    INDONESIAN_STOPWORDS.includes(token),
  ).length
  return indonesianHits > englishHits * 1.15 ? "id" : "en"
}

export function countWords(text: string): number {
  return words(text).length
}

type TermScore = { term: string; score: number; count: number; display: string }

function extractTerms(sentences: string[]): TermScore[] {
  const documentFrequency = new Map<string, number>()
  const termFrequency = new Map<string, number>()
  const display = new Map<string, string>()

  sentences.forEach((sentence) => {
    const seen = new Set<string>()
    contentWords(sentence).forEach((word) => {
      termFrequency.set(word, (termFrequency.get(word) || 0) + 1)
      if (!seen.has(word)) {
        seen.add(word)
        documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1)
      }
      if (!display.has(word)) {
        const match = sentence.match(new RegExp(`\\b${escapeRegExp(word)}\\b`, "i"))
        if (match) display.set(word, match[0])
      }
    })
  })

  const total = Math.max(sentences.length, 1)
  const scored: TermScore[] = []
  termFrequency.forEach((count, term) => {
    const df = documentFrequency.get(term) || 1
    const idf = Math.log(1 + total / df)
    // Reward terms that repeat but are not ubiquitous, and prefer richer words.
    const score = (Math.log(1 + count) * idf * (1 + Math.min(term.length, 14) / 20))
    scored.push({ term, score, count, display: display.get(term) || term })
  })

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    return left.term.localeCompare(right.term)
  })
  return scored
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function scoreSentence(sentence: string, termScores: Map<string, number>): number {
  const tokens = contentWords(sentence)
  if (!tokens.length) return 0
  const sum = tokens.reduce((total, token) => total + (termScores.get(token) || 0), 0)
  const positionBoost = 1
  return (sum / Math.sqrt(tokens.length)) * positionBoost
}

function shorten(text: string, limit: number): string {
  const clean = text.trim().replace(/\s+/g, " ")
  if (clean.length <= limit) return clean
  const clipped = clean.slice(0, limit)
  const boundary = Math.max(
    clipped.lastIndexOf(", "),
    clipped.lastIndexOf("; "),
    clipped.lastIndexOf(" — "),
    clipped.lastIndexOf(" "),
  )
  const cut = boundary > limit * 0.55 ? clipped.slice(0, boundary) : clipped
  return `${cut.replace(/[,;:\s]+$/, "")}…`
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  items.forEach((item) => {
    const value = key(item)
    if (seen.has(value)) return
    seen.add(value)
    result.push(item)
  })
  return result
}

function shuffleDeterministic<T>(items: T[], random: () => number): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap], copy[index]]
  }
  return copy
}

function pickDistractors(
  pool: TermScore[],
  correct: string,
  sentence: string,
  random: () => number,
  fallbackPool: string[],
): string[] {
  const sentenceLower = sentence.toLowerCase()
  const candidates = pool
    .filter((item) => item.term !== correct)
    .filter((item) => !sentenceLower.includes(item.term))
    .map((item) => item.display)

  const ordered = shuffleDeterministic(uniqueBy(candidates, (item) => item.toLowerCase()), random)

  const selected = ordered.slice(0, 3)
  if (selected.length >= 3) return selected

  const fallback = fallbackPool.filter(
    (item) =>
      item.toLowerCase() !== correct.toLowerCase() &&
      !selected.some((value) => value.toLowerCase() === item.toLowerCase()),
  )
  return [...selected, ...fallback].slice(0, 3)
}

function buildClozeQuestion(
  sentence: string,
  term: TermScore,
  terms: TermScore[],
  random: () => number,
): DraftQuestion | null {
  const matcher = new RegExp(`\\b${escapeRegExp(term.term)}\\b`, "i")
  if (!matcher.test(sentence)) return null
  const display = sentence.match(matcher)?.[0] || term.display
  const blanked = sentence.replace(matcher, "________")
  if (blanked === sentence) return null

  const distractors = pickDistractors(
    terms,
    term.term,
    sentence,
    random,
    terms.slice(0, 24).map((item) => item.display),
  )
  if (distractors.length < 3) return null

  const correctAnswer = display
  const choices = shuffleDeterministic(
    uniqueBy([correctAnswer, ...distractors], (value) => value.toLowerCase()),
    random,
  )
  const answerIndex = choices.findIndex(
    (choice) => choice.toLowerCase() === correctAnswer.toLowerCase(),
  )
  if (answerIndex < 0) return null

  return {
    question: `Complete the statement from the material: “${blanked}”`,
    choices,
    answerIndex,
    explanation: `The material states: “${sentence}” — “${correctAnswer}” is the term used there.`,
    difficulty: sentence.length > 220 ? "hard" : sentence.length < 130 ? "easy" : "medium",
  }
}

function buildDefinitionQuestion(
  sentence: string,
  terms: TermScore[],
  sentences: string[],
  random: () => number,
): DraftQuestion | null {
  const match = sentence.match(DEFINITION_PATTERNS.map((pattern) => pattern.source).join("|"))
  if (!match || match.index === undefined) return null

  const rawTerm = sentence.slice(0, match.index).trim()
  const rawDefinition = sentence.slice(match.index + match[0].length).trim()
  if (rawTerm.length < 3 || rawTerm.length > 48) return null
  if (rawDefinition.length < 25) return null
  const term = rawTerm.replace(/^[^A-Za-z0-9\u00c0-\u024f]+/, "").replace(/[,:;\s]+$/, "")
  if (term.split(/\s+/).length > 6) return null

  const correctAnswer = shorten(rawDefinition, 160)
  if (correctAnswer.length < 25) return null

  const otherDefinitions = sentences
    .filter((item) => item !== sentence)
    .map((item) => shorten(item, 160))
    .filter((item) => item.length >= 30)
  const distractorPool = shuffleDeterministic(
    uniqueBy(
      [...otherDefinitions, ...terms.map((item) => shorten(item.display, 160))],
      (value) => value.toLowerCase(),
    ),
    random,
  ).filter((value) => value.toLowerCase() !== correctAnswer.toLowerCase())

  if (distractorPool.length < 3) return null

  const choices = shuffleDeterministic(
    uniqueBy([correctAnswer, ...distractorPool.slice(0, 3)], (value) => value.toLowerCase()),
    random,
  )
  const answerIndex = choices.findIndex((choice) => choice === correctAnswer)
  if (answerIndex < 0) return null

  return {
    question: `According to the material, which statement best describes “${term}”?`,
    choices,
    answerIndex,
    explanation: `Source sentence: “${sentence}”`,
    difficulty: rawDefinition.length > 140 ? "hard" : "medium",
  }
}

export function generateLearningContent(
  rawText: string,
  options: GenerateOptions = {},
): GeneratedContent {
  const text = normalizeText(rawText)
  const wordCount = countWords(text)
  if (wordCount < 60) {
    throw new Error(
      "The extracted text is too short to build a study world (at least 60 words are required).",
    )
  }

  const language = detectLanguage(text)
  const sentences = splitSentences(text).filter(
    (sentence) => sentence.length >= 40 && sentence.length <= 600,
  )
  const usable = sentences.length >= 3 ? sentences : splitSentences(text).filter(Boolean)
  if (usable.length < 2) {
    throw new Error("No complete sentences could be read from this material.")
  }

  const terms = extractTerms(usable)
  if (terms.length < 6) {
    throw new Error("Not enough distinct terminology was found to build questions.")
  }
  const termScores = new Map(terms.map((item) => [item.term, item.score]))

  const rankedSentences = usable
    .map((sentence, index) => ({
      sentence,
      index,
      score: scoreSentence(sentence, termScores),
    }))
    .sort((left, right) => right.score - left.score)

  const summaryCount = Math.max(2, Math.min(6, Math.round(usable.length * 0.22)))
  const summarySentences = rankedSentences
    .slice(0, summaryCount)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.sentence)

  const summary = summarySentences.join(" ")
  const keyPoints = rankedSentences
    .slice(0, 6)
    .map((item) => shorten(item.sentence, 150))

  const objectiveVerbs =
    language === "id"
      ? ["Menjelaskan", "Menganalisis", "Menerapkan", "Membandingkan", "Mengevaluasi"]
      : ["Explain", "Analyse", "Apply", "Compare", "Evaluate"]

  const objectives = rankedSentences.slice(0, 5).map((item, index) => {
    const verb = objectiveVerbs[index % objectiveVerbs.length]
    return `${verb}: ${shorten(item.sentence, 132)}`
  })

  const random = createRandom(hashString(text))
  const requested = Math.max(3, Math.min(options.questionCount ?? 10, 25))
  const questions: DraftQuestion[] = []

  const definitionCandidates = usable
    .map((sentence) => buildDefinitionQuestion(sentence, terms, usable, random))
    .filter((item): item is DraftQuestion => item !== null)

  questions.push(...definitionCandidates.slice(0, Math.max(1, Math.floor(requested / 3))))

  const clozeCandidates: DraftQuestion[] = []
  const sentenceOrder = rankedSentences.map((item) => item.sentence)
  for (const sentence of sentenceOrder) {
    if (clozeCandidates.length >= requested * 2) break
    const present = terms
      .slice(0, 30)
      .filter((term) => new RegExp(`\\b${escapeRegExp(term.term)}\\b`, "i").test(sentence))
    const chosen = present[0]
    if (!chosen) continue
    const question = buildClozeQuestion(sentence, chosen, terms, random)
    if (question) clozeCandidates.push(question)
  }

  // Fill up to the requested count, then stop. Deduplicate by prompt.
  for (const candidate of clozeCandidates) {
    if (questions.length >= requested) break
    questions.push(candidate)
  }

  const finalQuestions = uniqueBy(questions, (item) => item.question.toLowerCase())
    .slice(0, requested)
    .map((item) => ({
      ...item,
      choices: item.choices.slice(0, 4),
      answerIndex: item.choices.slice(0, 4).findIndex(
        (choice) => choice === item.choices[item.answerIndex],
      ),
    }))
    .filter((item) => item.answerIndex >= 0 && item.choices.length >= 2)

  if (finalQuestions.length === 0) {
    throw new Error(
      "Questions could not be generated from this material. Try a longer or more structured document.",
    )
  }

  const flashcardPool: DraftFlashcard[] = []
  definitionCandidates.forEach((item) => {
    const termMatch = item.question.match(/“(.+)”/)
    if (!termMatch) return
    flashcardPool.push({
      front: `What is “${termMatch[1]}”?`,
      back: item.choices[item.answerIndex],
    })
  })

  const flashSentences = rankedSentences.slice(0, 14)
  flashSentences.forEach((item) => {
    const present = terms
      .slice(0, 30)
      .filter((term) => new RegExp(`\\b${escapeRegExp(term.term)}\\b`, "i").test(item.sentence))
    const term = present[0]
    if (!term) return
    flashcardPool.push({
      front:
        language === "id"
          ? `Apa peran “${term.display}” dalam materi ini?`
          : `What role does “${term.display}” play in this material?`,
      back: shorten(item.sentence, 220),
    })
  })

  const flashcards = uniqueBy(flashcardPool, (item) => item.front.toLowerCase()).slice(0, 14)

  return {
    summary,
    keyPoints,
    objectives,
    flashcards,
    questions: finalQuestions,
    wordCount,
    language,
  }
}
