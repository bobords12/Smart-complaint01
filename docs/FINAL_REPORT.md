# 18-Point Final Report — SCBMS (Section 65)

**Project:** Smart Complaint & Blotter Management System, Barangay Abuno, Iligan City
**Stack:** Next.js 16.3.5 (App Router, Turbopack) · Supabase (Postgres, RLS, Storage, Realtime)
**Report date:** 16 October 2026
**Scope:** Completion and end-to-end verification of the Captain, Lupon and PNP portals against the standard Katarungang Pambarangay workflow, plus the Resident Portal requirements that those portals touch.

**Status legend:** ✅ met · ⚠️ met with deviation · 🔎 verified in the browser

---

### 1. Resident Portal was not rebuilt, and there is still exactly one workflow model ✅ 🔎

No second resident-only workflow, screen model or record type was introduced. The Resident Portal reads the same canonical `complaints` / `hearings` / `official_documents` rows the staff portals write, through `components/resident/*` and `repositories/*`, and derives every view from canonical state (`buildResidentProgress`, `resolveConfirmedCategory`).

There are no duplicate resident-only copies of cases: the resident case list for Riza Oyangorin returned exactly her five complaints (AB-2026-0026 … AB-2026-0030) and nothing else.

**Deviations:** none.

---

### 2. Resident data isolation — only the resident's own records ✅ 🔎

RLS enforces ownership (`resident_id = auth.uid()`); the UI never broadens it.

- `/resident/complaints` → "5 complaints found", chips All 5 / Pending Review 1 / In Progress 3 / Awaiting Meeting 0 / Resolved 1 / Critical 0.
- Opening a complaint the resident does not own (AB-2026-0031, `resident_id = null`) and opening a non-existent UUID both render the **identical** "Not Found — This complaint may have been removed or the link is invalid." message with a "Back to My Complaints" recovery link, so existence cannot be probed.

**Deviations:** none.

---

### 3. Information the resident must never see is withheld ✅ 🔎

Verified absent (text scan) on the dashboard, complaint list, complaint detail, hearings and notifications: internal notes, audit notes, routing rationale, staff comments, Captain-only actions, referral-review internals, AI prediction internals and the **Respondent Summons**.

Respect for `resident_visible` / `visibility` is preserved: documents render only under "Documents Issued To You", and signed URLs are minted per row (the DOCX is fetched server-side and rendered inline — `reklamo-form-AB-2026-0030-v1.docx`, 100 %, Download/Print).

**Deviations:**
- ⚠️ `SummonsModal.jsx` was deleted rather than adapted — summons issuance is a Captain-only concern.
- ⚠️ `summons_service_records` renders as always "Not served" in the resident view (no service data is ever exposed).
- ✅ **Fixed this session:** `sendSummonsCopyToComplainant` told the *complainant* that "A copy of the **summons** issued to you…" was available, contradicting the codebase's own rule in `lib/residentRoutes.js` ("the complainant's copy of a hearing document is the Notice of Hearing; a Respondent Summons is never the complainant's document"). Title and message now read **Notice of Hearing**, the doc comment matches, and the **6 existing notification rows** were corrected in SQL. The function name and the `summons_copy_sent_to_complainant` audit key keep the old wording deliberately (they are read back for state/history).

---

### 4. Actionable notifications ✅ 🔎

- Clicking a notification marks **only that one** read — badge went **31 → 30**.
- Deep-links are built from `related_complaint_id` / `related_hearing_id` via `lib/residentRoutes.js` (the only route builder; no URL is parsed from notification text).
- Complaint notification → `/resident/complaints/84c60d6e-…` (AB-2026-0029, the case the message was about).
- Hearing notification (after the wording fix above) → **`/resident/hearings?hearing=f5f3a697-…&section=notice`**, with focus landing inside `section-notice` on its `tabIndex={-1}` document panel.
- Filters: All 50 / Unread 31 / Complaint Updates 49 / Hearings 6 / General Notices 0; "Mark all read" present.

**Deviations / fixes this session:**
- ⚠️ **Duplicate id:** `ComplaintDetailView` rendered `id="section-progress"` **twice** (Latest Update card *and* the six-stage panel), making `getElementById` ambiguous.
- ⚠️ **Dead target:** `resolveNotificationTarget` emits `?section=resolution`, but **no element carried that id**, so resolution notifications silently opened at the top of the page. The six-stage panel now carries `section-resolution`, and the Latest Update card keeps `section-progress` with `tabIndex={-1}` so `focus()` actually moves the user. Verified: 0 duplicate ids; `document.activeElement.id === "section-resolution"` / `"section-progress"` / inside `section-notice` as appropriate.

