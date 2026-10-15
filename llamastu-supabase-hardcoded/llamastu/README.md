# Llamastu — Interactive Learning Platform

Upload a real course document. Llamastu reads it, writes an extractive summary,
flashcards and grounded quiz questions — then turns those questions into a
**playable platformer world** whose gates only open when you answer correctly.

---

## 1. Feature overview

| Area | What it does |
|---|---|
| Materials | PDF · DOCX · PPTX · XLSX · ODT · TXT · MD · CSV · JSON · HTML · RTF · images. Text is extracted in the browser; the file is stored and can be reopened. |
| Learning content | Extractive summary, key points, learning objectives, flashcards and quiz questions, all generated from the document's own sentences. |
| Quiz | Question navigation, answer selection, immediate correct/incorrect feedback with the source sentence as the explanation, score, retry, attempt history and XP. |
| Adventure worlds | 5 hand-tuned maps. Real platformer physics, gates that physically block you, collectibles, checkpoints, explicit death zones, respawn and a goal. |
| Playable character | Two playable bodies with different silhouettes and animations (selected inside the game flow). The standalone **Characters** feature has been removed — see section 9. |
| Study Assistant | A server-side AI chat that answers questions and can ground its answers in one of your own materials. |
| Import / export | Full account export to JSON and CSV, read from the authoritative rows at the moment you ask for it. |
| Progression | XP ledger with idempotent rewards, levels, streaks and 10 achievements. |
| Notes | Rich-text notes with autosave, material linking and per-account sharing (viewer / editor). |
| Calendar | Month grid and agenda list, categories, durations, recurring events and linked materials. |
| Alarm / reminders | Every agenda item carries a derived reminder. Editing the event moves the alarm; deleting the event cancels it. |
| Notifications | In-app notification centre with unread counts, plus browser notifications, a service worker and a Web Push transport. |
| Timetable | The class timetable is a view over the same calendar store — one source of truth, not two systems. |

---

## 2. Tech stack

React 19 · TypeScript 5.7 · Vite 8 · Tailwind CSS v4 (the app itself is styled
with a hand-written design system in `src/index.css`) · `@supabase/supabase-js` ·
`pdfjs-dist` (PDF extraction) · `fflate` (OOXML/ODF unzip) · Hono on Supabase Edge
Functions (Deno) · Postgres with Row Level Security.

---

## 3. Installation

```bash
npm install
npm run dev        # http://localhost:5173
```

Sign in or create an account to use the app. With Supabase configured, account data
(materials, notes, calendar, game progress, achievements, and preferences) is stored
against that authenticated user and follows them across devices. Visitors must use
their own account; the app no longer sends everyone into a shared editable demo account.

If Supabase is not configured, the app explicitly identifies the local backend as
device-only. Local data is stored in IndexedDB and cannot sync to another device.
When Supabase is configured but its Edge Function is unavailable, the app keeps
Supabase selected and reports the connection problem rather than silently creating a
separate local workspace.

The appearance preference (dark mode) is stored with the user's Supabase profile.
Existing `llamastu-theme` browser preferences are migrated to the account on the first
successful load; after migration, the browser copy is removed.

### Build and test

```bash
npm run typecheck  # TypeScript
npm run test:logic # 42 behavioural checks (content generation + game physics)
npm run build      # production build -> dist/
npm run preview    # serve the production build
```

---

## 4. Environment variables

```bash
cp .env.example .env
```

`VITE_*` and `NEXT_PUBLIC_*` values are bundled into the browser and must be
public. Server-only secrets go in the Edge Function environment, never in a
file the frontend reads.

### Frontend (public)

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` or `VITE_SUPABASE_URL` | for Supabase | Project URL, `https://…` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY` | for Supabase | Public publishable/anon key, protected by RLS |
| `VITE_SUPABASE_FUNCTIONS_NAME` | no | Edge Function folder, default `server` |
| `VITE_SUPABASE_MATERIALS_BUCKET` | no | Storage bucket, default `materials` |
| `PUBLIC_BASE_PATH` | no | Sub-path when deploying under a folder |

**No credentials are committed.** `utils/supabase/info.tsx` reads the environment
and derives the project reference from the URL. If the variables are missing or
malformed the app says exactly which one is missing.

### Edge Function (server only)

| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | Supplied automatically by the Supabase runtime |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list. Unset = echo the caller's origin (development) |
| `MATERIALS_BUCKET` | Optional bucket override |
| `LLM_API_KEY` (`LLM API AI key` is also accepted), `LLM_BASE_URL`, `LLM_MODEL` | Optional hosted model. Defaults to xAI (`https://api.x.ai/v1`, `grok-4.7`). Without an API key the built-in deterministic generator is used and `/health` reports `ai: false` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Optional Web Push. Generate with `npx web-push generate-vapid-keys`. The private key stays server-side |

---

## 5. Supabase setup

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push                                   # schema, RLS, triggers, preferences
supabase functions deploy server --no-verify-jwt   # the API
supabase secrets set ALLOWED_ORIGINS="https://your-app.example.com,http://localhost:8443,http://localhost:5173,http://localhost:4173"
```

The database migration creates the private `materials` Storage bucket and
owner-only object policies.

Then put `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
`VITE_SUPABASE_FUNCTIONS_NAME=server` in `.env` and restart
the dev server (Vite reads `.env` at start-up). If the Edge Function is down, the
app reports the issue and remains on Supabase; reload after the service is restored.
Deploy the function with `supabase functions deploy server --no-verify-jwt`. If your
project already has the function deployed under another name, set
`VITE_SUPABASE_FUNCTIONS_NAME` to that name and rebuild the frontend. Set
`ALLOWED_ORIGINS` to the exact deployed frontend origin(s), plus any local origins
you use for development.

