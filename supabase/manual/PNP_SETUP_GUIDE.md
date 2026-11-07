# PNP Coordination Portal — Setup Guide

The PNP portal is created by six manual SQL files plus one account. Nothing in
this list is created automatically, and no file in this list creates a user, a
credential, or a seeded station. You type in the real-world data yourself.

Apply the files **in order**. Each one checks its own prerequisites and refuses
to finish if they are missing, so a mistake stops where it happens rather than
half-creating the portal.

---

## 1. Prerequisites

Back up the database first (Supabase Dashboard → Database → Back up, or `pg_dump`).

These must already be applied. If any is missing, apply it first:

| File | Why the PNP portal needs it |
| --- | --- |
| `01_extensions_and_enums.sql` | `app_role`, `account_status` enums |
| `02_profiles_and_roles.sql` | the `profiles` table every portal reads |
| `08_notifications.sql` | notification delivery to residents and officers |
| `pnp-referral-requests.sql` | the resident's request to ask for a PNP referral |
| `15_storage_policies.sql` | the private `evidence` bucket's existing policies |

Optional, but the referral tab is much better with them:

| File | Effect if missing |
| --- | --- |
| `captain-complaint-routing-workflow.sql` | no respondent/KP gate, so referral eligibility is not enforced in the UI |
| `captain-portal-schema-additions.sql` | no `log_activity(...)`, so referral actions are not written to the audit log |

The referral files check for `log_activity` and the routing columns. If they are
absent, the RPCs raise a clear error naming the missing migration rather than
silently skipping the audit trail.

---

## 2. Apply the six files

Supabase Dashboard → **SQL Editor** → new query → paste the whole file → **Run**.

In this order:

1. `pnp-portal-01-role-and-profile-support.sql`
   Adds the `pnp_officer` role, the officer's profile extension, the unit
   tables, `is_pnp_officer()`, and the notification link. Leaves
   `pnp_portal_units` **empty** on purpose.
2. `pnp-portal-02-referral-schema.sql`
   Creates `complaint_referrals`, `complaint_referral_evidence`,
   `complaint_referral_updates`, `pnp_referral_assignments`, and the
   `referral_status` enum. No browser policy and no RPC yet.
3. `pnp-portal-03-referral-functions.sql`
   Every `pnp_*()` RPC. All referral writes go through these; the tables have no
   INSERT/UPDATE/DELETE policy at all, so a direct write from the browser is
   refused by the database.
4. `pnp-portal-04-referral-rls.sql`
   The read policies. PNP reads are narrowed to the referrals assigned to them.
5. `pnp-portal-05-storage-access.sql`
   Evidence read access in the `storage.objects` bucket. Read-only: the PNP is
   given a SELECT policy and explicit denied INSERT/DELETE policies. It is never
   given an UPDATE policy.
6. `pnp-portal-06-verification-queries.sql`
   Read-only checks. Run it last and read the output; it is a report, not a
   change.

### A note on file 01 and transactions

`ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on older
PostgreSQL, so file 01 commits the enum change on its own. Run it as a plain
script in the SQL Editor, which does exactly that. Every file is safe to re-run.

---

## 3. Create the PNP officer account

PNP accounts are made in the Supabase Dashboard. There is no self-registration
anywhere in this application, and a PNP officer cannot create another.

1. **Authentication → Users → Add user**
   - Email and password: set a real one. Do not reuse a demo password.
   - Tick **Auto Confirm User** so the officer is not locked out by an unverified
     email.
2. **SQL Editor**, insert the profile and mark it a PNP officer:

   ```sql
   INSERT INTO public.profiles (id, display_name, role, account_status)
   VALUES (
     '<the user id from step 1>',
     'Officer Name',
     'pnp_officer',
     'active'
   );
   ```

   If the project separates first/last names, use the same columns your other
   profiles use instead — this file is a template, not a fixed schema.

3. **Optional but recommended**, the PNP-specific details:

   ```sql
   INSERT INTO public.pnp_officer_profiles
     (id, rank, unit_name, station_name, personnel_number, contact_number)
   VALUES (
     '<the user id>',
     'Police Sergeant III',
     'Community Relations Unit',
     'Barangay Police Station',
     '2024-00000',
     '09XX XXX XXXX'
   );
   ```

   This row is optional. Without it the officer works normally and simply has no
   rank or unit shown. Do not invent these values — they are real-world facts, so
   leave a field `NULL` rather than filling in a placeholder.

---

## 4. Add real units, then officers to them

`pnp_portal_units` is created empty by file 01. Add the real ones:

```sql
INSERT INTO public.pnp_portal_units (unit_code, unit_name)
VALUES ('CRU', 'Community Relations Unit')
ON CONFLICT (unit_code) DO NOTHING;
```

Then put an officer in a unit, so the assignment dialog can filter by it:

```sql
INSERT INTO public.pnp_officer_units (officer_id, unit_id)
VALUES (
  '<officer id>',
  (SELECT id FROM public.pnp_portal_units WHERE unit_code = 'CRU')
)
ON CONFLICT DO NOTHING;
```

An officer with no unit row can still be assigned a referral, just without a unit
label. That is the safe default for a new account, so it is not an error.

---

## 5. Refer a case

The referral is created from the complaint, not from the PNP portal.

1. Sign in as the **Barangay Captain** or the **Officer-in-Charge**.
2. Open a complaint → the **PNP Referral** tab.
3. The tab shows why a referral is or is not possible:
   - A **KP-applicable** case is refused. Mediation applies, not a referral.
   - A case with a **named respondent and KP applicability not yet assessed** is
     refused. Record the assessment in Routing Assessment first.
   - A case with an **open referral** offers the existing referral instead of a
     second one.

### If the resident asked for the referral

Approving and referring are **two separate steps**, and the order is enforced by
the database, not by the UI.

1. Click **Approve request** on the resident's request and record your decision.
   This writes `status = 'approved'` to `pnp_referral_requests`.
2. The request row then offers **Create referral from this request**. Write the
   summary, record the reason, tick the evidence, and create the referral.

`pnp_create_referral()` refuses a request that is still `pending_review`:

```
IF v_request.status NOT IN ('approved', 'officially_referred') THEN
  RAISE EXCEPTION 'The resident request is still "%". Approve it first, ...'