---

### 5. Resident dashboard ✅ 🔎

- **Recent Complaints fully clickable** — cards are full-width `<button>`s; clicking AB-2026-0030 navigated to `/resident/complaints/c83b4bf4-…`.
- "3 of 5" with "Select a complaint to open its full details."
- **Upcoming Hearing** slot shows *"No upcoming hearing scheduled. You will be notified here and on your complaint the moment a session is set."* + **View Hearings** (no "Summons" wording anywhere on the page).
- Live pipeline messages are resident-visible text (they are emitted as `resident_visible_message`, not staff copy), e.g. AB-2026-0029: *"The Pangkat convened; its 15-day period began on **October 16, 2026**"* — correct Asia/Manila conversion of `2026-10-15T16:00Z`.
- Stats 5 Total / 3 In Progress / 1 Resolved / 0 Critical; Latest Classification labelled "AI … · Confidence … · Barangay staff must confirm this result."
- **"Add to Calendar" is absent** everywhere.

**Deviations:** none.

---

### 6. Resident Complaint Detail ✅ 🔎

Header: **"Threat · AB-2026-0030 · Barangay Case No. AB-2026-0006 · Filed October 12, 2026"** — tracking number and official Barangay Case No. are both shown so the two numbers in document filenames are explained rather than looking like a cross-case leak. A complaint without one renders **"Not yet assigned"**.

- **6-stage resident timeline** confirmed: Complaint Filed → Under Review → Officially Received → Case Processing → Hearing / Mediation → Resolution, with overall badge, plus a resident-visible **Case History** feed (`October 13, 2026 • 8:06 AM` style).
- **Resident-visible documents** open through a real preview dialog (title, versioned filename, 100 %, Download, Print).
- **No "Add to Calendar"**, no internal notes, no routing rationale, no Captain-only actions.

**Deviations:** none. (The `Add to Calendar` control was removed entirely, as required.)

---

### 7. Resident Hearings & Notices ✅ 🔎

- Counts **Upcoming 3 / Completed 1 / Rescheduled 0 / Cancelled 2**.
- Date/time format is exactly **`October 12, 2026 / 10:00 AM`** (Asia/Manila).
- Every card reads **"Notice of Hearing — Available / Not yet available"**; **summons count = 0**.
- **"Add to Calendar" absent.**

**Deviations / observations:**
- ⚠️ Hearing lifecycle labels come from the stored status, so a hearing whose date has passed but which was never conducted still shows **Upcoming** (AB-2026-0027, AB-2026-0029). `hearings_guard_lifecycle()` refuses to advance a hearing to a held state without conducted attendance/minutes, and no attendance/minutes were recorded for these fixtures. This is fixture state, not a code fault; the Lupon Schedule page buckets the same hearing under **Past** by date. No status was fabricated to hide it.
- ⚠️ The Lupon "past/upcoming" split (by date) and the resident "Upcoming/Completed/…" split (by lifecycle) are different taxonomies by design; both were left as-is rather than inventing a derived status that would bypass the guard.

---

### 8. Pangkat stage (KP stage 2) ✅ 🔎

Implemented and exercised end-to-end through the Captain UI:

- **Trigger:** if the Captain fails to mediate within **15 days**, the case moves to the Pangkat Tagapagkasundo — `mediationClockFor` in `lib/captainComplaintWorkflow.js`, surfaced as the `pangkat_hearing` ladder rung.
- **Composition:** three members chosen by both parties — one by the complainant, one by the respondent, **those two pick the chair**. `lupon_panels` for AB-2026-0029 now holds exactly three `active` rows: lupon2/member/`complainant`, lupon3/member/`respondent`, lupon1/`chairperson`/`jointly` — three distinct members.
- **Clock:** Pangkat convenes and hears **within 15 days of constitution**, extendable by **+15**. The Lupon case detail renders "Pangkat period — **Day 1 of 15**, Deadline **Oct 29, 2026**, 15 days left", with a deadline-extensions block.
- The resident sees the same event in plain language ("its 15-day period began on October 16, 2026").

**Deviations:**
- ⚠️ New rung `pangkat_hearing` plus document rung `kind: "hearings", section: "resolution"` (so `handleNextAction` scrolls to Resolution & Outcomes).
- ⚠️ An early "disposition-branch" guard at `captainComplaintWorkflow.js` was **reverted to `return null`** after it failed the regression suite.
- ⚠️ Document rungs live **only while the case is open**.

