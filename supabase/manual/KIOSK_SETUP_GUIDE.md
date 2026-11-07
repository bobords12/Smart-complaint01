# Kiosk Setup Guide — Barangay Abuno Public Complaint Kiosk

Operator guide for the public walk-in complaint kiosk. Read this before the
kiosk is put into service.

The kiosk is **not a separate application**. It is a set of routes inside the
existing SCBMS project, talking to the same Supabase project as every other
portal. Nothing in this guide asks you to create a second database, run a
migration tool, or install anything on the server.

---

## 1. SQL execution order

Six files, all under `supabase/manual/`. They are named with a `kiosk-` prefix
so they stay together and do not collide with the base `01`–`25` run.

| # | File | What it adds |
|---|------|--------------|
| 1 | `kiosk-01-schema-support.sql` | Enables `pgcrypto`; adds `'kiosk'` to `complaints.filing_channel` and `complaints.source`; adds the kiosk columns on `complaints`; creates `kiosk_upload_sessions`, `kiosk_upload_session_files`, `kiosk_rate_limits`; creates `public.kiosk_sha256(text)` |
| 2 | `kiosk-02-secure-idempotent-submission.sql` | `kiosk_check_rate_limit()`, `kiosk_clean_text()`, `kiosk_normalize_mobile()`, and the single trusted write path `kiosk_submit_complaint()` |
| 3 | `kiosk-03-status-token-security.sql` | `kiosk_new_token()`; the resident-safe read path `kiosk_status_payload()`, `kiosk_status_by_token()`, `kiosk_status_lookup()`; and the whole upload-session lifecycle: `kiosk_create_upload_session()`, `kiosk_resolve_upload_session()`, `kiosk_upload_session_status()`, `kiosk_register_uploaded_file()`, `kiosk_revoke_upload_session()`, `kiosk_cleanup_expired_uploads()` |
| 4 | `kiosk-04-rls-and-permissions.sql` | Enables RLS on the kiosk tables, **REVOKEs** table privileges from `anon` on the sensitive tables, and restricts `EXECUTE` to the kiosk RPCs |
| 5 | `kiosk-05-evidence-storage.sql` | Re-asserts the `evidence` bucket as **private**, adds `image/webp` without dropping existing MIME types, and adds the kiosk Storage policies |
| 6 | `kiosk-06-offline-sync-verification.sql` | Verification only. **Every statement is a SELECT.** Run it and read the output. |

**Order matters.**

- `kiosk-02` depends on `public.kiosk_sha256()` from `kiosk-01`.
- `kiosk-03` reads `case_statuses`, `kp_trackers` and `hearings`, which come
  from the base run, and it declares `kiosk-01, kiosk-02` as prerequisites.
- `kiosk-04` must run last of the schema files: it revokes and re-grants on
  objects that `02` and `03` must already have created.
- `kiosk-05` declares `kiosk-01, kiosk-02, kiosk-03` as prerequisites.
- `kiosk-06` runs after `kiosk-05`.

Every file is written to be re-runnable (`IF NOT EXISTS`,
`CREATE OR REPLACE`, `ON CONFLICT DO NOTHING`). Re-running one is safe.

### `pgcrypto` is mandatory

`kiosk-01` enables `pgcrypto` because the kiosk stores only SHA-256 **hashes**
of the QR status token and the QR upload token — never the tokens themselves.
Postgres has no built-in SHA-256, so without this extension
`public.kiosk_sha256()` cannot exist and nothing else works. The extension is
added additively and the function looks for `digest` in whichever schema the
hosted project already keeps its extensions in, so an existing `pgcrypto` in a
non-`public` schema is fine.

### How to run them

1. Supabase project → **SQL Editor** → **New query**.
2. Paste the whole contents of `kiosk-01-schema-support.sql`.
3. **Run**. It must report success with no red errors.
4. Repeat for files 02 through 05.
5. Run `kiosk-06-offline-sync-verification.sql` and check its output against
   the sections referenced below.

Do **not** expect `kiosk-06` to change anything. It is a report.

---

## 2. Environment variables

The kiosk uses **the same two variables as the rest of the project**. No new
keys, and no service-role key.

