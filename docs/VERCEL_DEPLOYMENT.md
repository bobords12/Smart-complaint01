# SCBMS deployment checks (Vercel web app + separate ML service)

This guide describes prerequisites, not an executed production deployment. The
existing business workflow and all seven portals remain in the Next.js app.
The original Python TF-IDF + LinearSVC service runs separately from Next.js.
This working directory did not contain a Git repository when the baseline was
checked. The change log below identifies every affected source/configuration
path; keep a copy or use the workspace's file-version history before deploying
so the baseline can be restored. A rollback of the Next.js convention change
also restores `middleware.ts` in place of `proxy.ts` (never keep both at once).

## Web app configuration

Use `npm run build` for a local production build. Set the following **in the
Vercel project**, separately for Production and Preview; a local `.env` is not
uploaded by Git deployments. `.env.example` contains placeholder names only.

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser and server | Existing Supabase project URL and public client key. |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Trusted kiosk upload authorization, Reklamo generation, prediction writes, SMS queue/worker calls. Never use `NEXT_PUBLIC_`. |
| `KIOSK_PUBLIC_ORIGIN` | server only | Stable **HTTPS origin**, with no path, credentials or query (e.g. the production custom domain). Required for production evidence and status QR codes. |
| `ML_SERVICE_URL`, `ML_API_KEY` | server only | HTTPS base URL and matching secret of a separately deployed FastAPI inference service. Never use localhost on Vercel. |
| `ML_REQUEST_TIMEOUT_MS` | server only, optional | Integer 500–60000. Default remains 3500 ms. Set only after measuring staging response and cold-start latency. |
| `KIOSK_SMS_ENABLED`, `KIOSK_SMS_DISPATCH` | server only, optional | Set `KIOSK_SMS_ENABLED=0` until the database and worker are configured. With no flag the existing SMS implementation is enabled. |
| `KIOSK_SMS_FUNCTION_URL` | server only, optional | Supabase Edge Function URL override; normally derived from the Supabase URL. |
| `CRON_SECRET` | server only, optional | Required only if choosing Vercel cron for `/api/kiosk/sms/sweep`. |

Preview deployments use the platform-provided `VERCEL_URL` over HTTPS when
`KIOSK_PUBLIC_ORIGIN` is absent. Scope the stable production origin to the
Production environment only; a Preview override must name its **own** HTTPS
origin or its QR links would send citizens to the wrong deployment. Production
deliberately requires an explicitly
configured stable origin: a temporary deployment URL must not be printed on a
citizen's permanent tracking receipt. Local `npm run dev` still selects the
hotspot IPv4 using `scripts/start-kiosk-local.mjs`; it ignores the production
origin and retains the local phone QR workflow.

Configure Supabase Auth's production Site URL and allowed redirect URLs in the
Supabase dashboard. Do not assume they follow the Vercel hostname automatically.

## ML deployment and readiness

Deploy `ml-backend/` as a **separate** FastAPI service reachable by the Vercel
web functions over HTTPS. A provider-neutral `ml-backend/Dockerfile` is available
for platforms accepting containers (`docker build -t scbms-ml ml-backend`). It
intentionally fails to build if the original `models/metadata.json`,
`models/broad_classification_svm.joblib`, or
`models/specific_category_svm.joblib` is absent. These model artifacts are
ignored by Git; stage trusted copies securely in the ML build context. Do not
substitute samples, retrain during deployment, or place model artifacts in a
public Next.js asset folder. The container uses `PORT` (default 8000); place it
behind an HTTPS ingress and configure `ML_API_KEY` in the ML service.

Vercel also supports a separately configured Python/FastAPI project rooted at
`ml-backend/`; its packaging, model inclusion and cold-start behavior **must**
be checked on that deployment before selecting it as the host. A production
Next.js deployment does not start `uvicorn`. Validate the deployed service's
`GET /health` returns `models_loaded: true` and `status: ok`. An authorized
`POST /api/ml/predict` requires `X-ML-API-Key`; the web app alone holds this
key, and the model only returns suggestions. Verify deployed model version and
labels with authenticated `/api/ml/model-info`. On this developer machine the
two original artifacts loaded in 8.155 s; two warm inferences took 0.0025 and
0.0015 s. These are **not** remote cold-start or network measurements. Measure
the staging web-to-ML response before choosing `ML_REQUEST_TIMEOUT_MS`.