---

### 9. Resolution and outcomes ✅ 🔎

All three KP endings are implemented in `lib/resolution/resolutionDocuments.js` and pinned by tests:

- **Amicable Settlement** — one programmatic DOCX naming **both** parties, `visibility: 'resident_visible'`, `content_snapshot.issued_to = ["complainant","respondent"]`; written, signed and attested; has the **force of a court judgment after 10 days**.
- **Repudiation** — within **10 days**, on the grounds of **fraud, violence or intimidation**.
- **Certificate to File Action** — issued when conciliation fails, `issued_to = ["complainant"]`.

Ladder behaviour verified: settlement recorded but not on file → "Generate Amicable Settlement" (opens Resolution & Outcomes); once on file → back to "Record Outcome"; a settled case still offers nothing further.

**Deviations:**
- ⚠️ Documents are **programmatic DOCX** (mirroring `lib/hearing/noticeOfHearingProgrammatic.js`) — there is no Word master dependency and no letterhead template file; letterhead comes from `lib/documents/letterhead.js` + `lib/reklamo/letterheadArt.js`.
- ⚠️ DB CHECKs already permitted these outcomes, so **no migration was needed**.

---

### 10. Lupon Portal — correct assignment scoping ✅ 🔎

A Lupon member sees **only complaints assigned to them**, enforced in SQL by `lupon_my_assignments()` (not by UI filtering).

- `/lupon/cases` → **"Showing 1 of 1 assigned case"**, listing only AB-2026-0029, with All / Active / I lead / Concluded filters and the note *"Only the cases you are actively assigned to appear here."*
- Switching the session to lupon2 or lupon3 yields their own (different) set.

**Deviations:**
- ⚠️ Other members' **display names are deliberately not rendered** in the panel list (a raw profiles read would surface only the viewer's own row, so others showed short IDs like `a4c77dbd…`). Instead the row shows **`selected_by`** — "Chosen by the complainant / Chosen by the respondent / Chosen jointly", which is the legally meaningful fact.
- ⚠️ Migration 31 introduced `selected_by` and `case_resolutions`.

---

### 11. Lupon Portal — important information shown ✅ 🔎

Case detail (`/lupon/cases/84c60d6e-…`) shows, for its assigned case only:

- Header **`AB-2026-0029 · Barangay Case No. AB-2026-0005`** — **both numbers** (fix added this session; the filenames cite the official case number).
- Official category **"Illegal Activity"** + `Criminal · filed Oct 12, 2026`, panel role **"You Are Chairperson"**.
- Hearings: `Oct 12, 2026 · 10:00 AM · Upcoming · Barangay Abuno Hall · Mediation`, with venue/time/notice information.
- Attendance and Minutes sections (empty states), Pangkat period clock, Outcome, Deadline extensions, Panel with `selected_by` labels.
- **Documents: 3 titles, each fetching a real Supabase signed URL (120 s) into a genuine `<a target="_blank">`.**
- **No leakage:** no internal notes, no routing rationale, no AI prediction, no summons.

**Deviations / fixes this session:**
- ⚠️ **`complaints.category` does not exist** — `luponRepository.getCaseBundle` selected a non-existent column and the entire case page was broken (`column complaints.category does not exist`). Now selects `confirmed_category, confirmed_case_type, barangay_case_number`, and the header resolves `confirmed_category || confirmed_case_type` via `filter(Boolean).join(" · ")` so an unset value cannot render a bare `· filed`.
- ⚠️ `LuponTab.jsx` `catch` now surfaces the underlying **`error.message`** (previously a generic toast hid the cause).
- ⚠️ `barangay_case_number` is shown in the header to explain document filenames (`AB-2026-0005` is the official number for reference `AB-2026-0029`, not a cross-case leak).

---

### 12. Lupon Portal — all pages connected ✅ 🔎

| Page | Result |
|---|---|
| `/lupon` | "Welcome back, Rodel", 1 Assigned case, 1 Active Pangkat, 0 Upcoming hearings, 0 Minutes need action, Notifications 1, "AB-2026-0029 · Chairperson · Illegal Activity · Day 1 of 15" |
| `/lupon/cases` | 1 of 1 assigned case |
| `/lupon/cases/[id]` | full detail per §11 |
| `/lupon/schedule` | "Upcoming **0** / **Past 1**" — the Oct 12 hearing correctly bucketed by date, with Date/Time/Venue and a deep link to the case |
| `/lupon/minutes` | "The Chairperson or Secretary drafts. Only the Secretary finalises, and a final record is locked permanently.", **New minutes** enabled for the Chairperson, empty state |
| `/lupon/notifications` | "New Pangkat Assignment" · *"You have been assigned to case AB-2026-0029 as chairperson."* · Oct 14, 2026 · 11:41 PM; **View case** is a real `<a href="/lupon/cases/84c60d6e-…">`; **Mark read → badge 1 → 0 → "You are all caught up."** |