The `20260401000000_persist_user_preferences.sql` migration adds account-level
appearance preferences. Apply all migrations with `supabase db push` before deploying
the updated frontend.

## 6. Deploy to Vercel

This is a static Vite app. `vercel.json` builds with `npm run build`, serves
`dist`, and sends client-side routes back to `index.html`. In Vercel, add these
public environment variables to **Production**, **Preview**, and **Development**
before deploying:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Your Supabase publishable key |
| `VITE_SUPABASE_FUNCTIONS_NAME` | `server` |

Then deploy the project root with the Vercel CLI (`vercel --prod`) or import the
repository in the Vercel dashboard. Redeploy after changing environment
variables. Never add a Supabase service-role key or AI provider key as a
`NEXT_PUBLIC_*` or `VITE_*` variable.

The browser previously contained a direct Groq API key. It has been removed from
the client path; revoke that old key in the provider dashboard. The AI assistant
requires a fresh provider key stored as the Supabase Edge Function secret
`LLM_API_KEY`.

### Database

`supabase/migrations/20260101000000_llamastu_init.sql` creates:

`profiles`, `xp_events`, `daily_activity`, `materials`, `material_questions`,
`quiz_attempts`, `notes`, `note_collaborators`, `schedules`, `notifications`,
`game_progress`, `achievements`, `user_achievements`

…with primary keys, foreign keys, `created_at` / `updated_at` triggers, indexes,
a `handle_new_user` trigger and a private `materials` bucket whose policies
restrict objects to `<user_id>/…`.

**RLS is enabled on every table.** `xp_events` carries
`unique (user_id, event_key)`, which is the mechanism that makes duplicate XP
impossible. Notes additionally allow invited collaborators through
`can_access_note()`, with editors distinguished from viewers.

### Edge Functions

`supabase/functions/server/` — Hono app, `verify_jwt = false` because it performs
its own verification with the admin client (so `/health` can answer without a
token while every data route stays protected). Every query runs through a client
carrying the caller's access token, so Postgres RLS is what enforces ownership. A
user id sent by the browser is never trusted.

---

## 6. Material processing

```
Upload → file stored → material row (status = processing)
       → text extracted in the browser
       → summary · key points · objectives · flashcards · questions
       → status = ready
```

- **PDF** uses `pdf.js`, with a built-in PDF stream parser as a fallback.
- **DOCX / PPTX / XLSX / ODT** are unzipped with `fflate` and read out of the
  OOXML / OpenDocument XML.
- **TXT / MD / CSV / JSON / XML / HTML / RTF** are read directly.
- **Scanned PDFs and images** contain no text layer. The app detects this and says
  so explicitly — *“This document has no extractable text layer…”* — then offers
  **Paste text**. It never reports `ready` for a document it could not read, never
  builds a summary from empty input and never enters an infinite loading state.
- **Generation is deterministic and grounded.** Summaries are extractive; questions
  are cloze questions (a real term blanked out of a real sentence) and definition
  questions (from `X is Y` / `X adalah Y` patterns); distractors are other salient
  terms from the same document; every explanation quotes the source sentence. The
  same text always yields the same questions.

---

## 7. Quiz

Questions come from the material and nowhere else. The quiz provides navigation,
answer selection, `Check answer` with immediate correct/incorrect feedback and the
source explanation, previous/next, a completion state, score, retry and attempt
history.

**XP is idempotent.** A correct answer awards `+20 XP` the first time that
`(material, question)` is answered correctly and never again. Re-checking
questions, refreshing or resubmitting cannot farm XP — the attempt is still
recorded and the score still updates.

---

## 8. Game

### Flow

```
Play game → Choose your character → Choose a map → Objective → Start
  → spawn → explore → gate collision → question
  → correct → gate unlocks → XP → checkpoint → next gate → final challenge
  → goal → Map completed → XP → progress saved
```

### Controls

Desktop: `A` / `←` left, `D` / `→` right, `Space` / `↑` / `W` jump.
Touch devices additionally get on-screen left / right / jump buttons. There is no
device selector anywhere — the layout is responsive on its own.

### Physics

Fixed 120 Hz timestep, per-map gravity, acceleration and friction, variable jump
height, coyote time (0.1 s), jump buffer (0.12 s) and axis-separated AABB
collision resolved in three passes. The player is clamped inside the world so they
can never walk out of it, and falling past the world floor counts as a death.

### Obstacles are real collision objects

A gate is a solid slab the player physically cannot pass — from the side, from
below, or by jumping, because the builder guarantees it is taller than anything
reachable from any platform in that level. Reaching the trigger band in front of it
pauses the world and opens the challenge. A correct answer unlocks the gate and
awards XP; a wrong answer shows the explanation, disables that option and leaves
the gate locked. After three wrong attempts a *Show me the answer* escape hatch
opens the gate **without XP** so nobody can get stuck.

### The five maps

| Map | Environment | Mechanic | Difficulty |
|---|---|---|---|
| Obstacle Adventure | Rolling hills, floating ledges | Classic gaps and platforms | Easy |
| Cooking Kitchen | Tiled kitchen with counters | Extra counter rows, more ingredients, tighter jumps | Easy |
| Mystery Lab | Cool lab corridors | Capped jump height (low ceilings) and narrow corridors | Hard |
| Treasure Island | Cliffs over water | Wide gaps crossed on stepping stones, chest collectibles | Medium |
| Space Station | Dark station interior | **Low gravity** and drifting platforms spanning the gaps | Medium |

They differ structurally, not cosmetically: layout recipe, gravity, gap range, gate
width, platform rows, collectible identity and obstacle surface treatment.