| Variable | Where it lives | Public? |
|----------|----------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env` locally, host env in production | Yes, by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env` locally, host env in production | Yes — RLS and the RPC boundary are the protection, not this key |

**There is deliberately no `SUPABASE_SERVICE_ROLE_KEY` for the kiosk.** The
kiosk reaches the database only through `SECURITY DEFINER` functions that are
written to be safe when called by `anon`. Do not add a service-role key "to
make the kiosk work" — that would hand the public walk-in path unrestricted
table access.

### Why the kiosk does not use the service role

`lib/kiosk/serverApi.js` builds its Supabase client **without cookies**.
`lib/supabase/server.ts` forwards the visitor's session, which would make a
walk-in's complaint act as whoever happened to be signed in on the hall
machine. A kiosk complaint is anonymous by definition, so it must never
inherit a resident or staff session. If you change that client, you break that
guarantee.

The only kiosk function granted to `service_role` is
`kiosk_cleanup_expired_uploads()`, and nothing in the request path calls it.

---

## 3. Storage bucket configuration

Run `kiosk-05-evidence-storage.sql`. Confirm the result:

```sql
SELECT id, public, file_size_limit, allowed_mime_types
  FROM storage.buckets
 WHERE id = 'evidence';
```

Expected:

| Bucket | `public` | `file_size_limit` | MIME types |
|--------|----------|-------------------|------------|
| `evidence` | `false` | `10485760` (10 MB) | `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `application/pdf` |

If `public` is `true`, the kiosk is broken in a way that matters: every
evidence object would have a guessable public URL. Fix it before the kiosk is
used:

```sql
UPDATE storage.buckets SET public = false WHERE id = 'evidence';
```

Evidence previews are served through **short-lived signed URLs**, never
`getPublicUrl`. Do not "simplify" this by switching to a public bucket.

### Object layout

Objects are written to:

```
kiosk/{draft_reference}/{random}.{ext}
```

`draft_reference` is random and is **not** the QR secret, but it is still
unguessable. The complainant's name never appears in a path, so a leaked path
cannot identify anyone, and the resident's original filename is preserved in
the `evidence` table rather than in the object name.

### The MIME allowlist is enforced in three places

| Layer | File |
|-------|------|
| Browser, before any bytes are sent | `lib/kiosk/config.js` → `EVIDENCE_ACCEPTED_MIME` |
| Route handler, again on the server | `app/api/kiosk/upload/direct/route.js` |
| Storage bucket itself | `allowed_mime_types` on the bucket |

Removing one layer is not enough, and adding a format means changing all three.

---

## 4. Row Level Security — verifying it holds

`kiosk-04` does two things that must both be true. It **enables RLS** on the
kiosk tables, and it **REVOKEs** the table-level privileges that Supabase
grants `anon` by default on the sensitive tables. Revoking the privilege as
well as relying on RLS means a future mistake in a policy cannot turn into a
data leak. This strengthens the existing posture and removes no capability any
portal uses, because every portal signs in as `authenticated` and its RLS keys
off `auth.uid()`.

```sql
-- 1. No policy may name anon as a role.
SELECT tablename, policyname, roles, cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND 'anon' = ANY (roles);
-- Expected: zero rows.

-- 2. RLS enabled on the kiosk tables.
SELECT tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename IN ('kiosk_upload_sessions',
                     'kiosk_upload_session_files',
                     'kiosk_rate_limits');
-- Expected: rowsecurity = true for all three.

-- 3. Privileges are gone, not just filtered.
SELECT table_name, grantee, privilege_type
  FROM information_schema.table_privileges
 WHERE grantee = 'anon'
   AND table_schema = 'public'
   AND table_name IN ('complaints', 'evidence', 'notifications',
                      'audit_logs', 'blotter_records', 'hearings');
-- Expected: zero rows.

-- 4. THE IMPORTANT ONE. anon may EXECUTE only kiosk RPCs.
SELECT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND has_function_privilege('anon', p.oid, 'EXECUTE')
   AND p.proname LIKE 'kiosk_%'
 ORDER BY 1;