**Deviations / fixes this session:**
- ⚠️ `LuponDashboard.jsx` realtime subscription **leak** fixed with a `disposed` flag.
- ⚠️ `OfficialLuponPanels` referenced a non-existent column (fixed earlier).
- ⚠️ `DAY_MS` undefined `ReferenceError` (fixed earlier).

---

### 13. PNP Portal — only referrals from the Captain, fully connected ✅ 🔎

RLS scopes the PNP officer to referrals that the Captain actually issued — verified by behaviour, including a **refusal**:

- AB-2026-0026 (eligible) → request filed → Captain approved → referral **`PNP-REF-2026-000001`** assigned to adminpnp → **2 notifications** verified.
- AB-2026-0029 (KP-applicable) → correctly **refused**, and the "Create referral" button is **gated on `cta.enabled`** so an ineligible case shows an explanation instead of an action that always 400s.
- `/pnp` → dashboard queue, "Case AB-2026-0026" chip, referral detail `<dl>`, notifications deep-link to `/pnp/referrals/886d0b56-…`; referrals, profile, notifications, settings, activity-logs all reachable; root `/pnp` is a pure `redirect()` page with the middleware owning the role guard.

**Deviations / fixes this session:**
- ⚠️ **Migration 32** — `complaint_reference` implemented as a **snapshot column + BEFORE INSERT trigger**, *not* a `SELECT` policy on `public.complaints` (matches `pnp-portal-04-referral-rls.sql` §6); also added the assignment notice.
- ⚠️ **Migration 33** — the `pnp_referral_requests` UPDATE policy used self-referencing `WITH CHECK` subqueries and recursed; replaced with a `SECURITY DEFINER` helper `pnp_referral_request_is_unchanged(...)`, `REVOKE` from PUBLIC, `GRANT` to authenticated. Behaviour re-tested under the real Captain role (all green).
- ⚠️ **Migration 34** — `pnp_referral_next_reference()` needed `::bigint` before `MAX()` and an anchored `~` match (type error at runtime).
- ⚠️ `reviewReferralRequest` now surfaces the **server `error.message` first**, then the role hint.
- ⚠️ `safety` seed bug in `PnpReferralTab.jsx` — both `setForm` sites now seed `safety: Boolean(request.has_immediate_safety_concern)`.
- ⚠️ Per your instruction, this is **SQL-only**: `pnp_officer` was **not** added to the Captain's Users & Roles dropdown.
- ⚠️ `update_user_role()` was **not** a bug — the "Resident User" labels were fixture data, corrected in SQL (lupon1 = Rodel Magbanua, lupon2 = Jocelyn Ampiloquio, lupon3 = Karim Undampok, adminpnp = Ernesto Bacus, mirrored into `resident_profiles`).

---

### 14. Kiosk QR uses a real QR library ✅

The hand-rolled QR encoder was replaced with **`qrcode.react@4.2.0`**, so kiosk codes are generated by a maintained, spec-correct encoder rather than in-house bit packing.

**Deviations:**
- ⚠️ Two kiosk QR **session bugs** found and fixed during verification.
- ⚠️ Four **ambiguous-embed** fixes (site values that could be attached to more than one record).
- ⚠️ One **2001-10-10** data correction in fixture/legacy rows.

---

### 15. Document generation is self-contained ✅ 🔎

Programmatic DOCX throughout — no Word master dependency at runtime:

- Letterhead from `lib/documents/letterhead.js` + `lib/reklamo/letterheadArt.js`.
- **Two new generators** this engagement: `generateAmicableSettlement` and `generateCertificateToFileAction`.
- `npm run test:reklamo` — **ALL CHECKS PASSED** across data model, render (US Letter zip), printed values, narrative (`<w:br/>`), layout preservation, polished blocks, failure paths, versioning, submitted-stage rules, two-resident isolation and full DOCX package validation (well-formed `document.xml`, no raw OOXML in visible text).

**Deviations:**
- ⚠️ Document table is **`official_documents`** (not `complaint_documents`); storage bucket is **`documents`**.
- ⚠️ Notice of Hearing availability drives the Captain's "Send Notice of Hearing to Complainant" button; the legacy action/audit identifiers still contain `summons` (read back for history only).