**Material supplies the questions, the map supplies the world.** Playing a
*Database normalisation* document on *Cooking Kitchen* gives you a kitchen level
that asks database questions — never random cooking trivia.

### Progress

Progress is keyed by `(material, map)`, so the same document played in two maps
keeps two independent sets of gates, orbs and checkpoints, and each map awards its
own XP exactly once. Checkpoints are saved, deaths respawn you at the last one, and
a page refresh restores everything from the backend.

---

## 9. Characters — REMOVED as a standalone feature

The standalone **Characters** page, its sidebar entry and its route no longer
exist. The page component was deleted and its page-only CSS was removed with it.

What was deliberately kept is the **playable character**, which the games need:
`src/game/characters.ts`, the avatar in the shell, and the
`PATCH /character` route the world uses to remember the selected body. The
"Choose Your Character" step inside the Adventure world is part of the game
flow, not the removed feature.

Two genuinely different playable bodies, not a recolour:

| | Silhouette | Animation |
|---|---|---|
| **Raka** (male) | Broader shoulders, straighter torso, shoulder yoke, shorter legs | Longer stride, steadier landing |
| **Nara** (female) | Narrower shoulders, tapered torso with flared tunic hem, longer legs, long hair | Lighter walk, taller idle bob |

Both animate idle, walk, jump and land. Selection is remembered on the profile
(`character.model`) and is used as the default next time.

---

## 10. Calendar

- **Month view** with a six-week grid, per-day category dots and a selected-day
  panel; **agenda view** listing the next 90 days.
- **Create / edit / delete** an event with title, description, date, start time,
  duration, category, location, linked material and recurrence
  (none / daily / weekly / monthly).
- Recurring events expand into occurrences, each carrying its own correct reminder.
- Creating an agenda from a material is one click in the workspace
  (**Add to Calendar**), which pre-fills the title and links `material_id`.

---

## 11. Alarms and reminders

A reminder is **never a separate entity**. It is derived from the event's start
time and its lead time, and the result (`reminderAt`) is stored on the event row.

Lead-time options: no reminder, at start time, 5, 10, 15, 30 minutes, 1 hour and
1 day before.

Because it is derived:

- editing the date, the time or the lead time moves the alarm with it,
- deleting the event cancels the alarm — an orphan reminder is not representable,
- rescheduling an event clears the `reminderSentAt` marker so it can fire again.

While the app is open, reminders fire as an in-app toast and, if enabled, a browser
notification.

---

## 12. Notifications

- **In-app centre** with unread count, mark-as-read, mark-all-as-read and delete.
- **Preferences** (Calendar page and Settings): master switch, agenda reminders,
  study reminders, game reminders and browser reminders.
- **Permission UX**: when reminders are first enabled and permission is missing the
  app explains what it is for, offers *Enable notifications*, stores the result, and
  if permission is denied it says *“Notifications are disabled in your browser
  settings”* without crashing or nagging.

---

## 13. Web Push setup

`public/sw.js` is a real service worker that (a) caches the app shell for offline
use and (b) handles `push`, `notificationclick` and `message` events so a reminder
can be displayed even when no tab is open. It is registered from `src/main.tsx`,
and `src/lib/push.ts` wraps registration, permission and
`pushManager.subscribe`.

To enable delivery while every tab is closed:

```bash
npx web-push generate-vapid-keys
supabase secrets set VAPID_PUBLIC_KEY="…" VAPID_PRIVATE_KEY="…" VAPID_SUBJECT="mailto:you@example.com"
```

Then have the Edge Function store subscriptions and send:
`POST /push/subscribe { endpoint, keys }`, `GET /push/public-key`, and a scheduled
job that reads events whose `reminder_at` has passed and posts
`{ title, body, url }` to each subscription.

**The private key never reaches the browser.** Without these variables nothing
breaks — reminders still fire while the app is open. Push delivery with every tab
closed could not be verified here because it requires your own VAPID keys and a
deployed backend.

---

## 14. Architecture

```
src/
  App.tsx                 shell, routing, session bootstrap, reminder scheduler
  lib/
    api.ts                facade + backend probing
    backend.ts            BackendDriver interface
    backends/
      supabaseBackend.ts  Supabase Auth + Storage + Edge Function
      localBackend.ts     IndexedDB backend + PBKDF2 auth + XP ledger
    content.ts            deterministic grounded content generation
    extract.ts            browser text extraction
    calendar.ts           calendar, recurring occurrences, reminder derivation
    push.ts               service worker, permission and push subscription
    rules.ts              XP, levels, achievements, progress maths
    export.ts             Markdown study-pack builder
    uiState.ts            view state so navigation keeps quiz progress
  game/
    maps.ts               5 map definitions (palette, physics, mechanic)
    characters.ts         playable characters
    constants.ts          physics tuning and the reachability budget
    level.ts              deterministic level builder per (material, map)
    engine.ts             fixed-step simulation, collision, events
    render.ts             canvas renderer, one treatment per map
    GameWorld.tsx         character select → map select → play → completion
  pages/                  Dashboard, Materials, Workspace, Quiz, Notes,
                          Calendar, Timetable, StudyAssistant, Achievements,
                          Settings, AuthScreen
                          (CharacterPage was deleted with the Characters feature)
  components/             Icon, shared UI primitives
supabase/
  migrations/             schema + RLS + triggers + seed
  functions/server/       Edge Function (Hono)
public/
  sw.js, manifest.webmanifest
scripts/smoke-test.ts     behavioural verification harness
```

### Two backends, one contract

`src/lib/api.ts` is the only module the UI talks to; the driver is chosen once at
boot, so every screen behaves identically.