-- Expected: exactly the kiosk_* functions the route handlers call, and
-- nothing else you do not recognise.
```

Query 4 is the one to read carefully. Anything named `kiosk_%` that appears
there which you do not recognise is a grant you did not intend.

A kiosk submission must **not** appear as an authenticated row. If a complaint
ends up with a `resident_id`, the client was changed to send cookies.

---

## 5. Rate limits

All limits are enforced in SQL, keyed on the kiosk's device fingerprint, so
they hold across tabs and across a reload. The counters live in
`kiosk_rate_limits`.

| Operation | Key | Limit |
|-----------|-----|-------|
| Complaint submission | `submit:` + fingerprint | **12 per 3600 s** |
| QR status page load | `status_token:` + fingerprint | **90 per 3600 s** |
| Manual status lookup | `status_lookup:` + fingerprint | **10 per 900 s** |
| Creating a QR upload session | `upload_session:` + fingerprint | **20 per 3600 s** |
| Polling an upload session | `upload_poll:` + fingerprint | **240 per 3600 s** |
| Registering a file against a session | `upload_register:` + SHA-256 of the token | **30 per 3600 s** |

Two properties matter more than the numbers:

- **A wrong tracking number and a wrong mobile number cost the same budget and
  return the same message.** If they ever diverge, the endpoint has become an
  existence oracle and leaks which complaints exist.
- **The submission limit is per device, not per person.** It throttles a
  vandalised kiosk. It is never evidence of who filed anything.

To clear a counter for a device that is genuinely stuck, delete its row:

```sql
SELECT count(*), max(count) FROM public.kiosk_rate_limits;
-- inspect
DELETE FROM public.kiosk_rate_limits WHERE key LIKE 'submit:%';
```

---

## 6. Testing kiosk submission (online)

1. `npm run dev`, then open `http://localhost:3000/kiosk`.
2. Confirm the welcome screen shows **No Account Required / Walang Account na
   Kailangan**. If it asks you to log in, the kiosk is pointed at the wrong
   layout.
3. File a complaint as a guest. Check every summary card on the review screen
   before submitting.
4. On success, note the tracking number. It looks like `AB-2026-0001` — four
   digits, produced by `public.generate_reference_number()`, which is the
   **complaint** numbering sequence. It is **not** a barangay blotter number;
   those come from a separate sequence and a separate field.
5. Confirm it reached the staff queue:

```sql
SELECT reference_number, source, filing_channel, current_status,
       kiosk_sync_status, kiosk_client_submission_id
  FROM complaints
 ORDER BY submitted_at DESC
 LIMIT 5;
```

`filing_channel` must be the kiosk value and `current_status` must be
`Pending Review`.

The kiosk must **never** create a blotter, a summons, a hearing, a Lupon panel
or a PNP referral. If it did, the SQL is wrong. See section 18.

6. Confirm the initial status-history row and the audit row:

```sql
SELECT cs.status, cs.stage, cs.resident_visible_message, cs.created_at
  FROM case_statuses cs
  JOIN complaints c ON c.id = cs.complaint_id
 WHERE c.reference_number = 'AB-2026-0001'
 ORDER BY cs.created_at;
```

7. Confirm the AI suggestion was stored as a **suggestion**, with the complaint
   left pending:

```sql
SELECT classification_status, classification_model, classification_at
  FROM complaints
 WHERE reference_number = 'AB-2026-0001';
```

If `classification_status` is `pending`, that is **correct** and is what
happens when the model is unavailable. The complaint is never deleted, held
back, or failed because classification did not run.

### Idempotency

`kiosk_submit_complaint()` takes a client-generated
`kiosk_client_submission_id` UUID that is created before the first attempt and
reused on every retry, backed by a unique index, with `unique_violation`
caught inside the function. Replay the identical `/api/kiosk/submit` request
from the Network tab. The second call must return the **same** tracking number
and create no second row:

```sql
SELECT count(*) FROM complaints WHERE kiosk_client_submission_id = '<the uuid>';
-- Expected: 1
```

---

## 7. Testing evidence upload

Two paths. Both must work.

**A. From the kiosk (QR, screen 10)**

