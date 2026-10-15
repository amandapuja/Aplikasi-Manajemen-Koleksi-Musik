# FINAL TEST REPORT — login restoration, layout pass, and the six functional tasks

Every status below is what was actually observed. **PASS** means the feature was
exercised end to end. **FAIL** means it ran and did not meet expectations.
**BLOCKED** means a missing credential, service, toolchain or device capability
stopped the test from running. **NOT TESTED** means no sufficient verification was
performed. Nothing is promoted to PASS on the grounds that the code looks correct.

This report supersedes the earlier one for the items it covers.

---

## 0. Environment and configuration status

| Item | Value |
|---|---|
| OS | Windows (win32 x64), screen 1536×960, `devicePixelRatio` **1.25** |
| Node / npm | v22.23.2 / 10.9.8 |
| Bundler | Vite 8.3.1 (rolldown) |
| Browser used for UI tests | **Google Chrome 155.0.8059.39** (the user's Chrome; the built-in browser is disabled in Accio Work → Settings → Browser, so the built-in transport was unavailable) |
| App backend under test | **On-device** (IndexedDB). No `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, so `initBackend` selects the local driver |
| `VITE_VAPID_PUBLIC_KEY` | **Set** (generated for this test; public half only) |
| `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | **Not set, and no local model server exists** (checked: ports 11434/1234/8080/5000/8000/8081/3000/4000/7860 all closed; `ollama` not installed) |
| Supabase project | **None** |
| Deno toolchain | **None** |

---

## 1. Login page restored — **PASS**

**How the original was recovered.** There is no git history, no backup and no older
copy of the project anywhere in the workspace, so no diff against the original was
possible. Two facts in the repository made a faithful reconstruction possible:
the project diary records that on 2026-10-01 the login was *deliberately* refactored
to name-only ("Replaced complex authentication flow with a simplified 'Demo Mode' …
removed password fields, OAuth"), and **the CSS for the original form was still
present while the markup had stopped using it** — `.auth-tabs`, `.auth-tabs
button.active`, `.password-row`, `.auth-links`, `.form-grid{1fr 1fr}`.

**Procedure.** Opened the app with a cleared session, clicked through the landing
page, and inspected the login at 1366×768, 1024×768, 1920×1080 and 390×844.

**Expected.** Two panels; a tabbed form; Masuk default; email+password on Masuk;
name+email+password on Daftar; the name-only demo path on its own tab; the typed name
preserved after login; no overlap; usable on mobile.

**Actual — all observed, none inferred:**

| Check | Result |
|---|---|
| Two-panel layout, story panel left (logo, kicker, headline, paragraph, mascot), form panel right | PASS |
| Tabs present, labels exactly **Masuk / Daftar / Demo**, `Masuk` active by default | PASS |
| Masuk fields `Email` + `Password` side by side; button **Masuk** | PASS |
| Daftar fields `Nama tampilan` + `Email` + `Password`; button **Buat akun** | PASS |
| Demo: single `Nama / Email` field; button **Masuk Demo** | PASS |
| Link buttons: `Belum punya akun? Daftar` / `Coba tanpa akun (demo)` (and their Daftar/Demo equivalents) | PASS |
| Mascot vs paragraph rects intersect | **false** at 1024, 1366 and 1920 |
| 390×844: story hidden, form usable, `scrollWidth` 390 = `innerWidth` 390 | PASS |
| Real sign-up then sign-in with email + password | PASS |
| Console errors during the whole login flow | **0** |

**Name consistency (an explicit requirement) — PASS.** Three scenarios:
typed `Kirana Dewi` → greeting *"Welcome, Kirana Dewi"* and sidebar *"Kirana Dewi"*;
signed out, typed `Bagas Prasetyo` → both read *"Bagas Prasetyo"*; created a real
account with display name `Sari Utami` → greeting and sidebar *"Sari Utami"*, then
signed out and back in with that email and password → *"Sari Utami"*.

**Root cause of the old mismatch.** `ensureDemoAccount` compared only the *account* row
before rewriting, so a profile row holding an older display name was silently kept.
Both rows are now written unconditionally.

**Evidence.** `shots/before/login-*.png` (before) and `shots/after/login-*.png` (after).

**Not verified.** The reconstruction is judged against the surviving CSS, the project
diary and the request's description — **not** against the original source, which does
not exist here. Specifically not verifiable: the original heading copy, the exact
original spacing values, and whether the original had a backend status line (it is
deliberately not restored).

---

## 2. Dashboard layout — **PASS**

**Procedure.** Measured `documentElement.scrollWidth` vs `innerWidth`, counted
elements whose right edge exceeds the viewport, and measured the two named cards at
390×844, 768×1024, 1366×768 and 1920×1080.

**Actual:**

| Viewport | scrollWidth | innerWidth | overflowing elements |
|---|---|---|---|
| 390×844 | 375 | 390 | 0 |
| 768×1024 | 753 | 768 | 0 |
| 1366×768 | 1351 | 1366 | 0 |
| 1920×1080 | 1905 | 1920 | 0 |

(`scrollWidth = innerWidth − 15` is the scrollbar, so there is no horizontal page
scroll at any size.)

| Card | 1366×768 | 1920×1080 | Clipped children |
|---|---|---|---|
| Recent Activity `.activity-card` | 312 × 404 | 420 × 116 | none (`scrollWidth === clientWidth`) |
| Badges Earned `.achievement-strip` | 312 × 246 | 420 × 204 | none |

**The two defects that were visible in the screen recording of the current UI:**

- The **left column stretched.** `.real-dashboard-grid` had no `align-items`, so it
  defaulted to `stretch` and the "Continue learning" card grew to the height of the
  entire right column, leaving a large empty area. Measured after the fix:
  `.home-feature` height **297.3** vs `.dashboard-side` height **1058.6** — the card is
  content-sized and no longer padded out.
- The **summary tiles were a horizontally scrolling flex strip** at intermediate
  widths. `.stats-grid` is now a true grid (4-up, then 2-up).

Also fixed: the Recent Activity rows now use a three-column grid (bullet, copy,
timestamp) so timestamps form one aligned column instead of drifting per row; badge
chips are a uniform height and ellipsise instead of overflowing; and the heading text
`BADGES EARNED` was restored (**10** chips render).

**Evidence.** `shots/before/dashboard-*.png` vs `shots/after/dashboard-*.png`.

---

## 3. AI Study Assistant with real answers — **BLOCKED**

**Procedure.** Searched for any usable provider: environment variables
(`LLM_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `LLM_BASE_URL`,
`LLM_MODEL`, `VITE_ASSISTANT_URL`, `VITE_SUPABASE_URL`), any `.env` file, any local
model server on 9 common ports, and the `ollama` binary.

**Expected.** A real model-generated answer, grounded in an uploaded material.

**Actual.** All absent. The assistant page renders, accepts a question, and returns an
**honest error panel** naming exactly what is missing (`LLM_API_KEY`, `LLM_MODEL`,
`VITE_ASSISTANT_URL`) — no canned or placeholder answer is produced. That behaviour is
by design and was verified in the browser.

**Status: BLOCKED.** No genuine model-generated answer has ever been received, and this
report does not claim otherwise. The four required scenarios (factual question,
concept explanation, follow-up, empty input / failed request) were **NOT TESTED**;
only the empty-input and configuration-failure paths are covered by the existing
behaviour.

**Exact steps to resolve:**

```bash
supabase secrets set LLM_API_KEY="…" LLM_MODEL="…" LLM_BASE_URL="…"
supabase functions deploy server
# then in .env:
VITE_ASSISTANT_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/server/assistant
```

Until a real request succeeds, the assistant must be treated as non-operational.

---

## 4. Web Push notifications — **BLOCKED**

**First, a real defect was found and fixed.** `subscribeToPush` was implemented but
**never called** — only `registerServiceWorker` and `showReminder` had callers, and the
`/push/public-key` and `/push/subscribe` routes were never invoked. No push
subscription could be created, so background delivery was impossible regardless of
configuration. `push.ts` now exports `armPushForDevice`, which runs permission →
service worker → subscription → server record and reports which step succeeded; the
Calendar status card reports permission, device subscription and backend configuration
as three separate facts.

**Procedure.** Generated a VAPID pair, set `VITE_VAPID_PUBLIC_KEY`, cleared the service
worker and caches, opened Calendar, and clicked **Enable notifications**.

**Expected.** Permission granted → push subscription created → stored via
`/push/subscribe` → a real push sent to the FCM endpoint → notification displayed.

**Actual.**

| Step | Result |
|---|---|
| Status card before | *"2 reminders scheduled · Next: Struktur Data at 08:30 · **Permission: not requested yet** · **this device is not subscribed to push** · **background delivery is configured (0 device subscriptions on this account)**"* |
| VAPID key reaches the client | PASS — the card reports "background delivery is configured" |
| Clicking Enable notifications | the button entered "Enabling…" and **never resolved** |
| `Notification.permission` afterwards | **`default`** (unchanged) |
| `pushManager.getSubscription()` | **`null`** |
| Subscription created / stored on the server | **NOT TESTED** — no subscription existed |
| Real push sent via `web-push send-notification` | **NOT TESTED** — no endpoint to send to |
| Delivery while backgrounded or closed | **NOT TESTED** |

**Exact blocker.** Chrome shows the notification permission prompt as a **native,
OS-level window** (`"http://127.0.0.1:5173 ingin"`), not as DOM. The browser automation
can click elements inside the page but cannot answer that window, and the fallback
attempt using OS-level mouse injection misfired (it focused a File Explorer window) —
after which Chrome denied the debugger permission and all browser tooling detached. A
second attempt to work around it by launching Chrome with an isolated profile whose
`Preferences` pre-grant notifications for the origin also failed: the isolated instance
never exposed its CDP port, and the environment additionally blocks the process spawns
Vite's dev server needs (`spawn EPERM`).

**Exact steps to resolve:** open `http://127.0.0.1:5173` in a normal Chrome window, click
**Allow** on the notification prompt that appears after pressing *Enable notifications*,
then confirm the status card reads "this device has a push subscription", then send:

```powershell
npx --yes web-push@3.6.7 send-notification `
  --endpoint="<subscription.endpoint>" --key="<p256dh>" --auth="<auth>" `
  --payload='{"title":"Llamastu reminder test","body":"test"}' `
  --vapid-subject="mailto:test@example.com" --vapid-pubkey="<VAPID_PUBLIC_KEY>" `
  --vapid-private-key="<VAPID_PRIVATE_KEY>"
```

and verify with `(await (await navigator.serviceWorker.getRegistration()).getNotifications())`.

**Also still required for true background delivery:** a deployed backend scheduler. The
client, service worker, subscription endpoint and the `push-cron` function are all
implemented, but none of it has ever been executed. No claim is made that
notifications work on every device or browser.

---

## 5. Notes sharing across accounts — **PASS for access, persistence and authorization; live push NOT verified**

**Procedure.** Two real accounts created through the UI, A = `Anisa Puspa`
(`anisa.puspa.1012@example.com`), B = `Bima Saputra` (`bima.saputra.1012@example.com`).

**Actual:**

| Step | Result |
|---|---|
| A creates note "Shared with B", body `alpha text from A` | PASS, indicator settled to **"Saved"** (Revision 2) with a persistent **"Live"** badge |
| Share modal contents | PASS — link-access selector (Private / read / edit), invite row (email + Editor/Viewer + Add), **People with access** list, **Revoke all access** |
| Link sharing on | PASS — read-only URL `http://127.0.0.1:5173/#/shared/c4897d8a…` appears, status "This note is shared right now." |
| Link sharing back to Private | PASS — **URL input removed, Copy gone, status private** (token cleared) |
| A invites B as Editor | PASS — People list shows Owner + `bima… · Editor` |
| B signs in, opens Notes | PASS — B's list is exactly one note, **"Shared with B"** |
| B edits to `beta text from B (edited)`, waits | PASS — indicator **"Saved"** at every 1-second sample for 9 s; Revision 2 → **3** |
| A signs back in and opens the note | PASS — A sees **`beta text from B (edited)`**, Revision 3 |
| A revokes all access; B signs in | PASS — B's Notes list is **empty**; the note is gone |
| B sees any of A's unshared notes | PASS — B sees 0 notes; none of A's other data is visible |
| Persistence across sign-out / sign-in | PASS |

**Not verified — live realtime delivery.** A observed B's edit only after signing out
and back in. A concurrent two-session test is **impossible on the on-device backend**,
because its session token is device-wide: two accounts cannot be signed in at the same
time on one machine. The code contains a `BroadcastChannel("llamastu-notes")` and a
poll of `/notes/feed` while a note is open, but **no live update was ever observed
delivering**. This is reported as unverified rather than as working realtime.

**Cross-device sharing is BLOCKED** by the absence of a deployed Supabase project. The
migration and the Edge Function routes exist but have never been executed, and on the
on-device driver the datastore is per browser profile, so a second device genuinely
cannot participate.

---

## 6. JSON and CSV export — **PASS**

**Procedure.** Hooked `URL.createObjectURL` in the page, clicked the Settings **JSON**
and **CSV** buttons, saved the captured blobs byte-for-byte to disk, then validated the
files on disk with an independent Node script
(`exports/validate-export.mjs`, **51 assertions**).

**Actual:**

| Check | Result |
|---|---|
| Mechanism | `URL.createObjectURL(Blob)` + `<a download>` (not a data: URL) |
| Filenames | `llamastu-export-export.test_example.com-2026-10-12.json` / `.csv` — correct name and extension |
| JSON size / `JSON.parse` | 59,432 chars / **did not throw** |
| Top-level keys | `format, version, generatedAt, generatedFor, profile, preferences, progress, materials, notes, calendarEvents, timetable, quizAttempts, gameProgress, studyActivity, xpTransactions, achievements, notifications, excluded` |
| Section contents | materials 2, notes 1, calendarEvents 2, timetable 1, quizAttempts 1, gameProgress 5, studyActivity 7, xpTransactions 55, achievements 10, notifications 5 |
| `generatedAt` | `2026-10-12T14:16:33.711Z` — generated at export time, not a fixture |
| CSV parses with an RFC 4180 parser | PASS — 92 rows |
| Header | contains `record_type` as the first column; 71 columns; CRLF row endings; every field quoted |
| Rows per type | profile 1, progress 1, material 2, note 1, calendar_event 2, timetable 1, quiz_attempt 1, game_progress 5, study_activity 7, sp_transaction 55, achievement 10, notification 5 |
| Every data row matches the header width | PASS |
| Round-trip of a value containing a comma | PASS |
| Round-trip of a value containing a `"` (doubled) | PASS |
| Round-trip of a value containing a newline | PASS |
| Non-English / non-ASCII text preserved | PASS (JSON and CSV) |
| No `passwordHash` / `salt` / `accessToken` / `service_role` / `apiKey` anywhere | PASS (8 separate assertions) |
| Achievements exported as unlocked, none with a locked flag | PASS (10 rows) |
| `excluded` list present and honest | PASS — 3 items naming credentials and files |
| Console errors during export | 0 |

**Remaining.** Empty-dataset and very-large-dataset behaviour were **NOT TESTED** (the
account is seeded, and the on-device driver has no pagination to exercise). The export
reads the caller's rows on the server at request time and applies authorization per
section; a live-database diff on a deployed backend is **BLOCKED**.

**Evidence.** `exports/export.json`, `exports/export.csv`, `exports/validate-export.mjs`.

---

## 7. Character movement on every game map — **PASS**

**The test that discriminates.** The canvas alpha channel: any pixel the renderer never
painted stays fully transparent. Because the sky pass must cover the whole canvas every
frame, `transparentPixels === 0` is a necessary condition for "nothing from a previous
frame survives".

**First run (before the fractional-DPR fix)** found a real defect at the machine's
native `devicePixelRatio` of **1.25**: non-zero transparent pixels on **every** map,
located exclusively in the last backing-store column `x = width − 1`:

| Map | transparent px (of 675,280) |
|---|---|
| Obstacle Adventure | 323 |
| Cooking Kitchen | 460 |
| Mystery Lab | 335 |
| Treasure Island | 288–291 |
| Space Station | 68 |

At `dpr 2.0` it was 0, which is why the defect was ratio-dependent. Cause:
`Math.round(cssWidth * dpr)` made the backing store a fraction wider than the transform
was sized for, so the full clear erased the last column and the sky pass never repainted
it. `canvasMetrics` now derives the transform from the **rounded** height, making the
coverage exact at any ratio. This is a transparent seam, not a ghost — no trail was ever
visible, and the mid-movement screenshots confirmed a single crisp sprite.

**Second run (after the fix), canvas 1468×460, `devicePixelRatio` 1.25, totalPixels 675,280:**

| Map | still | moving (Right) | moving-left | direction-change | reentry |
|---|---|---|---|---|---|
| Obstacle Adventure | **0** | **0** | **0** | **0** | **0** |
| Cooking Kitchen | **0** | **0** | **0** | **0** | **0** |
| Mystery Lab | **0** | **0** | **0** | **0** | **0** |
| Treasure Island | **0** | **0** | **0** | **0** | **0** |
| Space Station | **0** | **0** | **0** | **0** | **0** |

Movement was proven, not assumed, in each case — world scrolling was measured as a
frame diff (e.g. Space Station 675,280 / 675,280 pixels changed; Treasure Island
309,118 / 675,280) and counters moved (`COLLECTED 2/20 → 3/20`, `SESSION XP +5`).

**Also observed:** single crisp sprite with **no trailing translucent duplicate** on
every map; console errors only Vite dev-HMR noise (`[vite] failed to connect to
websocket`); **0 failed network requests** of 70.

**Harness coverage (deterministic, no browser needed).** `scripts/map-matrix.ts`
section 8 renders every map against a recording 2D context that honours `setTransform`
and converts every draw to device pixels, at 5 viewport sizes × device pixel ratios
**1, 1.25, 1.5 and 2**, asserting: every frame clears the whole canvas; every frame
repaints the whole visible area; the drawn viewport reaches the backing-store edge; the
reported viewport matches the transform; the previous frame's character pixels lie
inside the region the next frame erases; and — as a falsification check — that the
**pre-fix** viewport would have left part of the canvas uncleared, proving the test
discriminates. Tolerance is 0.05 of a device pixel, because a whole-pixel shortfall is
exactly the defect being guarded against.

**NOT TESTED in the browser:** the mid-run canvas for **Obstacle Adventure** — that map
is 100 % explored on the test account and auto-completes in 2–3 seconds, so the capture
shows the "MAP COMPLETED" screen. Its alpha measurement with the key held was still
recorded (0). Delivery while the tab is backgrounded was not part of this test.

**Evidence.** `shots/after/canvas-Space-Station-fixed.png`, `canvas-Obstacle-Adventure-fixed.png`.

---

## 8. Build and regression — **PASS**

Run from a **clean extract of the deliverable ZIP**, installing from the preserved
lockfile:

```
Expand-Archive llamastu-restored-login.zip -> zip-verify2/
npm ci --no-audit --no-fund     -> added 55 packages in 9s, exit 0
npx tsc --noEmit                -> clean, exit 0
npm run test:logic              -> 53/53 checks passed
                                  220/220 checks passed     (273/273)
npm run build                   -> ✓ built in 489 ms, exit 0
```

`npm ci` uses the lockfile, so the install is reproducible. The harness grew from 215 to
220 assertions with the fractional-DPR coverage checks.

**Regression checks in the browser:** sign-up, sign-in, sign-out, demo entry, dashboard,
Materials, Notes (create / share / revoke / edit), Calendar, Settings, export and the
five game worlds all exercised after the changes; **0 console errors** and **0 failed
requests** outside Vite's dev-HMR websocket noise.

**Environment note (not a code defect):** launching `npm run dev` from this session's
sandbox failed with `spawn EPERM` — the environment blocks a process spawn that Vite's
config loader performs on Windows. The dev server started normally when launched by the
browser sub-agent, and the **production build is unaffected**. In the previous pass the
same `spawn EPERM` appeared and succeeded on retry.

---

## 9. Files and components changed

| File | Change |
|---|---|
| `src/pages/AuthScreen.tsx` | Rebuilt with the three-tab form (Masuk / Daftar / Demo), the two-column field row, the link buttons, and per-tab validation and messaging |
| `src/lib/backends/localBackend.ts` | `ensureDemoAccount` writes both the account and the profile row on every demo entry, creating the profile when missing — fixes the typed-name/displayed-name divergence |
| `src/pages/Dashboard.tsx` | Restored the `BADGES EARNED` heading; wrapped chip text in a `<span>` so a long badge name can ellipsise |
| `src/lib/push.ts` | New `armPushForDevice` (permission → service worker → subscription → server record, reporting which step succeeded) and `disarmPushForDevice` |
| `src/lib/push.ts` | `subscribeToPush` now has a caller; previously nothing invoked it, so no subscription could ever exist |
| `src/pages/CalendarPage.tsx` | Enable button runs the full arming flow; status card reports permission, device subscription and backend configuration separately; loads real push state |
| `src/pages/SettingsPage.tsx` | Reminders row runs the same arming flow and reflects the real subscription state |
| `src/game/render.ts` | `canvasMetrics` derives the transform from the rounded backing-store height, making full-canvas coverage exact at any device pixel ratio |
| `scripts/map-matrix.ts` | Section 8 now runs at device pixel ratios 1, 1.25, 1.5, 2 with a 0.05-pixel coverage tolerance; added an explicit edge-coverage assertion |
| `public/sw.js` | Cache name bumped to `llamastu-shell-v2` with the reason documented |
| `src/index.css` | Login overlap fix; `.real-dashboard-grid{align-items:start}`; `.stats-grid` back to a true grid; activity rows as a three-column grid; badge chips uniform and ellipsised |
| `README.md` | Entry-screen section rewritten for the tabbed login; new section 21 documenting this pass and its evidence |

**No schema or environment change** was required for these fixes. The only new
configuration is `VITE_VAPID_PUBLIC_KEY` (public half, not a secret), set for testing.

---

## 10. Configuration still required

| Variable | Where | Needed for |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `.env` | Cloud backend, cross-device notes, server-side scheduling |
| `VITE_ASSISTANT_URL` | `.env` | Naming the AI endpoint (not a secret) |
| `VITE_VAPID_PUBLIC_KEY` | `.env` | Push subscription — **now set locally** |
| `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | server secrets | AI Study Assistant answers |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | server secrets | Background reminder delivery |
| `ALLOWED_ORIGINS` | server secret | CORS in production |

The VAPID private key generated for this test is kept **outside the project** at
`push-test/vapid-private-key.txt` and is excluded from the ZIP along with `.env`.

---

## 11. Status summary

| # | Item | Status |
|---|---|---|
| 1 | Original login page restored | **PASS** — reconstructed from surviving CSS; masthead/overlap/name consistency verified. Exact fidelity **not verifiable** (no original source) |
| 2 | Misaligned layouts fixed | **PASS** — 0 overflow at 4 viewports; the stretching column and the scrolling tile strip fixed; cards fit their content |
| 3 | AI Study Assistant with real answers | **BLOCKED** — no provider key and no local model; honest failure path verified, no answer ever received |
| 4 | Web Push notifications | **BLOCKED** — the native permission prompt cannot be answered by this automation; subscription, persistence and delivery **NOT TESTED**. The missing-subscription **code defect was fixed** |
| 5 | Notes sharing across accounts | **PASS** for cross-account access, persistence, authorization and revocation; **live push NOT verified** (device-wide session); **cross-device BLOCKED** (no Supabase) |
| 6 | JSON and CSV export | **PASS** — 51 assertions on the downloaded files with a real parser |
| 7 | Character movement on every map | **PASS** — 0 transparent pixels on all 5 maps at DPR 1.25 after fixing a real fractional-DPR defect; movement proven |
| 8 | Clean build and regression | **PASS** — `npm ci`, typecheck, 273/273 tests, production build from the ZIP |

**Not claimed: "all tests passed".** Items 3 and 4 are blocked and are not reported as
working. Nothing in this report is based on code inspection alone where an end-to-end
test was required.