| | Supabase driver | On-device driver |
|---|---|---|
| Accounts | Supabase Auth, persistent session | IndexedDB + PBKDF2-SHA256 (150k iterations, per-account salt), 30-day token |
| Files | Private Storage bucket per user | IndexedDB blob store |
| Data | Postgres with RLS | IndexedDB, ownership checked per request |
| Ownership | Enforced by RLS | Enforced per account in the router |

Both implement the same route table, including calendar, reminders, notification
preferences and map-keyed game progress.

---

## 15. Accessibility

Semantic `button` / `label` / `nav` elements, `aria-label` on icon-only controls,
`aria-current` on the active nav item, `role="progressbar"` with values,
`role="alert"` on errors, labelled form fields, `aria-pressed` on toggles and
selectable cards, visible `:focus-visible` rings, full keyboard operation of the
game (and focus is pulled back into the game area so movement keys never activate a
different button), and `prefers-reduced-motion` support.

---

## 16. Verification performed

| Check | Result |
|---|---|
| `npm run typecheck` | clean, no errors |
| `npm run build` | success — 95 modules, ~435 ms |
| `npm install` | clean install, no peer conflicts |
| `npm run test:logic` — `smoke-test` | **42 / 42 checks passed** |
| `npm run test:logic` — `map-matrix` | **108 / 108 checks passed** |
| `npm run test:logic` — combined | **150 / 150 checks passed** |
| Browser end-to-end (previous pass) | landing → account → dashboard → all pages → material READY (10 challenges, 285 words, 14 flashcards) → flashcard flip → quiz 4/10 with +80 XP → XP 0 → 125 → world → movement, orbs → gate challenge → wrong answer blocked with explanation → correct answer opened the gate (5/10 → 6/10) |

The harnesses assert: content is grounded and deterministic; short input is
rejected; every level is well formed; **no platform intersects or can be used to
clear a gate**; every pit is inside its map's jump envelope; a closed gate
physically stops the player on **all five maps**; touching a gate grants no XP;
answering opens it; orbs, checkpoints and the goal fire exactly once; pits kill
and respawn at the checkpoint; the player cannot leave any world; a moving
platform carries the player; saved progress is restored on load; and a calendar
reminder always moves with its agenda.

`map-matrix` additionally plays each of the five maps from spawn to goal with a
deterministic bot and verifies that the five maps are structurally distinct
rather than recolours.

### Not verified in a browser

Honest status of the items that could not be executed in this environment:

| Item | Status | Why |
|---|---|---|
| File upload through the file picker | **BLOCKED** | The browser automation tool refuses to set a file on a file input. The "Paste text" path was used instead and works end to end. |
| Playing all five maps by hand | **NOT TESTED** | They are verified by the bot play-through and 96 structural checks, which is not a human play-through. All five are confirmed to render and start in a browser. |
| The whole app at 390x844 | **PARTIAL** | The entry screen was measured at 390x844 with no overflow and nothing clipped. The remaining screens at that width are **NOT TESTED**; device emulation was rejected by the tooling, so the earlier measurements came from resizing the window instead. |
| A notification arriving at the scheduled minute | **NOT TESTED** | Needs a tab held open until the minute passes. |
| Live Supabase, Deno typecheck, Web Push with all tabs closed | **BLOCKED** | Require credentials and toolchains not present here. |

A browser run in the previous pass found and drove the fix for a critical bug — the
`games` store used key path `id` while records carried no `id`, so every progress
save failed. Records now carry the true logical key and the IndexedDB writer
validates key paths up front.

A later browser run found a second one, and it was worse: the version 2 upgrade
step looked up the removed `schedules` object store unconditionally. On a brand-new
database `oldVersion` is 0 and that store does not exist, so the lookup threw
`NotFoundError`, the upgrade transaction aborted, and **the database was never
created at all** — which meant a first-time visitor could not get past the entry
screen, in any browser, with an empty profile. The lookup is now guarded by an
explicit version test, a failed open no longer caches its rejection, and a blocked
open reports itself instead of hanging. This is why testing on a fresh profile
matters: the bug was invisible in a profile that already had an older database.

---

## 17. Limitations

- **Scanned PDFs and images** have no text layer. Use **Paste text**; automatic OCR
  is not bundled.
- **A personal account is required for synced progress.** The shared demo entry is
  disabled so visitors cannot overwrite one another's learning data.
- **Supabase requires the configured project, deployed Edge Function, and applied
  migrations.** If it is configured but unavailable, the app does not switch to
  device-only storage; it reports the connection error instead.
- **Without Supabase configuration, the local backend is device-only.** Its IndexedDB
  data does not sync or back up to other devices, and the app labels this mode.
- **Web Push delivery with every tab closed** needs your own VAPID keys and a
  scheduled backend job; the client side and the service worker are complete.
- **Reminders fire while a tab is open** (in-app toast + browser notification).
  Background delivery uses the push transport described above.
- **Typing the browser tab title** is static; the app is an SPA with client-side
  routing and no server-side rendering.
- The Google Fonts import in `src/index.css` means the intended typefaces need
  network access on first load; a system fallback is declared.

---

## 18. Deployment

```bash
npm run build
# dist/ is a static bundle — serve it from any host
```

- Client-side routing needs an SPA fallback (`/* → /index.html`).
- Set `PUBLIC_BASE_PATH` if you deploy under a sub-path.
- Serve over **HTTPS** — service workers, notifications and `crypto.subtle` require
  a secure context.
- Set `ALLOWED_ORIGINS` on the Edge Function to your real origin.
- Ship `public/sw.js` and `public/manifest.webmanifest` as-is (they are copied to
  `dist/` by Vite).

---

# 19. Revision pass — the ten requested changes