1. Reach the Evidence step, choose **Scan to Upload**.
2. A QR code appears with a countdown of ten minutes.
3. Scan it with a phone. It opens `/kiosk/upload/<32 hex chars>`.
4. Send a photo. The kiosk screen updates on its own within a few seconds with
   the file listed.
5. Confirm the object landed:

```sql
SELECT original_filename, mime_type, file_size, uploaded_at
  FROM kiosk_upload_session_files
 ORDER BY created_at DESC
 LIMIT 5;
```

**B. On the phone page**

- An invalid or expired token must show a plain "this link is not valid"
  message and no upload control. The token is matched as a SHA-256 hash; the
  raw token is never stored.
- A file over **10 MB** must be rejected on the phone, before any bytes are
  sent.
- A `.exe`, `.txt` or `.svg` must be rejected. See section 3 for the three
  enforcement layers.
- **Five files** is the maximum.

### Token expiry and revocation

- Wait out the countdown, or set `expires_at` to the past, then confirm both
  the phone page and the kiosk screen report the link as expired.
- Go back from the QR screen and confirm the session is revoked: the same token
  must no longer accept a file.

```sql
SELECT id, expires_at, used_at, revoked_at
  FROM kiosk_upload_sessions
 ORDER BY created_at DESC
 LIMIT 5;
```

### What must never appear in a QR code

Full name, mobile number, address, narrative, or a sequential database id.

- The upload URL carries a **32-character** random token (one UUID, dashes
  stripped) and nothing else.
- The status QR carries a **64-character** random token and nothing else.

The status token is generated in the browser before submission so the citizen's
phone is usable immediately; the server hashes it together with the reference
number (`sha256(reference || ':' || token)`) and stores only the digest. If you
ever find a name, a phone number, or an id in a link, stop and fix it.

---

## 8. Testing manual status lookup (screen 15)

1. Go to `/kiosk/status`.
2. Enter the tracking number and the mobile number given at filing.
3. The result must show current status, filed date, and the timeline.
4. Now try a **wrong** mobile with a **correct** tracking number. It must say
   "We could not verify those details" — the same message as a tracking number
   that does not exist.
5. Try ten times. The eleventh must be refused (`status_lookup` limit, 10 per
   900 s per device).

If a wrong mobile produces a *different* error from a wrong tracking number,
the endpoint has become an existence oracle. That is the exact leak this design
refuses, so fix it before continuing.

---

## 9. Testing QR status lookup (screen 18)

1. File a complaint and scan the QR on the success screen.
2. Confirm the timeline appears with the stage list matching the case:
   - a KP-eligible case **with a known respondent** may show
     Filed → Reviewed and Approved → Summons Issued → In Mediation →
     Settlement or Escalation;
   - **everything else** shows Filed → Under Review → Routing Confirmed →
     Blotter Linked or Referred → Completed or Closed.
3. File a complaint with an unknown respondent and confirm it does **not** show
   summons or mediation stages.
4. Confirm the mediation-period card only appears once mediation has actually
   started, and the hearing card only when a hearing exists.
5. Open a garbage token and confirm it shows "Saved on Kiosk — Pending Sync",
   **not** "no such complaint".

### Privacy check

The status page must not show staff notes, Lupon deliberations, audit metadata,
other residents' data, private evidence, or a classification confidence.
`kiosk_status_payload()` assembles an explicit column allow-list precisely so a
column added to `complaints` later cannot leak by accident. **If you add a
field, add it to that allow-list — do not widen it to `SELECT *`.**

---

## 10. Browser kiosk mode

For the hall's fixed tablet, use Chrome or Edge in kiosk mode. Kiosk mode
closes the tab on exit, which triggers the same reset as a timed-out session —
that is the behaviour you want.

**Windows (Chrome/Edge):**

1. Install Chrome or Edge.
2. `chrome.exe --kiosk --kiosk-printing http://<host>:3000/kiosk`
   (use `msedge.exe` for Edge).
3. To pin the URL so staff cannot navigate away, create a Shortcut with that
   Target, then open the shortcut's Properties → Shortcut → Advanced and set a
   Start In path.

**Android tablet:** Chrome → ⋮ → Add to Home screen. This installs
`/manifest.webmanifest` as a standalone app and registers the service worker
properly.