The read-only action-ladder check found existing case `AB-2026-0051` with a hearing and
route but `current_status = 'For Official Categorization'`. The ladder now
offers review of the recorded categorization rather than a disposition action
that this stage cannot perform. It does **not** rewrite that case's data; an
authorized official must reconcile its status through the existing workflow.
The case-scanning part of `npm run test:actions` is now opt-in with
`TEST_ACTIONS_LIVE_READ=1` on an approved test project; the default test run
does not read existing resident cases.

The saved model was produced using scikit-learn 1.7.2; verify runtime library
compatibility when packaging. A missing model leaves `/health` unavailable,
and a web request that cannot reach ML leaves a complaint intact with a pending
suggestion for authorized retry.

## Supabase inventory and document masters

Manually run the **SELECT-only** `supabase/manual/production_readiness_checks.sql`
against the intended project, then review missing objects and role privileges.
The script does not apply migrations. Check migration
`supabase/manual/35_svm_specific_prediction.sql`, other manual SQL prerequisites,
RLS policies, bucket privacy and expected master keys. Verify the actual
Supabase project and Storage, not merely local SQL files. Current Reklamo and
hearing-notice generation is programmatic; Respondent Summons and the short
Amicable Settlement form use the private `templates` bucket. The migration 35
verification script (`node scripts/apply-svm-migration.mjs --verify`) returned
the expected columns, triggers, RLS and grants for the locally configured
Supabase project during this pass; it did **not** verify other migrations or
the Vercel deployment target. The local
read-only `node scripts/verify-deployment-prerequisites.mjs` checks privacy of
three Storage buckets and presence of the two actively used masters without
downloading their contents. On the locally configured Supabase project it
reported three private buckets and both active master paths present; this does
not compare template revisions or prove the Vercel environment points at the
same project. The local
`scripts/upload-master-templates.mjs` only uploads the older Notice master; it
does **not** provision the current summons and settlement keys. Upload those
exact, approved originals manually under the keys in
`lib/documents/docxTemplate.js` if absent, then verify an authorized officer can
download/generate them. Never replace a live master without comparing its
contents to the approved original. Resident Reklamo generation also requires
the `documents` bucket and server-only service-role key.

Before enabling the signed kiosk upload path in production, review and apply
`supabase/manual/kiosk-10-verified-evidence-link.sql` to the intended project.
It adds a BEFORE INSERT guard for kiosk evidence so a direct RPC caller cannot
link a missing or size/MIME-mismatched Storage object by naming a manifest ID.
Test against your deployed Storage version in staging first: the guard expects
Storage object metadata to include `size` and `mimetype`. This SQL file was
**not** applied by this code change. Until it is applied and validated, the
database-side integrity requirement remains a deployment blocker.

## Kiosk files, offline behavior and SMS

Phone uploads now call small same-origin sign/complete routes. The validated QR
session RPC chooses the storage path and issues a non-upsert, path-scoped signed
upload token. The phone sends its 10 MB-or-smaller file **directly to the private
Supabase Storage bucket**, bypassing Vercel's 4.5 MB function body limit. The
completion route checks the active QR session, matching manifest, stored size
and MIME before acknowledging success. Supabase's signed upload token itself
lasts up to two hours; only the original 10-minute QR session can produce a
valid manifest or confirm/link evidence. An upload attempted after session
expiry is not associated with a complaint and may need orphan cleanup. Keep
the existing `kiosk_cleanup_expired_uploads()` maintenance process. The older
`/api/kiosk/upload/direct` route remains for compatibility; do not send large
files through that route on Vercel. Configure allowed Supabase Storage CORS
for the production/preview origins if the project has customized its defaults.

Offline entries live in **encrypted browser IndexedDB**, not SQLite or Vercel
storage. The service worker and in-page retry preserve existing idempotent
submission. Background Sync is browser-dependent; do not promise a closed
browser will always sync. A new preview hostname has its own browser origin
and therefore a different local queue.

