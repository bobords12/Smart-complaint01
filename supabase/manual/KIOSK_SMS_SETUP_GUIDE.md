# Kiosk confirmation SMS — setup guide

The kiosk now tells the complainant that the complaint was received,
by text message, using the reference number the database actually
saved.

This guide is the runbook. Nothing in it has been executed yet:
the SQL has not been applied, the edge function has not been
deployed, and no message has been sent.

---

## 1. How it works

```
citizen submits at the kiosk
        │
        ▼
POST /api/kiosk/submit
        │
        ▼
kiosk_submit_complaint()  ──►  complaints row COMMITTED
                                     │  (reference_number, status,
                                     │   complainant_snapshot)
                                     ▼
                          AFTER INSERT trigger
                                     │
                                     ▼
                     kiosk_sms_outbox row  (status = pending)
                     UNIQUE (complaint_id, notification_type)
                                     │
        ┌────────────────────────────┴───────────────────────────┐
        ▼                                                        ▼
the route asks the worker to                the sweeper collects whatever
deliver it right now                       is still waiting (optional)
        │                                                        │
        └────────────────────────────┬───────────────────────────┘
                                     ▼
                      send-kiosk-confirmation-sms  (Edge Function)
                                     │
                                     ▼
                             PhilSMS  →  the citizen's phone
```

The rule that makes this safe: **the complaint and the promise to send
a message are written in the same transaction.** A message can never
be sent for a complaint that was not filed, and a filed complaint
never loses its message.

### The text

```
BARANGAY ABUNO

Your complaint has been successfully submitted through our Public Kiosk.

Reference No.: AB-2026-0042
Status: Pending Review

Your complaint is awaiting review by the Barangay Office.

Please keep your reference number and the Tracking QR Code provided at the kiosk for future updates and inquiries.

This is an automated message. Please do not reply.
```

* 367 characters, plain ASCII, **3 billable GSM-7 segments per
  complaint**. The wording is fixed by the barangay and is asserted
  character for character in `scripts/test-kiosk-sms.mjs`.
* The reference number is the one `public.generate_reference_number()`
  produced and stored on the complaint row.
* The status is the one the complaint row carries. It reads "Pending
  Review" in practice, because the message goes out seconds after the
  commit. If a reviewer moved the complaint first, the message tells
  the truth instead of lying.

### The number

The recipient is the number persisted on the complaint, never one
supplied by a caller.

| Written at the kiosk | Stored | Sent to PhilSMS |
| --- | --- | --- |
| `09171234567` | `09171234567` | `639171234567` |
| `+639171234567` | `09171234567` | `639171234567` |
| `639171234567` | `09171234567` | `639171234567` |

`PHILSMS_RECIPIENT_FORMAT=+63` switches the last column to
`+639171234567`.

---

## 2. What is NOT verified

The PhilSMS **New Dashboard** documentation for the v3 API is behind a
login, and the pages that are public still describe the legacy host
(`app.philsms.com`). What was verified against the live New Dashboard
without sending anything:

* `POST https://dashboard.philsms.com/api/v3/sms/send` exists.
* Without a token it answers `{"status":"error","message":"Unauthenticated."}`.
* Unknown routes under `/api/v3` answer
  `{"status":"error","message":"The route api/v3/... could not be found."}`.
* `/api/v1/*` and `/api/v2/*` do not exist.

What was taken from the published documentation and therefore still
needs a real account to confirm:

* the request field names (`recipient`, `sender_id`, `type`, `message`),
* the bearer scheme (`Authorization: Bearer {api_token}`),
* the success envelope (`{"status":"success","data":{...}}`),
* the sender-id rules (11 characters),
* the rate limits, the credit rules and the delivery callbacks.

**If the real account answers with different field names, change
`buildPhilsmsSendPayload()` and `classifyPhilsmsOutcome()` in
`supabase/functions/_shared/kiosk-sms.mjs` and nothing else.** The
worker, the outbox and the UI do not know about the provider.

---

## 3. The four approval gates

Nothing below happens without a decision.

| # | Gate | What it needs |
| --- | --- | --- |
| 1 | Apply `kiosk-08-sms-outbox.sql` | Your approval to change the database |
| 2 | Deploy the edge function | Your approval to change shared infrastructure |
| 3 | Set the PhilSMS secret | Your approval to store a credential |
| 4 | Send a real message | Your approval to spend a credit |

Until gate 1 is done, the feature is already safe to deploy: the
server-side code logs the reason (`PGRST202`, the function is not in
the database yet) and the filing is never affected.

---

## 4. Step 1 — the database

In the Supabase SQL editor, run:

```
supabase/manual/kiosk-08-sms-outbox.sql
```

It creates the outbox table, the enqueue trigger, the idempotent
repair function and the permissions, and ends with the verification
queries. **Read the verification output before continuing.**

Optional, and only after the manual path has been proven:
`supabase/manual/kiosk-09-sms-sweeper-cron.sql`.

---

## 5. Step 2 — the PhilSMS account

On the New Dashboard you need:

1. an approved **sender id** (up to 11 characters, e.g. `ABUNO`),
2. an **API token**,
3. enough credit for the test.

The provider will not accept a message from a sender id that has not
been approved, so approve it before testing.

---

## 6. Step 3 — the function secrets

```
supabase secrets set PHILSMS_API_TOKEN=<your token> PHILSMS_SENDER_ID=<your sender id>
```

Optional:

```
supabase secrets set PHILSMS_RECIPIENT_FORMAT=63
supabase secrets set PHILSMS_TIMEOUT_MS=15000
supabase secrets set PHILSMS_API_BASE_URL=https://dashboard.philsms.com/api/v3
```

The token never leaves the `Authorization` header: it is not in the
URL, not in the body, not in a log line and not in the response.

---

## 7. Step 4 — deploy the function

```
supabase functions deploy send-kiosk-confirmation-sms
```

JWT verification stays ON (`supabase/config.toml`). The function also
checks the token's role itself and refuses anything that is not a
service-role token, so no public or anonymous caller can make this
project send a text message.

---

## 8. Step 5 — the application

Nothing is required. The feature is on by default and the application
already has `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

| Variable | Effect |
| --- | --- |
| `KIOSK_SMS_ENABLED=0` | turns the whole feature off |
| `KIOSK_SMS_DISPATCH=0` | queues the jobs but only the sweeper delivers them |
| `CRON_SECRET` | required by the sweeper route; without it the route answers 404 |

---

## 9. Step 6 — the sweeper (optional)

The fast path delivers the message seconds after the filing. The
sweeper is the safety net for the rare case where that attempt did
not happen.

**Recommended (Vercel cron).** Add to `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/kiosk/sms/sweep", "schedule": "*/5 * * * *" }
  ]
}
```

and set `CRON_SECRET` in Vercel. The route is closed when the secret
is missing, and the secret never enters the database.

**Alternative.** `supabase/manual/kiosk-09-sms-sweeper-cron.sql`
schedules the same call with `pg_cron` and `pg_net`, with the token
in Supabase Vault. It needs the `pg_cron` extension enabled from the
Dashboard.

---

## 10. Verification

### Before any real message

```
curl -X POST "<SUPABASE_URL>/functions/v1/send-kiosk-confirmation-sms" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```

A dry run builds the message, sends nothing and writes nothing. The
response carries the exact text that would have gone out.

### The first real message

1. File one complaint through the kiosk with your own phone number.
2. Watch the job:

   ```sql
   SELECT status, attempts, provider_message_id, sent_at, last_error_code
     FROM public.kiosk_sms_outbox
    ORDER BY created_at DESC
    LIMIT 5;
   ```

3. **Confirm the handset received it.** Until a handset has shown the
   message, nothing may be claimed about delivery: `status = 'sent'`
   means the provider accepted the request, not that the phone rang.
4. File the same complaint again (double-click the Submit button).
   The job count must not change and the phone must not receive a
   second message.

### The regression script

```
npm run test:kiosk-sms
```

103 checks, no credits, no database. It covers the wording, the
number rules, the provider's answers, the worker's decisions (retry,
unknown outcome, skip, fail), the race between two workers, the dry
run, and the guarantees the migration must keep.

---

## 11. Turning it off

| Situation | Action |
| --- | --- |
| The provider is down | nothing happens: the jobs wait in `pending` |
| The wording is wrong | change `kiosk-sms.mjs`, redeploy; queued jobs pick up the new wording |
| The whole feature is unwanted | `KIOSK_SMS_ENABLED=0`, redeploy the app |
| A message was sent to the wrong number | `UPDATE kiosk_sms_outbox SET status = 'skipped' WHERE id = ...` |

A job in `uncertain` is never sent again. That is deliberate: the
previous attempt may have reached the phone, and a second identical
message is worse than silence. A human decides what happens next.

---

## 12. The files

| File | What it is |
| --- | --- |
| `supabase/functions/_shared/kiosk-sms.mjs` | the wording, the number rules, the provider contract |
| `supabase/functions/_shared/kiosk-sms-worker.mjs` | the job state machine (claim, send, record) |
| `supabase/functions/send-kiosk-confirmation-sms/index.ts` | the edge function (service role only) |
| `supabase/functions/_shared/*.d.mts` | the type declarations for the TypeScript function |
| `lib/sms/kioskSms.js` | the Next.js side: queue the job, call the worker |
| `app/api/kiosk/submit/route.js` | calls the above AFTER the complaint is committed |
| `app/api/kiosk/sms/sweep/route.js` | the sweeper, closed without `CRON_SECRET` |
| `app/kiosk/page.jsx`, `components/kiosk/KioskSuccess.jsx` | the receipt notice (hidden from the printout) |
| `lib/kiosk/i18n.js` | the notice, in English and Filipino |
| `supabase/manual/kiosk-08-sms-outbox.sql` | the outbox, the trigger, the repair function |
| `supabase/manual/kiosk-09-sms-sweeper-cron.sql` | the optional sweeper |
| `scripts/test-kiosk-sms.mjs` | the regression script |