**Service worker requirement:** the kiosk needs `https://` or `localhost`. On a
plain-`http://` LAN address the browser will not register a service worker, and
`crypto.subtle` is unavailable, so **offline filing is disabled entirely**.
Online filing still works. To get offline filing on a LAN, put the app behind a
 locally trusted TLS terminator (such as Caddy or nginx) and use `https://`.

Confirm the worker in DevTools → Application → Service Workers. It is
registered at `/sw.js` and only the `/kiosk/` layout mounts the registrar, so
no staff portal is ever in its scope.

---

## 11. Testing printing

1. File a complaint and press **Print Receipt**.
2. The print preview must show the logo, the tracking number, and a
   **scannable** QR code.
3. Navigation and buttons must be absent from the printout.
4. Test in greyscale if the hall printer is monochrome. The receipt CSS forces
   light ink and keeps a visible rule around the QR so it survives a
   black-and-white printer.

The receipt must carry this notice, and it must not be softened:

> This receipt confirms that the complaint was received. It is not yet an
> official Barangay Case Number, Barangay Blotter Entry, PNP Blotter Number, or
> Certificate to File Action.

---

## 12. Troubleshooting

**The kiosk refuses every submission**
The RPCs are missing or not granted. Run `kiosk-01` through `kiosk-04`, then
re-check query 4 in section 4. Check the server log for `[kiosk] ... permission
denied`.

**QR code says "not valid" immediately**
`expires_at` is in the past — check the clock on the Supabase server and on the
kiosk — or the session was revoked. Sessions last ten minutes.

**Phone uploads a file but the kiosk screen never updates**
The polling request is failing. Confirm `/api/kiosk/upload/session` returns 200
for that token and fingerprint, and that `kiosk-05` has run so the Storage
policies allow the kiosk's read. Remember the `upload_poll` budget is 240 per
hour per device, so a stuck screen can exhaust it.

**A queued complaint never syncs**
Open DevTools → Application → IndexedDB → `scbms_kiosk` and read `state`.

| State | Meaning | Action |
|-------|---------|--------|
| `pending_sync` | Waiting for connectivity, or the next 30 s interval | Nothing |
| `syncing` | A request is in flight | Wait |
| `sync_failed` | The last attempt was rejected; it will retry | Read `last_error` |
| `needs_attention` | Retries were exhausted. **A person must deal with this** | Investigate |

`last_error` holds only a machine code or a short string, never the
complainant's details.

**Offline filing is refused with a quota or storage error**
`navigator.storage.estimate()` in DevTools shows the remaining quota.
Private-browsing modes and some managed devices block IndexedDB entirely.

**No service worker in the Application panel**
Almost always plain `http://` on a non-localhost host. See section 10.

**The kiosk keeps asking people to log in**
`middleware.ts` only redirects portal prefixes; `/kiosk` sits outside every one
of them. If you are redirected, something other than the kiosk layout is
rendering.

---

## 13. Testing offline queuing

1. Start online, reach the review screen, then disconnect the network
   (DevTools → Network → Offline, or turn off the Wi-Fi).
2. Confirm the yellow banner appears and the connection pill reads **Offline**.
3. Complete and submit. The receipt must read **Complaint Saved — Pending
   Sync** with an opaque reference. It must **not** say "Filed Successfully" and
   must **not** show a tracking number, because the server has confirmed
   nothing yet.
4. Reload the page. The queued entry must survive.
5. Confirm no personal data is visible anywhere on screen. The queue is never
   rendered as a list, only as a count.
6. Reconnect. Within a few seconds the entry should sync and the receipt should
   flip to the real tracking number.

To inspect the queue, open DevTools → Application → IndexedDB → `scbms_kiosk`:

| Store | Contains |
|-------|----------|
| `submissions` | One `kind: "submission"` record per queued complaint, plus one `kind: "file"` record per queued evidence blob |
| `keys` | One record, `id: "device-key"`, holding a non-extractable `CryptoKey` |

The `payload` field is `{ iv, data, algorithm }` — AES-GCM ciphertext. **If you
can read a complainant's name out of `payload.data`, encryption is not running.**