The PhilSMS worker is a separate Supabase Edge Function with
`PHILSMS_API_TOKEN` and `PHILSMS_SENDER_ID` set in its environment, not in the
Next.js public environment. Apply and verify SMS-outbox SQL and deploy the
worker separately before enabling SMS. Choose **one** recovery scheduler:
Vercel cron with `CRON_SECRET` and a reviewed `vercel.json` schedule, or the
Supabase pg_cron/pg_net option documented in
`supabase/manual/kiosk-09-sms-sweeper-cron.sql`. No scheduler has been added
automatically; Vercel Hobby does not support the documented five-minute cron
frequency. A queued SMS is not proof of delivery.

## Staging acceptance (UNVERIFIED until performed)

Use isolated test accounts/cases, never production resident records. Verify
the local code contracts with `npm run test:deployment`; this does not exercise
live Storage, Vercel or cross-role permissions. Verify
each role's allowed and denied routes (resident, captain, OIC, secretary,
Lupon-assigned and unassigned cases, PNP-assigned and unassigned referrals).
Test resident registration/sign-in and Supabase redirect URLs; complaint,
Reklamo, notice, summons and settlement storage; official broad/specific
classification including an interrupted specific-category save. Check kiosk
upload QR and tracking QR on a real phone, invalid/expired tokens, unrelated
session IDs, and files of 100 KB, 1 MB, 4 MB, 5 MB, 9 MB, 10 MB and >10 MB.
Confirm each success against both Storage and the manifest, and check retry
without duplicate evidence. Repeat with the network offline, reconnect, and
two interrupted sync attempts. Verify the SMS queue and worker with approved
test recipients before enabling live sends; confirm the selected retry
scheduler works. None of those live/physical checks was executed by adding
this guide.

## Change log for this deployment-stabilization pass

| Path | Change |
| --- | --- |
| `proxy.ts` (formerly `middleware.ts`) | Next.js 16 file convention; same session-update function and matcher. |
| `lib/mlPredictionRequest.mjs`, `lib/mlPrediction.js`, `scripts/test-ml-integration.mjs` | Configurable bounded ML timeout and failure tests; same default and result contract. |
| `lib/kiosk/origin.mjs`, `lib/kiosk/lan-origin.js`, `scripts/test-kiosk-origin.mjs` | HTTPS production/preview QR origin with unchanged local LAN path. |
| `app/api/kiosk/upload/sign/route.js`, `app/api/kiosk/upload/complete/route.js`, `lib/kiosk/signedUpload.js`, `app/kiosk/upload/[uploadToken]/page.jsx`, `lib/kiosk/sync.js` | Scoped direct-to-Storage upload and post-upload verification. |
| `app/api/kiosk/upload/direct/route.js` | Document its retained small-file compatibility role; its handler is unchanged. |
| `components/captain/complaints/CategorizationTab.jsx` | Recognizes partial save and retries only the missing specific confirmation. |
| `components/captain/complaints/classificationSave.js`, `scripts/test-classification-save.mjs` | Tested interruption and idempotent retry coordination without altering DB permissions. |
| `components/resident/NewComplaintForm.jsx` | Reports unsuccessful evidence attachments and uses the actual attached count. |
| `lib/captainComplaintWorkflow.js`, `scripts/test-actions.mjs` | Stop an inconsistent stored categorization stage from offering an impermissible outcome; regression check and opt-in live-data scan. |
| `.gitignore`, `.env.example` | Keep credential files ignored; document placeholder-only deploy settings. |
| `ml-backend/Dockerfile`, `ml-backend/.dockerignore` | Provider-neutral separate inference packaging without retraining. |
| `supabase/manual/production_readiness_checks.sql`, `docs/VERCEL_DEPLOYMENT.md` | Read-only inventory queries and external deployment/staging instructions. |
| `supabase/manual/kiosk-10-verified-evidence-link.sql` | Additive, unapplied database guard for kiosk evidence linking. |
| `README.md` | Entry point to this deployment checklist. |
| `package.json` | Reproducible deployment-contract test command; no dependency changes. |
| `scripts/verify-deployment-prerequisites.mjs` | Read-only Supabase bucket/master metadata inspection. |
