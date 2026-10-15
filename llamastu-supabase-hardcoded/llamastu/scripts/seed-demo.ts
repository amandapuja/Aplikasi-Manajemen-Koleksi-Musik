import { createClient } from "@supabase/supabase-js"
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_MATERIALS } from "../src/lib/demo"
import { generateLearningContent } from "../src/lib/content"
import * as rules from "../src/lib/rules"

const SUPABASE_URL = "https://lhsgroyjgbzeikesttuo.supabase.co"
const SUPABASE_ANON_KEY = "sb_publishable_1pX5E0n-fzA7jY0g9EDbkw_3hVnazoW"

async function run() {
  console.log("Signing in as demo user...")
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  })

  if (authError || !authData.session) {
    throw new Error(`Auth failed: ${authError?.message}`)
  }

  const userId = authData.user.id
  console.log(`Signed in successfully! User ID: ${userId}`)

  // Update profile
  await client.from("profiles").upsert({
    id: userId,
    email: DEMO_EMAIL,
    name: "Demo Learner",
    username: "demolearner",
    program: "Informatics & Computer Science",
    semester: "Semester 3",
    bio: "Exploring interactive learning with Llamastu!",
    character: {
      hair: "cocoa",
      face: "bright",
      outfit: "peach",
      shoes: "trail",
      hat: "none",
      glasses: "none",
      backpack: "canvas",
      accessory: "book",
    },
  })

  // Check if materials already exist
  const { data: existingMaterials } = await client
    .from("materials")
    .select("id")
    .eq("user_id", userId)

  if (existingMaterials && existingMaterials.length > 0) {
    console.log(`Demo account already has ${existingMaterials.length} materials. Seeding skipped.`)
    return
  }

  console.log("Seeding demo materials...")
  const now = new Date()
  let firstMaterialId = ""
  let firstQuestionIds: string[] = []

  for (const [index, seed] of DEMO_MATERIALS.entries()) {
    const generated = generateLearningContent(seed.text, { questionCount: 10 })
    const createdAt = new Date(now.getTime() - (index + 1) * 3_600_000).toISOString()

    const { data: material, error: matErr } = await client
      .from("materials")
      .insert({
        user_id: userId,
        name: seed.name,
        title: seed.title,
        subject: seed.subject,
        mime_type: "text/plain",
        size_bytes: seed.text.length,
        storage_path: null,
        status: "ready",
        error_message: null,
        summary: generated.summary,
        key_points: generated.keyPoints,
        objectives: generated.objectives,
        flashcards: generated.flashcards,
        extracted_text: seed.text,
        word_count: generated.wordCount,
        xp_awarded: true,
        processed_at: createdAt,
        created_at: createdAt,
        updated_at: createdAt,
      })
      .select("id")
      .single()

    if (matErr || !material) {
      console.error("Error creating material:", matErr)
      continue
    }

    const questionRows = generated.questions.map((question, position) => ({
      material_id: material.id,
      user_id: userId,
      position,
      question: question.question,
      choices: question.choices,
      answer_index: question.answerIndex,
      explanation: question.explanation,
      difficulty: question.difficulty,
    }))

    await client.from("material_questions").insert(questionRows)
    const { data: savedQuestions } = await client
      .from("material_questions")
      .select("id")
      .eq("material_id", material.id)
      .order("position")

    await client.from("xp_events").upsert(
      {
        user_id: userId,
        event_key: rules.eventKeyMaterial(material.id),
        xp: rules.XP.materialProcessed,
      },
      { onConflict: "user_id,event_key", ignoreDuplicates: true },
    )

    if (index === 0) {
      firstMaterialId = material.id
      firstQuestionIds = (savedQuestions ?? []).map((row) => String(row.id))
    }
  }

  // Quiz attempt on the second material
  const { data: secondMaterial } = await client
    .from("materials")
    .select("id")
    .eq("user_id", userId)
    .eq("title", DEMO_MATERIALS[1].title)
    .maybeSingle()

  if (secondMaterial) {
    const { data: questions } = await client
      .from("material_questions")
      .select("id, answer_index")
      .eq("material_id", secondMaterial.id)
      .order("position")

    const rows = questions ?? []
    if (rows.length) {
      const score = Math.max(1, rows.length - 2)
      await client.from("quiz_attempts").insert({
        material_id: secondMaterial.id,
        user_id: userId,
        score,
        total: rows.length,
        xp_awarded: 0,
        answers: Object.fromEntries(
          rows.slice(0, score).map((row) => [String(row.id), Number(row.answer_index)]),
        ),
      })

      for (const row of rows.slice(0, score)) {
        await client.from("xp_events").upsert(
          {
            user_id: userId,
            event_key: rules.eventKeyQuizAnswer(secondMaterial.id, String(row.id)),
            xp: rules.XP.quizQuestionCorrect,
          },
          { onConflict: "user_id,event_key", ignoreDuplicates: true },
        )
      }
    }
  }

  // Game progress on first material
  if (firstMaterialId && firstQuestionIds.length) {
    const mapId = "obstacle_adventure"
    const opened = firstQuestionIds.slice(0, 4)
    const orbs = ["orb-start-0", "orb-start-1", "orb-0-c", "orb-1-c", "orb-2-c"]
    await client.from("game_progress").upsert(
      {
        user_id: userId,
        material_id: firstMaterialId,
        map_id: mapId,
        character_id: "female",
        orb_total: 46,
        opened_gates: opened,
        collected: orbs,
        checkpoints: ["checkpoint-start", "checkpoint-1", "checkpoint-2"],
        position: 2400,
        finished: true,
        xp_awarded: 0,
        best_time_seconds: 214,
      },
      { onConflict: "user_id,material_id,map_id" },
    )
  }

  // Calendar
  const classStart = new Date(now)
  classStart.setDate(classStart.getDate() + 1)
  classStart.setHours(9, 0, 0, 0)
  await client.from("calendar_events").insert({
    user_id: userId,
    title: "Struktur Data (Kuliah)",
    description: "Weekly lecture on Data Structures and Multi Linked Lists.",
    category: "class",
    start_at: classStart.toISOString(),
    end_at: new Date(classStart.getTime() + 100 * 60_000).toISOString(),
    location: "Lab 3.02",
    repeat_rule: "weekly",
    reminder_minutes: 30,
    reminder_at: new Date(classStart.getTime() - 30 * 60_000).toISOString(),
  })

  const studyStart = new Date(now)
  studyStart.setHours(19, 0, 0, 0)
  if (studyStart.getTime() < now.getTime()) studyStart.setDate(studyStart.getDate() + 1)
  await client.from("calendar_events").insert({
    user_id: userId,
    title: "Belajar Mandiri - Struktur Data",
    description: "Revise multi linked list traversal before the quiz.",
    category: "study",
    start_at: studyStart.toISOString(),
    end_at: new Date(studyStart.getTime() + 60 * 60_000).toISOString(),
    repeat_rule: "none",
    reminder_minutes: 15,
    reminder_at: new Date(studyStart.getTime() - 15 * 60_000).toISOString(),
    material_id: firstMaterialId || null,
  })

  // Notes
  await client.from("notes").insert({
    owner_id: userId,
    title: "Multi Linked List - Ringkasan Materi",
    content:
      "<p>Node dalam Multi Linked List memiliki <b>dua pointer atau lebih</b> secara bersamaan.</p>" +
      "<ul><li>Header node adalah sentinel tanpa data untuk menandai awal baris/kolom.</li>" +
      "<li>Operasi insert harus memperbarui setiap linked list yang berpartisipasi.</li>" +
      "<li>Operasi delete harus meng-unlink node dari semua list sebelum memori dibebaskan.</li></ul>",
    material_id: firstMaterialId || null,
  })

  // Daily activity / Streak
  const days = [0, 1, 2].map((back) => {
    const day = new Date(now)
    day.setDate(day.getDate() - back)
    return day.toISOString().slice(0, 10)
  })
  for (const date of days) {
    await client.from("daily_activity").upsert(
      { user_id: userId, activity_date: date, xp_earned: 50 },
      { onConflict: "user_id,activity_date", ignoreDuplicates: true },
    )
  }

  // Welcome notification
  await client.from("notifications").insert({
    user_id: userId,
    title: "Selamat datang di Demo Llamastu!",
    message: "Dua materi kuliah telah diproses secara otomatis. Silakan baca ringkasan, pelajari flashcard, atau jelajahi adventure world!",
    kind: "system",
    read: false,
  })

  console.log("Demo account successfully seeded with real Supabase data!")
}

run().catch((err) => {
  console.error("Seed failed:", err)
  process.exit(1)
})
