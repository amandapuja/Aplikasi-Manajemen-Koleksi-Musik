/**
 * Llamastu — reminder push dispatcher (Supabase Edge Function).
 *
 * A scheduled job invokes this function with a shared secret, and it:
 *   1. finds due reminders across ALL users with the service client,
 *   2. sends a Web Push message to each stored browser subscription using the
 *      server-only VAPID keys,
 *   3. records a reminder_deliveries row (delivered / failed) and stamps
 *      `reminder_sent_at` on the event so a duplicate delivery is impossible,
 *   4. deletes subscriptions the push service reports as gone (HTTP 404/410).
 *
 * The VAPID PRIVATE key is read from the function environment and is never
 * returned in a response, written to the database, or logged.
 *
 * ---------------------------------------------------------------------------
 * DEPLOY
 * ---------------------------------------------------------------------------
 *   # 1. Store the secrets (server-side only — never in the client bundle):
 *   supabase secrets set \
 *     VAPID_PUBLIC_KEY=BEl62i...  \
 *     VAPID_PRIVATE_KEY=...        \
 *     VAPID_SUBJECT=mailto:you@example.com \
 *     CRON_SECRET=$(openssl rand -hex 32)
 *
 *   # 2. Deploy this function (it is guarded by CRON_SECRET, so no JWT):
 *   supabase functions deploy push-cron --no-verify-jwt
 *
 *   # 3. Also deploy the main API function if you have not already:
 *   supabase functions deploy server --no-verify-jwt
 *
 * ---------------------------------------------------------------------------
 * SCHEDULE (either one)
 * ---------------------------------------------------------------------------
 * A) Supabase scheduled Edge Functions (dashboard → Integrations → Cron):
 *      name     = llamastu-push-dispatch
 *      schedule = every 5 minutes (cron: [star-slash-5] * * * *)
 *      function = push-cron
 *      header   = x-cron-secret: <CRON_SECRET>
 *
 * B) pg_cron + pg_net, run once in the SQL editor:
 *
 *   create extension if not exists pg_cron;
 *   create extension if not exists pg_net;
 *
 *   select cron.schedule(
 *     'llamastu-push-dispatch',
 *     '*\/5 * * * *',
 *     $$
 *       select net.http_post(
 *         url     := 'https://<project-ref>.supabase.co/functions/v1/push-cron',
 *         headers := jsonb_build_object(
 *           'Content-Type',  'application/json',
 *           'x-cron-secret', '<CRON_SECRET>'
 *         ),
 *         body    := '{}'::jsonb
 *       );
 *     $$
 *   );
 *
 *   -- To stop it again:
 *   -- select cron.unschedule('llamastu-push-dispatch');
 * ---------------------------------------------------------------------------
 */

import { createClient } from "jsr:@supabase/supabase-js@2.49.8"
import webpush from "npm:web-push@3.6.7"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const cronSecret = Deno.env.get("CRON_SECRET") ?? ""
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? ""
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? ""
const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com"

/** How far ahead of the reminder instant to consider an event "due". */
const horizonMinutes = Math.max(0, Number(Deno.env.get("PUSH_HORIZON_MINUTES") ?? 1))

type SubscriptionRow = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

type EventRow = {
  id: string
  user_id: string
  title: string
  description: string | null
  reminder_at: string | null
  start_at: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405)

  // A shared secret is the only guard: the function is deployed with
  // verify_jwt = false so the scheduler does not need a user session.
  if (!cronSecret) return json({ error: "CRON_SECRET is not configured.", code: "NOT_CONFIGURED" }, 503)
  const provided = req.headers.get("x-cron-secret") ?? ""
  if (provided !== cronSecret) return json({ error: "Unauthorised." }, 401)

  if (!vapidPublicKey || !vapidPrivateKey) {
    return json(
      {
        status: "missing_key",
        error: "Web Push is not configured on this deployment.",
        missing: "VAPID_PUBLIC_KEY",
      },
      503,
    )
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const until = new Date(Date.now() + horizonMinutes * 60_000).toISOString()
  const { data: events, error: eventError } = await supabase
    .from("calendar_events")
    .select("id, user_id, title, description, reminder_at, start_at")
    .not("reminder_at", "is", null)
    .lte("reminder_at", until)
    .is("reminder_sent_at", null)
    .order("reminder_at")
    .limit(200)

  if (eventError) return json({ error: eventError.message }, 500)
  const due = (events ?? []) as EventRow[]
  if (!due.length) return json({ ok: true, sent: 0, failed: 0, expired: 0, considered: 0 })

  let sent = 0
  let failed = 0
  let expired = 0
  let skipped = 0

  for (const event of due) {
    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .eq("user_id", event.user_id)

    const reminderAt = event.reminder_at ?? event.start_at
    const payload = JSON.stringify({
      title: event.title,
      body: event.description || "Your reminder is due.",
      reminderAt,
      eventId: event.id,
    })

    let delivered = false
    let lastError = ""

    for (const subscription of (subscriptions ?? []) as SubscriptionRow[]) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
        )
        delivered = true
      } catch (reason) {
        const status = (reason as { statusCode?: number })?.statusCode ?? 0
        if (status === 404 || status === 410) {
          // The subscription is gone for good — remove it so we stop trying.
          expired += 1
          await supabase.from("push_subscriptions").delete().eq("id", subscription.id)
        } else {
          failed += 1
          // Only the numeric status is kept; never the endpoint or the keys.
          lastError = status ? `HTTP ${status}` : "delivery failed"
        }
      }
    }

    if (!subscriptions?.length) {
      // No push subscription is armed for this learner; leave the reminder
      // unsent so an in-app or browser pass can still pick it up.
      skipped += 1
      continue
    }

    const status = delivered ? "delivered" : "failed"
    const now = new Date().toISOString()

    await supabase.from("reminder_deliveries").upsert(
      {
        user_id: event.user_id,
        event_id: event.id,
        reminder_at: reminderAt,
        channel: "push",
        status,
        detail: delivered ? "" : lastError.slice(0, 200),
        delivered_at: delivered ? now : null,
      },
      { onConflict: "user_id,event_id,reminder_at,channel", ignoreDuplicates: true },
    )

    if (delivered) sent += 1
    // Stamp the event so the same reminder cannot be dispatched twice. A
    // reschedule clears reminder_sent_at, re-arming it at the new instant.
    await supabase
      .from("calendar_events")
      .update({ reminder_sent_at: now })
      .eq("id", event.id)
      .is("reminder_sent_at", null)
  }

  return json({ ok: true, considered: due.length, sent, failed, expired, skipped })
})