Each entry states what changed in the code and how it was verified. The status
labels are the ones used in `FINAL_TEST_REPORT.md`: **PASS**, **FAIL**,
**BLOCKED** (needs a credential, service or toolchain that is not present here),
**NOT TESTED**.

## 19.1 Layout, alignment and responsiveness — PASS (measured in a browser)

- `src/index.css` gained a final layout-hardening section. The root causes it
  addresses are the ones that actually produce drift: grid/flex children
  defaulting to `min-width: auto` (which lets one long word push a column out of
  its track and create a horizontal scrollbar), unbroken strings inside cards,
  and sticky rails positioned with magic numbers.
- Sticky offsets now derive from a single `--topbar-h` custom property, so the
  sidebar, note list, summary nav, settings nav and assistant panel can never sit
  under the top bar.
- `.achievement-grid` became fluid
  (`repeat(auto-fill, minmax(250px, 1fr))`) with stretch alignment, and
  `.achievement-card` became a flex column whose footer uses `margin-top: auto`,
  so cards with different description lengths keep their headings, icons and
  captions on the same lines instead of going ragged.
- The same treatment was applied to the Recent Activity list (dot, copy and
  timestamp share one alignment grid).
- **Verified in a real browser** (the user's Chrome): `documentElement.scrollWidth`
  vs `innerWidth` and an overflowing-element sweep on Home, Achievements and Notes
  at 360×800, 390×844, 768×1024, 1440×900 and 1920×1080. No page-level horizontal
  scroll and no clipped or overlapping cards at any of the five sizes.

## 19.2 Respawn and session reset — PASS (deterministic harness)

- `src/game/level.ts` now generates explicit **death zones** (`level.hazards`),
  one per pit, derived from the ground geometry, so "fall in a pit → respawn at
  the checkpoint" is a defined rule rather than an accident of world height.
- `src/game/engine.ts` adds `DEATH_COOLDOWN` (0.35 s) and `world.deathCooldown`.
  One mistake therefore produces exactly one `died` event and one respawn, even
  if two kill bands are crossed in a single fixed step.
- `resetSession(world, saved)` was added: permanent progress (opened gates,
  collected orbs, reached checkpoints) is restored, while position, velocity,
  camera, timers, particles, the active challenge, the death counter and the
  session SP counter are all reset.
- `createWorld` no longer opens a **completed** map in the `finished` state.
  That was a real bug: a replayed finished map used to load frozen, with the
  player unable to move at all.
- `GameWorld.tsx` resets the session on every map load, tears down the save timer
  and the loop on unmount, and only clears `worldRef` if it still points at the
  world being torn down (clearing it blindly would wipe the next world as it is
  being loaded).
- **Verified** by the `map-matrix` harness on all five maps: a death zone exists
  and lies inside a pit on every map; falling in fires exactly one death and one
  respawn; the respawn lands on the checkpoint with velocity cleared; 240 further
  steps of hazard contact do not multiply deaths; `resetSession` preserves
  permanent progress and clears every temporary field; a reopened finished world
  starts in `playing` and is genuinely movable.

## 19.3 Characters feature removed — PASS (verified in a browser)

- `src/pages/CharacterPage.tsx` was deleted; the `"character"` page key was
  removed from `Page`, the sidebar entry and the route were removed with it, and
  the page-only CSS blocks (`.character-layout`, `.character-stage`, `.stage-bg`,
  `.rings`, `.character-big`, `.turn-controls`, `.character-level`,
  `.customize-panel`, `.custom-tabs`, `.custom-head`, `.item-grid`,
  `.item-preview`, `.custom-footer`, `.xp-wallet`) were removed from
  `src/index.css`.
- Kept deliberately: `src/game/characters.ts`, the shell avatar, and
  `PATCH /character` — the playable character the games require.
- **Verified in a real browser:** the sidebar is exactly Home, Materials, Notes,
  Calendar, Timetable, Study Assistant, Achievements, Settings; there is no
  "Characters" item, and all eight entries navigate without an error. The only
  remaining occurrence of the word is the in-game "Choose Your Character" step,
  which is gameplay, not the removed feature.

## 19.4 Note sharing and real-time collaboration — PARTIAL

What is implemented and enforced:

- Notes carry `shareToken`, `shareMode` (`private` / `view` / `edit`) and a
  monotonic `version`. Tokens are drawn from the CSPRNG (24 random bytes).
- Owner-only routes: `PATCH /notes/:id/share` (link mode, generates or clears the
  token), `DELETE /notes/:id/share` (revoke everything), `DELETE
  /notes/:id/collaborators/:id`, `POST /notes/:id/share` (invite an account).
- A public `GET /shared/:token` resolver that returns 404 `SHARE_REVOKED` once
  sharing is off. Revocation clears the token, so an old link stops resolving
  immediately.
- Access is re-derived on the server for **every** read and write from the stored
  row and the invite list. A client cannot grant itself edit rights.
- Optimistic concurrency: `PATCH /notes/:id` accepts `expectedVersion` and answers
  `409 VERSION_CONFLICT` instead of letting a stale editor overwrite newer text.
- `GET /notes/feed?since=` returns everything the caller may read that changed,
  which the Notes page polls while a note is open; a `BroadcastChannel` message
  makes same-browser changes instant. Saving, saved, syncing, offline and
  conflict states are surfaced in the UI.

What is **not** verified here:

- **Cross-device / cross-account real-time** needs the deployed Supabase driver
  (Postgres + Realtime + RLS). It is implemented (migration
  `20260301000000_activity_sharing_reminders.sql` adds the columns, the
  `note_by_share_token()` SECURITY DEFINER resolver, the policies and the realtime
  publication; the Edge Function adds every route) but **BLOCKED** by the absence
  of credentials, so it has not been executed against a live project.
- **Two independent accounts sharing one note** was therefore **NOT TESTED**.
  What *was* verified in a browser is the single-account flow: the share modal,
  creating a read-only link, the URL appearing, switching back to Private and the
  URL being cleared.
- On the on-device driver the store is per browser profile, so two accounts on the
  same device can collaborate, but a second device cannot. That is a genuine
  limitation of a device-local backend, not a hidden one.

## 19.5 Study streak and SP — PASS (deterministic harness)

- The old behaviour marked a study day simply for loading a page
  (`recomputeProgress` called `markActivity`). That is exactly the "simulated
  activity" this item rules out, so it was removed.
- `recordActivity(userId, kind, subject)` is now called only from validated
  learning activities: a processed material, a stored quiz attempt, an opened
  challenge gate and a finished world. Records live in a new `studyActivity`
  store keyed by `(kind, subject)`, so a retry, a double submit or a replayed
  event cannot add a second row.
- The streak is computed by the pure `computeStudyStreak()`, which counts each
  qualifying calendar date once, continues across consecutive dates, keeps the
  streak alive when the last qualifying date is today or yesterday, and returns 0
  once a whole day has been missed.
- SP remains an append-only ledger (`xp_events`, unique on `(user_id, event_key)`)
  and the total is always its sum; `XP_RULES` is the server-side table the award
  is validated against, so an amount can never be invented by a client.
- Achievements unlocking was moved out of the reward path into its own store, so
  opening the gallery mints no SP (see 19.6).
- **Verified** by 14 harness assertions: several activities in one day count as
  one study day; consecutive days count up; a streak ending yesterday stays
  alive; a missed day resets to 0; the longest streak is tracked separately;
  distinct days are counted once; an empty history has no streak; activity keys
  are unique per kind and subject.

## 19.6 Every achievement unlocked — PASS (verified in a browser)

- `ALL_ACHIEVEMENTS_UNLOCKED` plus `achievementStates()` in `src/lib/rules.ts`
  produce the full catalogue with the genuine unlock timestamp where one exists.
- Achievement status now has its **own** store (`achievements` /
  `user_achievements`), separate from the reward ledger. Opening the gallery
  writes no SP transaction and fabricates no historical activity; the reward path
  still pays out only for badges that were genuinely earned.
- `src/pages/Achievements.tsx` no longer reads a locked state and never renders a
  lock icon, a locked label or an unlock requirement. The Home "Badges" summary
  was brought into line with the same copy and the same set.
- **Verified in a real browser:** 10 cards, 10 × "UNLOCKED", and a
  `/(?<!UN)LOCKED/` sweep of the whole page text returns **0** — before and after
  a hard reload. The Home badges card reports the same 10.

## 19.7 Calendar and Timetable reminders — PARTIAL

Implemented:

- Reminders stay derived from the event (`reminderAt` from start time and lead
  time), so editing an event moves its alarm and deleting it cancels it.
- Calendar and Timetable remain one store (`category === "class"` is the
  timetable view), so they cannot create duplicate reminders.
- Delivery records: a `reminder_deliveries` / `deliveries` store keyed by
  `(user, event, reminderAt, channel)`, and `POST /reminders/:id/delivered`,
  which also sets `reminder_sent_at` — that is what makes a duplicate delivery
  impossible, while a reschedule clears the marker so the alert can fire again.
- `GET /reminders/due?horizonMinutes=` drives both the in-app scheduler and a
  catch-up sweep on open, which reports reminders that came due while no tab was
  open as late rather than dropping them.
- Permission is requested only from an explicit **Enable notifications** action
  after the explanation is on screen — never on load.
- The Calendar page now shows a scheduling status card: how many reminders are
  waiting, when the next one fires, the permission state, and whether background
  delivery is configured. It states plainly when it is not.

Not verified:

- **Background delivery with every tab closed** needs VAPID keys and the
  scheduled `push-cron` function deployed. The client, the service worker, the
  subscription endpoint and the cron function are all implemented, but this is
  **BLOCKED** without credentials, and has not been executed.
- **A notification arriving at the scheduled minute** was **NOT TESTED**
  (it requires holding a tab open until the minute passes).
- The browser verification confirmed the status card renders and reports
  "Permission: not requested yet · background delivery is not configured", which
  is the honest state of this environment.

## 19.8 Export reflects the latest saved data — PASS (code path verified; download not captured)

- `GET /export` assembles the document from a fresh read of the authoritative
  stores, filtered by the caller's own id — nothing is served from a cache or
  from browser storage.
- The document includes profile, preferences, progress, materials with their
  generated content and questions, notes (own and shared with you), calendar
  events, timetable entries, quiz attempts, per-map game progress, study activity,
  SP transactions, achievements and notifications, plus an explicit `excluded`
  list.
- JSON and CSV are both produced client-side from that response.
  `buildExportCsv` quotes every field and doubles embedded quotes, so commas,
  quotes and newlines survive a spreadsheet round-trip; the header is the union
  of every row's keys and each row carries its `record_type`, which keeps a
  heterogeneous record set valid in one file.
- The Settings button only reports success after a successful response, and the
  file name carries the date. Passwords, session tokens and API keys are not
  representable — they are not stored in those tables.
- **Verified:** the response shape and the CSV/JSON builders are exercised by the
  code path; the browser pass exercised Settings rendering. **NOT TESTED:** the
  actual downloaded file was not opened and compared against the database, and
  CSV escaping was not round-tripped through a spreadsheet.

## 19.9 AI Study Assistant — PASS for honest failure; BLOCKED for real answers

- New page (`src/pages/StudyAssistant.tsx`) with a message log, a loading
  indicator, per-turn material grounding, material selector, new-conversation
  control, retry on recoverable failure, and responsive layout.
- `POST /assistant` is implemented server-side (Edge Function) with retrieval
  over the caller's own material paragraphs, a system prompt that answers in
  Indonesian and refuses to answer from outside the supplied passages, and
  explicit `missing_key` / `rate_limited` / `timeout` / `unreachable` statuses.
  The provider key stays in `LLM_API_KEY` on the server; `VITE_ASSISTANT_URL`
  only names the endpoint, so no secret can reach the browser.
- The on-device driver proxies to that endpoint when one is configured, and
  otherwise returns an explicit `missing_key` status **instead of inventing an
  answer**. That behaviour is what makes this item honest.
- **Verified in a real browser:** the assistant renders, a question was sent, and
  the response was the error panel naming exactly what is missing
  (`LLM_API_KEY`, `LLM_MODEL`, `VITE_ASSISTANT_URL`) — no canned or mocked answer
  was produced.
- **BLOCKED:** no provider key and no deployed backend exist in this environment,
  so a real model request has never been made. This item is **not operational**
  here and is not claimed to be.

## 19.10 Ghosting / trailing images — root cause found and fixed, PASS (deterministic harness)

**Root cause.** It was not CSS opacity and not a motion-trail effect. The canvas
is drawn through a scaled transform (`dpr × cssHeight / LEVEL_HEIGHT`), so the
region a frame is responsible for is `cssWidth / scale` wide by `LEVEL_HEIGHT`
tall — **not** `cssWidth × cssHeight`. `GameWorld.resize()` reported the wrong
rectangle, and `renderWorld()` then cleared and repainted only that rectangle.

Because the stage is `clamp(300px, 48vh, 470px)` tall and `LEVEL_HEIGHT` is 736,
`scale` is always below 1, so the bottom (and right) of the backing store was
**never cleared and never repainted**. The character, the ground and the gates —
which are drawn in that band — accumulated frame after frame, which is exactly
the faint, translucent, duplicated trail that was reported. The defect lives in
the shared renderer, so it affected every map; Obstacle Adventure was used as the
reference for the intended, clean result.

**Fix.**

- `canvasMetrics(cssWidth, cssHeight, dpr)` in `src/game/render.ts` is now the
  single source of truth for pixel size, transform scale and viewport, and
  `GameWorld.resize()` uses it.
- `renderWorld()` resets alpha and composite state, resets the transform, clears
  the **entire backing store in device pixels**, then restores the world
  transform before drawing. It performs that full clear on every frame.
- `drawHazardHint` now reads `level.hazards`, so the warning stripe cannot
  disagree with the geometry that kills the player.
- The animation loop is owned by a single token (`loopOwnerRef`): a superseded
  loop stops scheduling immediately, so two loops can never draw the same world.

**Verification.** A recording `CanvasRenderingContext2D` stub that honours
`setTransform` converts every drawing call to device pixels, and the harness
asserts, for all five maps × 5 viewport sizes × dpr 1 and 2:

- every frame clears the entire canvas;
- every frame repaints the entire visible area;
- the reported viewport matches the drawing transform (`height === LEVEL_HEIGHT`);
- the **pre-fix** viewport would have left part of the canvas uncleared (a
  falsification check, proving the test discriminates);
- the previous frame's character pixels are inside the region the next frame
  erases, so nothing from the previous frame can survive.

A browser still frame showed a single character sprite with no trailing
duplicate. A **moving** in-browser frame could not be captured, because the
canvas unmounts whenever a gate challenge opens or the run ends, so the
motion case is **NOT TESTED in the browser** (it is covered by the harness).

---

# 20. Verification summary for this revision

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, no errors |
| `npm run build` | success — 96 modules, ~370 ms |
| `npm run test:logic` — `smoke-test` | **53 / 53** |
| `npm run test:logic` — `map-matrix` | **215 / 215** |
| Combined | **268 / 268** |
| Browser end-to-end (user's Chrome) | sidebar/navigation, no Characters, no LOCKED, assistant honest failure, share modal + link + revoke, reminder status card, game canvas + HUD, clean console |
| Viewports measured | 360×800, 390×844, 768×1024, 1440×900, 1920×1080 — no page-level horizontal scroll |
| Live Supabase / RLS / Realtime | **BLOCKED** — no credentials |
| Web Push with every tab closed | **BLOCKED** — no VAPID keys, no deployed cron |
| Real model request to a provider | **BLOCKED** — no `LLM_API_KEY` |
| Deno typecheck of the Edge Functions | **BLOCKED** — no Deno toolchain; static review only |
| Notification firing at the scheduled minute | **NOT TESTED** |
| Two accounts sharing one note over the network | **NOT TESTED** — needs the deployed backend |

## Environment variables still required

```bash
# Frontend (.env) — required for the cloud backend, optional otherwise
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Frontend (.env) — optional, enables each deployment-only feature
VITE_ASSISTANT_URL=          # AI Study Assistant endpoint
VITE_VAPID_PUBLIC_KEY=       # Web Push subscription

# Server (supabase secrets set ...) — never in the browser
LLM_API_KEY=
LLM_MODEL=
LLM_BASE_URL=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
ALLOWED_ORIGINS=
```

## Account identity for demos

The old name-only demo entry is retired. Visitors sign up or sign in with their own
account so progress is associated with a stable Supabase user and can be loaded on a
different device. The display name is profile data; it is not used as the account key.

---

# 21. Login restoration, layout pass and push arming

## 21.1 The login page was reconstructed, not invented

No git history, no backup and no older copy of the project were available, so the
original login could not be diffed against anything. It was reconstructed from the
strongest evidence in the repository: **CSS for the original form was still present
while the markup had stopped using it.**

Orphaned in src/index.css before this pass:

| Rule | What it proves the original had |
|---|---|
| .auth-tabs, .auth-tabs button, .auth-tabs button.active | a tabbed form, lex:1 tabs, active tab on --surface with a soft shadow |
| .password-row (+ .password-row label{flex:1} in the 760px query) | a password field, and a two-column field row |
| .auth-links, .auth-links button | two secondary link buttons, justify-content: space-between |
| .auth-backend-note | a backend status line (deliberately **not** restored — see below) |
| .form-grid{grid-template-columns:1fr 1fr} | email and password side by side |

The tab styling was reinstated **exactly as written** rather than re-styled, because
the surviving rule already described .auth-tabs with lex:1 children, and the
markup now matches it. .auth-backend-note was **not** restored: the project history
records that technical backend status messages were deliberately removed from the
login, and that preference stands. The account tabs carry one short, non-technical
line instead.

## 21.2 Two real bugs fixed

**The displayed name could differ from the name typed.** ensureDemoAccount compared
only the ACCOUNT row before rewriting:

`	s
if (renamed.name !== existing.name || renamed.email !== existing.email) { /* write both */ }
`

If the account already carried the typed name while the PROFILE row held an older one
— which happens the moment anyone edits their display name in Settings — the guard
short-circuited and nothing was written, so login accepted one name and every screen
showed another. Both rows are now written unconditionally, and the profile row is
created if it was missing.

**The mascot sat on top of the story copy.** .auth-mascot was absolutely positioned
at ight:14%; bottom:13% with 	ransform: scale(2.2), which put the llama across the
story paragraph at every desktop width (the panel only becomes one column at ≤900px,
where the story is hidden). The scale is now 1.55 anchored bottom-right and the
paragraph is given a right gutter. Measured paragraph and mascot rectangles do not
intersect at 1024, 1366 or 1920 px.

## 21.3 The canvas had a transparent seam at fractional device pixel ratios

A separate finding, from measuring the canvas alpha channel rather than trusting the
earlier fix: at devicePixelRatio 1.25 — the ratio this machine actually reports —
the last backing-store column (x = width - 1) was fully transparent on all five maps.
The full clear erased it, but the sky pass never repainted it, because
Math.round(cssWidth * dpr) had made the canvas a fraction wider than the transform
was sized for. canvasMetrics now derives the transform from the **rounded**
backing-store height, which makes iewport.width * transformScale === pixelWidth and
LEVEL_HEIGHT * transformScale === pixelHeight exact at any ratio. This is distinct
from the ghosting defect: transparent pixels are not stale pixels, and no trail was
ever visible here.

The harness now runs at device pixel ratios 1, 1.25, 1.5 and 2, and its coverage
tolerance is 0.05 of a device pixel — a whole-pixel shortfall is the bug being
guarded against, so rounding it away would hide it.

## 21.4 Web Push could not subscribe at all

subscribeToPush was implemented but **nothing ever called it**: only
egisterServiceWorker and showReminder had callers, and /push/public-key and
/push/subscribe were never invoked. A subscription could not be created, so
background delivery was impossible regardless of configuration.

push.ts now exports rmPushForDevice, which runs the whole chain — permission,
service worker, subscription, server record — and reports *which* of the four steps
succeeded. Permission, the device subscription and backend configuration are shown as
three separate facts on the Calendar status card, and both the Calendar and Settings
buttons use it.

## 21.5 Service worker staleness

CACHE was llamastu-shell-v1 and never changed. A service worker only re-installs
when its own file changes byte-for-byte, so an unchanged cache name keeps serving the
previous build's assets after a deploy — which is a plausible way for a browser to
show an older screen than the source it is running. The cache name is bumped to
llamastu-shell-v2 and the reason is documented at the declaration.

---

# AI Study Assistant — setup (how to turn it on)

The assistant always answers through a real model. There is no canned reply: if the provider is not configured, the page says exactly what is missing.

**How a question travels**

| Where you are | Route used | Materials come from |
| --- | --- | --- |
| Signed in to the cloud account | `POST /assistant` (needs login) | read on the server from your own materials |
| On-device workspace / demo | `POST /assistant/public` (no login; CORS allow-list, input caps, 20 requests/min per IP) | retrieved in the browser and sent as passages |

Both routes return the same shape (`{ status: "ready", answer, reference }`, or `{ status, detail, missing? }` on failure), and `src/lib/assistantReply.ts` turns it into what the interface shows.

**Turn it on**

1. Get an API key from your model provider. The default configuration is for xAI Grok.
2. Set the secrets on the Edge Function (never in `.env`, never in a `VITE_` variable):
   `supabase secrets set LLM_API_KEY=your-provider-key LLM_MODEL=grok-4.7 LLM_BASE_URL=https://api.x.ai/v1`
   For another OpenAI-compatible provider, set `LLM_BASE_URL` and `LLM_MODEL` to that provider's documented values.
3. Deploy: `supabase functions deploy server --no-verify-jwt`
4. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env` and rebuild. `VITE_ASSISTANT_URL` is only needed to point somewhere else.
5. Check `GET <functions-url>/health` — it must report `"ai": true`.

Without a material selected, answers are general. With one selected, the model is told to answer only from that document's most relevant passages.

**Quickest way (no cloud needed): `npm run dev`**

Open `.env`, paste your key after `LLM_API_KEY=` and restart `npm run dev`. The dev/preview server answers `POST /api/assistant` itself and calls the configured provider from Node, so the key never reaches the browser. Do NOT use a `VITE_` name for the key: Vite publishes every `VITE_*` variable inside the JavaScript bundle. A production deployment still needs the Edge Function above.