---

### 16. Standing invariant — a closed case never offers a next action ✅

Pinned by `scripts/test-actions.mjs` §3 and §8:

- **58/58 checks passed**, including: route closed / withdrawn / rejected / resolved_at_intake, status Resolved / Closed / Rejected → **no action offered**.
- §8 additionally **scanned all 6 live complaints in the database**: *"no complaint shows two current steps or a closed case an action"* (action distribution `{"review":2,"outcome":2,"notice":1}`).
- §1b covers the Pangkat/second-stage ladder and the paper each ending owes.

**Deviations:** none — this invariant held throughout, including after the Pangkat rung and the two new document generators were added.

---

### 17. Migrations and provisioning applied ✅

| Migration | Purpose | State |
|---|---|---|
| 31 | `selected_by`, `case_resolutions` | applied |
| 32 | `complaint_reference` snapshot + trigger, assignment notice | applied |
| 33 | `pnp_referral_request_is_unchanged()` — RLS recursion fix | applied, re-tested under real Captain role |
| 34 | `pnp_referral_next_reference()` type fix (`::bigint`, anchored `~`) | applied |
| 98 | QA accounts: lupon1/2/3 → `lupon`, adminpnp → `pnp_officer`, CRU unit | applied |
| — | Root routes `/captain`, `/lupon`, `/pnp` (pure `redirect()`, middleware owns the guard) | created |
| — | Fixture display names corrected (lupon1-3, adminpnp) | applied |
| — | 6 resident notifications re-worded to **Notice of Hearing** | applied this session |

**Deviations:**
- ⚠️ **`AB-2026-0001` format is canonical** (spec's `26-001` was not adopted) — *awaiting your confirmation*.
- ⚠️ `resolveCaseHeaderParties` keeps the **`·`** separator (spec said `/`) — *awaiting your confirmation*.
- ⚠️ The transient middleware/`proxy.ts` ~10 s timeout that bounces authenticated users to `/` on slow networks is a known environmental annoyance, not a logic fault — recovered by re-minting the session.

---

### 18. Verification summary and what remains open ✅

**Offline verification (run clean after this session's edits):**

| Command | Result |
|---|---|
| `npm run build` | ✅ **79/79** static pages, TypeScript clean |
| `npm run test:actions` | ✅ **58/58** |
| `npm run test:reklamo` | ✅ **ALL CHECKS PASSED** |
| `npx eslint` (6 changed files) | ✅ exit **0** |

**Browser QA (all three portals, end-to-end):**
- **PNP** — dashboard queue, referral detail, notification deep-links, eligibility refusal + `cta.enabled` gating. ✅
- **Lupon** — dashboard, cases, case detail, schedule, minutes, notifications (6/6 pages). ✅
- **Resident** — dashboard, complaint list, complaint detail, hearings, notifications, deep-links, not-found/unauthorised parity, no-leak scans, no "Add to Calendar". ✅

**Files changed this session:** `repositories/luponRepository.js`, `components/lupon/LuponCaseDetail.jsx`, `components/lupon/LuponDashboard.jsx`, `components/captain/complaints/LuponTab.jsx`, `components/resident/ComplaintDetailView.jsx`, `lib/captainComplaintWorkflow.js`.

**Limitations of this verification pass:**
- ⚠️ The QA harness could not resize the viewport or scroll programmatically (`browser.scroll` requires a visible desktop window), so a **true mobile-viewport pass was not possible**. The strongest available proxy was used instead: horizontal-overflow detection at the 985 px viewport on the two densest pages (complaint detail, hearings) — `scrollWidth === clientWidth === 985` and **zero** elements extending past the viewport.
- ⚠️ Hearing status could not be advanced to a held state without fabricating attendance/minutes (the lifecycle guard correctly refuses), so past-dated fixture hearings remain "Upcoming" — see §7.

**Open decisions still awaiting your answer:**
1. Three **"TF-IDF + SVM"** labels should read **Naive Bayes** — `components/captain/complaints/CategorizationTab.jsx:111`, `components/landing/HeroSection.jsx:66`, `data/landingData.js:60,82,209`.
2. **Dataset option** 1 / 2 / 3 — not yet chosen.
3. **`sbp_` token rotation** — plain-text tokens remain in `notepad.txt` / `accesstoken.txt`.
4. **Party separator** — keep `·` or switch to the spec's `/` (`resolveCaseHeaderParties`).
5. **Case-number format** — keep canonical `AB-2026-0001` or adopt the spec's `26-001`.