### What SQL cannot verify

IndexedDB, encryption, and retry behaviour are browser-side and have no SQL
surface. `kiosk-06-offline-sync-verification.sql` says so in its own header and
points here. Use this section, and sections 14 to 16 and 20, for the offline
checks.

---

## 14. Testing automatic synchronization

### With Background Sync (Chrome, Edge, most Chromium browsers)

1. Queue a complaint while offline, then close the tab.
2. Restore the network.
3. The worker should drain the queue on its own, with no tab open.

Confirm it registered:

```js
// DevTools console, while the kiosk tab is open
const reg = await navigator.serviceWorker.ready;
await reg.sync.register("kiosk-outbox");
```

The worker deletes each encrypted record only after the backend confirms
success, so a kill mid-drain loses nothing.

### Without Background Sync (Firefox, Safari, older browsers)

Those browsers have no Background Sync, and no polyfill should be added. The
fallback is already in place:

- a 30-second drain interval while the kiosk tab is open, and
- a drain on the browser's `online` event.

So a queued complaint sends itself **while the kiosk page stays open**, or the
next time somebody loads `/kiosk`. It will **not** send itself after the
browser is fully closed and nobody returns to the kiosk. This is a platform
limitation, not a bug, and hall staff must be told rather than left to guess.

### Storage quota failure

Queue several complaints with evidence-sized payloads until the quota is
exhausted. The kiosk must refuse with an explanation rather than losing the
filing. Nothing is silently discarded.

---

## 15. Testing inactivity reset

1. Begin a complaint, type a name and a mobile number, then stop touching the
   screen.
2. After **four minutes** (`INACTIVITY_WARNING_MS`) the warning modal appears
   with a visible **30 seconds** (`INACTIVITY_COUNTDOWN_SECONDS`) countdown.
3. Press **I'm Still Here**. The form must be intact.
4. Let the countdown run out. You must land on the welcome screen with an empty
   form, no previous name, and no previews.
5. Confirm the queued offline entries still sync afterwards. A privacy timeout
   must never delete a complaint that was already saved — that record belongs to
   the citizen who filed it, not to whoever sits down next.

Escape deliberately does **not** dismiss the modal. If it does, the privacy
mechanism is defeatable by reflex.

The device fingerprint is intentionally **not** reset by the timeout, because
throwing it away would let anyone clear the rate limit with a button press.

---

## 16. How queued records are cleaned up

| When | What |
|------|------|
| Confirmed sync | The entry and its sealed evidence blobs are deleted immediately. Nothing is kept "just in case". |
| Abandoned | `pruneExpired(7)` drops `pending_sync` and `sync_failed` entries older than `OFFLINE_RETENTION_DAYS` (7 days) on the next kiosk load. |
| Needs attention | `needs_attention` entries are **never** pruned automatically. A person must deal with them. |
| Crashed mid-sync | `releaseStaleSyncing()` resets anything stuck in `syncing` back to `pending_sync`, so a closed tab cannot strand a complaint. |

Seven days is the compromise: long enough that a citizen who filed offline and
came back later still has their complaint, short enough that an unattended
kiosk does not accumulate ciphertext indefinitely.

Abandoned **upload sessions** are a separate matter. `kiosk-06` will show them
growing. `kiosk_cleanup_expired_uploads()` is the sweeper, and it is granted to
`service_role` **only** — no request path calls it. Schedule it if your hall's
traffic warrants it:

```sql
SELECT public.kiosk_cleanup_expired_uploads();
```

---

## 17. What the kiosk deliberately does not do

Confirm each of these is still true before sign-off:

- [ ] It does **not** create a barangay case number. That is assigned by
      `receive_complaint_official()` when an authorised official accepts the
      complaint, in the staff portal.
- [ ] It does **not** create a barangay blotter record.
- [ ] It does **not** issue a summons, schedule a hearing, or assign a Lupon
      panel.
- [ ] It does **not** create a PNP referral. Referral is a formal staff workflow
      in the PNP portal.
- [ ] It does **not** generate a Certificate to File Action.
- [ ] It does **not** approve the complaint or treat the allegation as proven.
- [ ] It does **not** link the submission to a resident account on the strength
      of a matching phone number.
