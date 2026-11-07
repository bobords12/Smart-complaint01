# Supabase Setup Guide

## Prerequisites

1. A Supabase project (https://supabase.com)
2. Node.js 18+ installed
3. npm or yarn package manager

## Step 1: Configure Environment Variables

Edit `.env.local` in the project root and fill in your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

Find these values in your Supabase Dashboard under **Settings > API**.

## Step 2: Create Database Tables

1. Go to your Supabase Dashboard
2. Navigate to **SQL Editor**
3. Open each SQL file from `supabase/manual/` in order (01 through 16)
4. Execute each file by pasting the contents into the SQL Editor and clicking **Run**

**Execution order:**
1. `01_extensions_and_enums.sql`
2. `02_profiles.sql`
3. `03_resident_profiles.sql`
4. `04_complaints.sql`
5. `05_evidence.sql`
6. `06_case_statuses.sql`
7. `07_hearings.sql`
8. `08_kp_trackers.sql`
9. `09_kp_phases.sql`
10. `10_notifications.sql`
11. `11_case_inquiries.sql`
12. `12_resident_settings.sql`
13. `13_complaint_classification_logs.sql`
14. `14_complaint_reviews.sql`
15. `15_rls_policies.sql`
16. `16_functions_and_triggers.sql`

**Files applied after 16** (also in `supabase/manual/`, in this order):

17. `17_avatar_bucket_setup.sql`
18. `18_add_first_login_completed.sql`
19. `19_add_dark_theme.sql`
20. `20_complaints_case_viewer.sql`
21. `21_fix_captain_identity.sql`
22. `22_admin_monitoring_pages.sql`
23. `23_staff_assisted_complaint_filing.sql` — required for the Captain "Encode Complaint" form
24. `captain-portal-schema-additions.sql`
25. `official-rbac-oic-secretary.sql`
26. `captain_workflow_categorization_stage.sql` — adds the `For Official Categorization`
    complaint status so the staged workflow can pause for the official category
    and urgency decision. Without it, receiving a complaint fails on an unknown
    enum value. Non-destructive and safe to re-run.
27. `reklamo-form-document-workflow.sql` — required for the official Reklamo Form
    workflow. Adds `barangay_case_number`, `official_received_at`, `received_by` and
    `desired_relief` to `complaints`; adds the `submission_receipt`, `reklamo_form` and
    `signed_reklamo_form` document types plus `document_status`, `version`, `generated_at`,
    `generated_by`, `signed_at` and `content_snapshot` to `official_documents`; installs
    the `receive_complaint_official()`, `record_submission_receipt()` and
    `set_complaint_desired_relief()` RPCs; replaces the over-broad
    "Residents read visible documents" policy with a complaint-scoped one; and adds
    resident read and upload policies for the private `documents` bucket. It also widens
    `official_documents.document_type` to include the four types the Captain DocumentsTab
    upload picker already offered but the old CHECK rejected.

    Order matters: run 26 first, then 27, because `receive_complaint_official()` writes
    the `For Official Categorization` status from 26. The file ends with a verification
    query that should return only `ok`, and a second query that should return zero rows.
28. `lupon-member-portal-and-pangkat-rls.sql` — required for the Lupon Member Portal.
    Adds `secretary` to the `lupon_panels.role` CHECK, creates `pangkat_trackers`,
    `pangkat_extensions`, `hearing_minutes` and `case_outcomes`, widens
    `hearing_attendances` with `attendance_status` / `excuse_reason` / `recorded_at`,
    and installs the `lupon_*` RPCs plus assignment-scoped RLS for complaints,
    hearings, attendance, minutes, outcomes, documents, evidence and Storage.

    **Destructive statement:** this is the only file in the project that deletes rows.
    It removes duplicate `hearing_attendances` rows where two rows record the same
    attendee at the same hearing, keeping the earliest, and reports the count with a
    `RAISE NOTICE`. It must do so before creating the one-row-per-attendee unique
    constraint, so both steps are in the same block. Everything else is additive and
    safe to re-run.

    Run 28 **last**, after 25 (`official-rbac-oic-secretary.sql`) has added `lupon` to
    the `app_role` enum, and after 27, because the Lupon policies and Storage rules
    build on the Reklamo document columns and policies.
29. `29a_hearing_status-held-enum.sql` — run this **before** 29b. A single statement that
    adds `'Held'` to the `hearing_status` enum. It is its own file because PostgreSQL will
    not let an enum value added in a transaction be used by any statement in that same
    transaction, and 29b assigns `status = 'Held'`. Let this file commit before
    continuing. Additive and idempotent.
29. `29b_captain-hearing-casework.sql` — the Captain mediation lifecycle. Run after 29a and
    after 28. Adds `hearings.cancel_reason` / `rescheduled_from_id` / `rescheduled_to_id`;
    turns `hearing_minutes` into the Meeting Record with `conducted`, `outcome`,
    `outcome_explanation` and `document_id`; adds
    `summons_service_records.acknowledged_on` / `acknowledged_by`; widens the
    `attendance_status` CHECK to accept `'Not recorded'`; allows `'viewed'` as a document
    lifecycle event; installs the `hearings_guard_lifecycle()` trigger; and creates the
    `captain_save_meeting_record()`, `captain_record_attendance()`,
    `captain_reschedule_hearing()` and `captain_cancel_hearing()` RPCs.

    Additive and idempotent; no table, column, index or policy is dropped. Two notes:

    - The attendance CHECK accepts **both** `'Not recorded'` and the legacy `'Not Recorded'`
      written by migration 28's `lupon_record_attendance()`. Narrowing it to one spelling
      would break the Lupon write path, so existing rows are left exactly as they are and
      the reading layer treats the two as the same state.
    - The optional SECTION J backfill converts legacy `'Completed'` hearings to `'Held'`
      **only** where a meeting record already says the meeting was conducted. The old
      Captain flow set `Completed` as a side effect of saving attendance, so those rows are
      not evidence a meeting happened. Run J1 and J2 as separate statements after the file
      has committed; J2 reports what was deliberately left behind.

Optional: `user-theme-preference.sql`, `fix-resident-settings-theme-constraint.sql`,
`pnp-referral-requests.sql`. Repairs: `90_repair_missing_profiles.sql`,
`99_fix_circular_rls_profiles.sql`. Check: `99_verification_queries.sql`.

## Step 2b: Register Lupon Members

`lupon-member-portal-and-pangkat-rls.sql` creates the portal but creates no accounts.
There is **no public Lupon registration**: a Lupon member is a real person with a real
Supabase Auth account, and the only thing that makes them a Lupon member is their role
in `public.profiles`.

To add someone:

1. Create their account the normal way. Either have them self-register through
   `/register` (which creates a resident account), or create the user in
   **Authentication → Users**. Either way an `auth.users` row now exists.
2. Run `register-lupon-member-profiles.sql` in the SQL Editor and paste their existing
   `auth.users.id` UUID into the seed block at the top, which is commented out by
   default so the file is safe to run as-is.

The script:

- **never writes to `auth.users`** and never sets or reads a password. It creates no
  accounts; it only decides who gets the `lupon` role. The person must still be able
  to sign in, so give them a password in **Authentication → Users** or have them use
  "Forgot password" on `/login`.
- validates every UUID against `auth.users` **before** changing anything, so a typo
  aborts the whole run instead of promoting half the list.
- refuses to touch a UUID that belongs to the Captain, OIC or Secretary, so nobody is
  demoted out of an official portal by accident.
- sets `role = 'lupon'` and `account_status = 'active'` together, because a member with
  the role but a non-active status cannot sign in to `/lupon` at all.

The seed `INSERT` in Section A is commented out, so running the file unchanged changes
nothing and tells you so in a `NOTICE`.

**Active membership is required.** A profile with `account_status <> 'active'` cannot
sign in to `/lupon` at all, and every Lupon RLS policy requires an active account as
well as an active `lupon_panels` row. A member who is suspended, disabled, or whose
panel row is set to `replaced` or `removed` loses access to the portal immediately,
without needing any policy to be edited.

3. Assign them to a case in the Captain portal at `/captain/lupon-panels`. A case needs
   exactly one active **Chairperson** and, to use the minutes workflow, one active
   **Secretary**. Both are enforced by a partial unique index, so a second active
   holder cannot be created.

## Step 3: Create Storage Buckets

In the Supabase Dashboard, go to **Storage** and create these buckets:

| Bucket Name | Public | Purpose |
|-------------|--------|---------|
| `evidence` | No | Complaint evidence files |
| `avatars` | Yes | User profile photos |
| `summons` | No | Official summons documents |

For each bucket:
1. Click **New Bucket**
2. Enter the bucket name
3. Set public/private as indicated
4. Click **Create Bucket**

## Step 4: Verify Setup

Run the verification queries from `supabase/manual/99_verification_queries.sql` to confirm all tables and functions exist.

## Step 5: Test the Application

```bash
npm run dev
```

Visit `http://localhost:3000` and test:
1. Register a new resident account
2. Log in with the new account
3. File a complaint
4. View complaint details
5. Check notifications
6. Update profile and settings

## Troubleshooting

### "relation does not exist" error
Ensure you ran all SQL files in the correct order.

### "permission denied" error
Check that RLS policies are properly set up in `15_rls_policies.sql`.

### "bucket not found" error
Create the missing storage bucket in the Storage dashboard.

### Auth errors
Verify your `.env.local` has the correct Supabase URL and anon key.

## Project Structure

```
lib/supabase/
  client.ts        # Browser Supabase client
  server.ts        # Server-side Supabase client (cookies)
  middleware.ts    # Middleware client for session refresh

repositories/
  profileRepository.ts      # Profile CRUD + avatar
  complaintRepository.ts    # Complaint CRUD + evidence
  notificationRepository.ts # Notifications
  referralRepository.ts     # PNP referral requests
  settingsRepository.ts     # Resident settings

services/
  authService.ts   # Auth operations (login, register, logout)

context/
  AuthContext.tsx   # React auth context (Supabase-based)

middleware.ts       # Route protection middleware
```