```

The request statuses are `pending_review`, `more_information_required`,
`approved`, `declined`, `officially_referred`, `completed`, `cancelled`. Note
`pending_review`, not `pending`. If you are writing your own queries, use the
names in `REFERRAL_REQUEST_STATUSES` in `lib/pnpReferral.ts`.

Approving first is also what keeps the resident's notifications truthful: they
are told their request was approved, and only afterwards that the case was
formally referred.

### Creating the referral

Write the summary the PNP will read, record the reason, and tick only the
evidence files you intend to share. Nothing is shared by default.

Assign a PNP officer. Reassigning releases the previous officer
**immediately**.

The PNP officer sees the referral at `/pnp/dashboard` as soon as it is assigned.
Before assignment it is invisible to them: `pnp_referral_is_visible()` is the
single gate used by every PNP read policy and by the evidence bucket policy.

---

## 6. Verify

Run `pnp-portal-06-verification-queries.sql` and read each section:

| Section | What a healthy database says |
| --- | --- |
| Tables and functions | every object exists |
| Referral status values | all 9 statuses are present in the enum |
| RLS enabled | every referral table has RLS on |
| Policy inventory | exactly the named policies, one per table per audience |
| PNP row isolation | a PNP officer sees only assigned referrals |
| Assignment integrity | no referral has two active officers |
| Storage policies | one PNP SELECT policy, zero PNP INSERT/UPDATE/DELETE |
| Evidence sharing | every shared file belongs to its complaint |
| Timeline integrity | no timeline row without an author |
| Unassigned referrals | any row listed is legitimate backlog, not a leak |

The isolation sections must be run **as the PNP officer's own session** to be
meaningful. Run them as an admin and every table looks fully visible, which
proves nothing about the PNP.

### Manual checks worth doing once

- Sign in as the PNP officer. An unassigned referral URL must render "not
  available" — the same message as a referral that does not exist, so the portal
  cannot be used to test whether a referral id is real.
- Open a shared evidence file. The link is a short-lived signed URL. Copy it and
  open it after two minutes: it must be dead.
- Release an officer mid-referral. Their access ends on save, without a page
  reload, and the assignment history is kept.
- Confirm a PNP officer cannot reach `/captain`, `/lupon`, or a resident's
  complaint, by URL as well as by navigation.

---

## 7. What a PNP officer can never see

This is enforced by policies, not by hiding buttons. Use the verification
queries to confirm it, and treat any row that shouldn't be visible as a security
defect rather than a UI bug.

| Never visible to the PNP | Why |
| --- | --- |
| The complainant's full narrative | the referral summary is the deliberate minimum |
| Internal notes and their reasons | barangay-only, no PNP read policy exists |
| Resident referral requests | a pending request must not influence PNP handling |
| Complaints, blotters, KP trackers, summons, hearings | the barangay keeps its own case file |
| Lupon panels and minutes | a different workflow with a different audience |
| Evidence that was not explicitly shared | sharing is per file, never by default |
| Another officer's assignments or referrals | the roster is a general read and is refused |
| A referral that is not assigned to them | `pnp_referral_is_visible()` |

A referral reference like `PNP-REF-2026-000001` is an **internal coordination
reference**. It is not a police blotter number and not an official police
record. The PNP portal records that coordination happened; it does not record a
police finding, and no page in it should imply otherwise.