- [ ] It does **not** dispatch anybody. An "immediate safety concern" answer
      shows a notice telling the citizen to seek help from barangay personnel
      or the proper emergency authority; no record and no alert is created.

The correct chain is:

```
Kiosk submission
  -> Barangay review
    -> Routing assessment
      -> Acceptance when appropriate
        -> Official case or Reklamo document generated by authorised personnel
```

A tracking number from the kiosk is a **receipt reference**. Nothing more.

---

## 18. Staff-queue integration check

Kiosk complaints must appear in the existing Captain / OIC / Secretary
complaints queue and be structurally indistinguishable from any other
complaint.

1. Open `/captain/complaints` (or OIC, or Secretary).
2. Confirm the kiosk complaint is listed with its **Kiosk** source badge.
3. Open it. Confirm the complainant snapshot, respondent status, incident
   details and evidence all render.
4. Confirm the AI suggestion is labelled **AI Suggestion** and that category,
   urgency and routing stay unconfirmed until an official sets them.
5. Log in as a resident and confirm a kiosk complaint is **not** listed under
   **My Complaints**, because it was never linked to their account.

---

## 19. Sign-off checklist

- [ ] `kiosk-01` … `kiosk-06` all run clean, in order, re-runnable.
- [ ] `kiosk-06` output matches its stated expectations in every section.
- [ ] Section 4 query 4 lists only recognised `kiosk_%` functions.
- [ ] `evidence` bucket is `public = false`, 10 MB, with `image/webp`.
- [ ] A kiosk complaint has no `resident_id`, no blotter, no case number.
- [ ] Replaying a submission returns the same tracking number.
- [ ] A wrong mobile and a wrong tracking number are indistinguishable.
- [ ] A garbage status token says "Pending Sync", never "no such complaint".
- [ ] Offline submission, reload survival, and reconnect sync all work.
- [ ] Four-minute warning, 30-second countdown, and clean reset all work.
- [ ] `payload.data` in IndexedDB is unreadable ciphertext.
- [ ] No complaint data in `localStorage` or `sessionStorage` (section 20).
- [ ] Receipt prints legibly in greyscale with a scannable QR.
- [ ] Receipt carries the full disclaimer.
- [ ] HTTPS or localhost in production, so the service worker registers.
- [ ] Section 17 confirmed item by item.

---

## 20. Verifying no sensitive data is in localStorage

The kiosk keeps complaint data in **exactly one** place: the encrypted
IndexedDB queue. Nothing about a complaint may reach `localStorage` or
`sessionStorage`, because on a shared hall machine those are readable by the
next person in plain text.

Paste this into DevTools on `/kiosk` after filing a complaint, once online and
once offline:

```js
(() => {
  const needles = ["narrative", "mobile", "complainant", "statusToken",
                   "reference_number", "firstName", "address"];
  const dump = { localStorage: {}, sessionStorage: {} };
  for (const store of [localStorage, sessionStorage]) {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      dump[store === localStorage ? "localStorage" : "sessionStorage"][k] =
        store.getItem(k);
    }
  }
  const hits = needles.filter(n =>
    JSON.stringify(dump).toLowerCase().includes(n.toLowerCase()));
  return {
    keys: Object.keys(dump.localStorage).length +
          Object.keys(dump.sessionStorage).length,
    sensitiveHits: hits,
  };
})();
```

`keys` should be `0`, or the remaining keys should be unrelated to complaints.
`sensitiveHits` must be empty.

Also confirm no sensitive request was written to a cache:

```js
(await caches.keys()).forEach(async (n) => {
  const keys = await (await caches.open(n)).keys();
  console.log(n, keys.map(r => new URL(r.url).pathname));
});
```

No path under `/api/`, `/kiosk/status/`, or `/kiosk/upload/` may appear. Those
are token-bearing or personal, and the worker deliberately refuses to cache
them.

### A note on physical security

None of this substitutes for securing the device. An unattended kiosk in a
public hall should be in a locked mount or enclosure, with no unlocked session
left on it. The encryption protects the data at rest in the browser profile;
it does not protect a running, unlocked machine.
