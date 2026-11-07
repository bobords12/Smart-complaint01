-- ============================================================
-- Captain Complaint Routing — VERIFICATION (READ-ONLY)
-- ============================================================
-- APPLY AFTER: captain-complaint-routing-workflow.sql
--               captain-complaint-routing-rls.sql
--
-- THIS FILE CHANGES NOTHING.
--   It contains SELECTs only. No INSERT, UPDATE, DELETE, ALTER,
--   CREATE, DROP or TRUNCATE. It is safe to run as often as you like,
--   and running it is the point: the whole value of this migration is
--   in whether the gate actually holds, and a rule you have not
--   checked is a rule you do not have.
--
-- HOW TO READ THE OUTPUT
--   Each check prints a check_name and either its expected rows or a
--   count. Where a check says "expect zero rows", an empty result is
--   the pass. Where a check says "expect N", compare against the
--   value in the comment.
--
--   The two checks worth reading most carefully are A6 and B3:
--     A6  the gate is CLOSED by default for anything filed from now on
--     B3  no policy lets a client UPDATE or DELETE the routing history
-- ============================================================

-- ════════════════════════════════════════════════════════════════
-- A. STRUCTURE
-- ════════════════════════════════════════════════════════════════

-- A1. The routing columns exist on complaints.
--     Expect 25 rows, all present = true.
SELECT 'A1 routing_columns' AS check_name,
       c.column_name,
       c.data_type,
       c.is_nullable,
       c.column_default
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name
 WHERE c.table_schema = 'public'
   AND c.table_name = 'complaints'
   AND c.column_name IN (
     'respondent_status', 'respondent_display_name',
     'respondent_identified_at', 'respondent_identified_by',
     'kp_applicability', 'kp_applicability_reason',
     'kp_applicability_legal_review',
     'routing_status', 'routing_reason', 'routing_remarks',
     'routing_decided_at', 'routing_decided_by',
     'workflow_gate_open',
     'complaint_nature', 'completeness_status',
     'completeness_complainant_verified',
     'completeness_contact_verified',
     'completeness_incident_date_provided',
     'completeness_incident_location_provided',
     'completeness_narrative_sufficient',
     'completeness_evidence_reviewed',
     'completeness_extra_info_required',
     'completeness_remarks', 'requested_information'
   )
 ORDER BY c.column_name;

-- A2. The CHECK constraints are present.
--     Expect the 9 constraints created by the workflow file.
SELECT 'A2 routing_constraints' AS check_name,
       con.conname AS constraint_name,
       pg_get_constraintdef(con.oid) AS definition
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = rel.relnamespace
 WHERE n.nspname = 'public'
   AND rel.relname = 'complaints'
   AND con.conname LIKE 'complaints_%_check'
   AND con.conname IN (
     'complaints_respondent_status_check',
     'complaints_kp_applicability_check',
     'complaints_routing_status_check',
     'complaints_identified_respondent_named_check',
     'complaints_kp_refusal_reason_check',
     'complaints_complaint_nature_check',
     'complaints_completeness_status_check',
     'complaints_completeness_nature_required_check',
     'complaints_requested_information_required_check'
   )
 ORDER BY con.conname;

-- A3. The two append-only tables AND the incident-details table exist,
--     with RLS enabled AND forced. Expect 3 rows for the append-only
--     pair (row_security = true, forcerowsecurity = true). The
--     incident table enables RLS but is not forced (the guard policy
--     still blocks direct writes to it).
SELECT 'A3 routing_tables' AS check_name,
       c.relname AS table_name,
       c.relrowsecurity  AS row_security,
       c.relforcerowsecurity AS forcerowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('complaint_routing_history', 'complaint_assistance_records',
                     'complaint_incident_details')
 ORDER BY c.relname;

-- A4. Supporting indexes exist, including the one-open-blotter rule.
SELECT 'A4 routing_indexes' AS check_name,
       tablename AS table_name,
       indexname,
       indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND (indexname IN (
          'idx_complaints_routing_status',
          'idx_complaints_respondent_status',
          'idx_complaints_gate_open',
          'idx_routing_history_complaint',
          'idx_assistance_complaint',
          'uq_blotter_active_per_complaint'
        )
        OR indexname LIKE '%routing%'
        OR indexname LIKE '%assistance%')
 ORDER BY tablename, indexname;

-- A5. The gate trigger is attached to all four party-facing tables.
--     Expect 4 rows: hearings, kp_phases, lupon_panels, summons.
--     A missing row here is the one that matters: it means summons
--     or a 15-day clock could still be started on an unassessed case.
SELECT 'A5 gate_triggers' AS check_name,
       c.relname AS table_name,
       t.tgname AS trigger_name,
       p.proname AS function_name
  FROM pg_trigger t
  JOIN pg_class c     ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p      ON p.oid = t.tgfoid
 WHERE n.nspname = 'public'
   AND t.tgname = 'trg_complaint_workflow_gate'
   AND NOT t.tgisinternal
 ORDER BY c.relname;

-- A6. The gate is CLOSED for anything filed from now on, and OPEN
--     only for the pre-existing backfill.
--     Every row here should have workflow_gate_open = true, because
--     the migration opened the gate for all complaints that existed
--     at apply time. A false row is a pre-existing complaint that was
--     closed on purpose: correct, and worth a look.
--     The default is checked separately in A7.
SELECT 'A6 gate_open_distribution' AS check_name,
       workflow_gate_open,
       routing_status,
       respondent_status,
       kp_applicability,
       count(*) AS complaints
  FROM public.complaints
 GROUP BY 1, 2, 3, 4, 5
 ORDER BY workflow_gate_open DESC, complaints DESC;

-- A7. New complaints default to a CLOSED gate. This is the single
--     most important line in this file: if the default were true, a
--     freshly filed complaint could be summoned before any official
--     assessed it.
--     Expect column_default to contain 'false'.
SELECT 'A7 gate_default' AS check_name,
       column_name,
       column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'complaints'
   AND column_name = 'workflow_gate_open';

-- A8. Internal routing notes that are inconsistent with the rules.
--     Every case here is a data problem to look at, not a schema
--     problem. Expect zero rows for a clean install.
--     * gate open but the respondent is not identified
--     * gate open but KP is not applicable
--     * KP not applicable with no reason
--     * identified with no name
SELECT 'A8 inconsistent_rows' AS check_name,
       reference_number,
       respondent_status,
       kp_applicability,
       routing_status,
       workflow_gate_open
  FROM public.complaints
 WHERE (workflow_gate_open = true
        AND (respondent_status <> 'identified' OR kp_applicability <> 'applicable'))
    OR (kp_applicability IN ('not_applicable', 'deferred_unknown_respondent')
        AND NULLIF(btrim(COALESCE(kp_applicability_reason, '')), '') IS NULL)
    OR (respondent_status = 'identified'
        AND NULLIF(btrim(COALESCE(respondent_display_name, '')), '') IS NULL)
 ORDER BY reference_number;

-- A9. Complaints with more than one OPEN blotter record.
--     Expect zero rows. Anything here predates the partial unique
--     index and needs an official decision.
SELECT 'A9 duplicate_open_blotter' AS check_name,
       complaint_id,
       count(*) AS open_blotter_records,
       string_agg(blotter_number, ', ' ORDER BY recorded_at) AS blotter_numbers
  FROM public.blotter_records
 WHERE complaint_id IS NOT NULL
   AND current_status = 'open'
 GROUP BY complaint_id
HAVING count(*) > 1
 ORDER BY complaint_id;

-- ════════════════════════════════════════════════════════════════
-- B. ACCESS CONTROL
-- ════════════════════════════════════════════════════════════════

-- B1. The routing tables are readable by officials only.
--     Expect 2 policies, both cmd = SELECT.
SELECT 'B1 routing_read_policies' AS check_name,
       tablename,
       policyname,
       cmd,
       roles
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('complaint_routing_history', 'complaint_assistance_records')
 ORDER BY tablename, policyname;

-- B2. NOBODY can update or delete the routing history.
--     This is the append-only guarantee.
--     EXPECT ZERO ROWS. Any row here is a failure: it means routing
--     history can be rewritten after the fact.
SELECT 'B2 history_is_append_only' AS check_name,
       tablename,
       policyname,
       cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('complaint_routing_history', 'complaint_assistance_records')
   AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
 ORDER BY tablename, policyname;

-- B3. Same check, from the other direction: any write policy at all
--     on either table.
--     EXPECT ZERO ROWS.
SELECT 'B3 any_write_policy' AS check_name,
       tablename,
       policyname,
       cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('complaint_routing_history', 'complaint_assistance_records')
   AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');

-- B4. Residents must not be able to read the internal routing tables.
--     EXPECT ZERO ROWS. A 'resident' role in any policy on these
--     tables would be a leak.
SELECT 'B4 resident_leak' AS check_name,
       tablename,
       policyname,
       roles::text
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('complaint_routing_history', 'complaint_assistance_records')
   AND (roles::text LIKE '%resident%' OR qual::text LIKE '%resident_id%');

-- B5. The Lupon read policy requires a cleared gate.
--     Expect 0 rows while lupon_panels is absent, or a policy whose
--     qual mentions workflow_gate_open once the Pangkat migration has
--     been applied.
SELECT 'B5 lupon_gate_policies' AS check_name,
       policyname,
       cmd,
       (qual LIKE '%workflow_gate_open%') AS requires_open_gate
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename = 'lupon_panels'
   AND policyname IN ('Lupon read own assignments', 'Officials manage lupon panels')
 ORDER BY policyname;

-- B6. The routing column guard trigger is installed on complaints.
--     Expect 1 row.
SELECT 'B6 column_guard_trigger' AS check_name,
       t.tgname AS trigger_name,
       p.proname AS function_name
  FROM pg_trigger t
  JOIN pg_class c     ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p      ON p.oid = t.tgfoid
 WHERE n.nspname = 'public'
   AND c.relname = 'complaints'
   AND t.tgname = 'trg_guard_complaint_routing_columns'
   AND NOT t.tgisinternal;

-- ════════════════════════════════════════════════════════════════
-- C. FUNCTIONS
-- ════════════════════════════════════════════════════════════════

-- C1. The routing functions exist and are executable by `authenticated`.
--     Expect 8 rows: captain_record_respondent_status,
--     captain_set_routing, captain_link_blotter_record,
--     captain_record_assistance, captain_record_completeness,
--     captain_save_incident_details, captain_create_blotter_record,
--     complaint_routing_resident_view. is_routing_official() and the
--     guard functions are also listed.
SELECT 'C1 routing_functions' AS check_name,
       p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN (
     'is_routing_official',
     'captain_record_respondent_status',
     'captain_set_routing',
     'captain_link_blotter_record',
     'captain_record_assistance',
     'captain_record_completeness',
     'captain_save_incident_details',
     'captain_create_blotter_record',
     'complaint_routing_resident_view',
     'guard_complaint_workflow_gate',
     'guard_complaint_routing_columns',
     'guard_completeness_official_writer'
   )
 ORDER BY p.proname;

-- C2. PUBLIC must not be able to execute the decision functions.
--     EXPECT ZERO ROWS. If a row appears, anyone could call the RPC
--     without logging in.
SELECT 'C2 public_execute_leak' AS check_name,
       p.proname,
       has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_execute
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN (
     'captain_record_respondent_status',
     'captain_set_routing',
     'captain_link_blotter_record',
     'captain_record_assistance',
     'captain_record_completeness',
     'captain_save_incident_details',
     'captain_create_blotter_record'
   )
   AND has_function_privilege('public', p.oid, 'EXECUTE');

-- ════════════════════════════════════════════════════════════════
-- D. LIVE CASE READOUT
-- ════════════════════════════════════════════════════════════════

-- D1. Where every complaint currently stands on the gate.
--     This is the operational view: which cases are blocked and why.
SELECT 'D1 case_gate_status' AS check_name,
       c.reference_number,
       c.current_status                        AS complaint_status,
       c.respondent_status,
       c.respondent_display_name,
       c.kp_applicability,
       c.routing_status,
       c.workflow_gate_open,
       CASE
         WHEN c.workflow_gate_open THEN 'Party steps permitted'
         WHEN c.respondent_status <> 'identified'
           THEN 'Blocked: respondent not identified'
         WHEN c.kp_applicability <> 'applicable'
           THEN 'Blocked: KP applicability not confirmed'
         ELSE 'Blocked: route not actionable'
       END                                   AS gate_explanation
  FROM public.complaints c
 ORDER BY c.workflow_gate_open, c.submitted_at DESC;

-- D2. Routing history, newest first, with the reason attached.
--     This is the audit trail a case file can be explained from.
SELECT 'D2 routing_history' AS check_name,
       h.complaint_id,
       c.reference_number,
       h.respondent_status_before,
       h.respondent_status_after,
       h.kp_applicability_before,
       h.kp_applicability_after,
       h.routing_status_before,
       h.routing_status_after,
       h.reason,
       h.acted_by_name,
       h.acted_by_role,
       h.created_at
  FROM public.complaint_routing_history h
  LEFT JOIN public.complaints c ON c.id = h.complaint_id
 ORDER BY h.created_at DESC
 LIMIT 100;

-- D3. Assistance and referral records.
--     Note the recorded_outcome column: it is free text precisely so
--     it can honestly say "pending" or "no response received". A
--     referral here never means an agency accepted the case.
SELECT 'D3 assistance_records' AS check_name,
       a.complaint_id,
       c.reference_number,
       a.assistance_type,
       a.agency_name,
       a.reference_number,
       a.follow_up_required,
       a.follow_up_due_on,
       a.recorded_outcome,
       a.recorded_by_name,
       a.recorded_at
  FROM public.complaint_assistance_records a
  LEFT JOIN public.complaints c ON c.id = a.complaint_id
 ORDER BY a.recorded_at DESC
 LIMIT 100;

-- D4. Blotter linkage, showing whether a complaint is linked to an
--     open blotter record.
SELECT 'D4 blotter_linkage' AS check_name,
       b.complaint_id,
       c.reference_number,
       b.blotter_number,
       b.current_status,
       b.respondent_name,
       b.recorded_at
  FROM public.blotter_records b
  LEFT JOIN public.complaints c ON c.id = b.complaint_id
 WHERE b.complaint_id IS NOT NULL
 ORDER BY b.recorded_at DESC;

-- D5. KP tracker mirror. kp_trackers.kp_applicable should agree with
--     complaints.kp_applicability = 'applicable'.
--     EXPECT ZERO ROWS. A row here is a disagreement between the
--     routing decision and the tracker the Lupon portal reads.
SELECT 'D5 tracker_disagreement' AS check_name,
       c.reference_number,
       c.kp_applicability,
       kt.kp_applicable AS tracker_kp_applicable,
       kt.current_phase
  FROM public.complaints c
  JOIN public.kp_trackers kt ON kt.complaint_id = c.id
 WHERE kt.kp_applicable IS DISTINCT FROM (c.kp_applicability = 'applicable')
 ORDER BY c.reference_number;

-- D6. Completeness readout: the submission-completeness state of every
--     complaint plus the chosen nature and any requested information.
SELECT 'D6 completeness_state' AS check_name,
       c.reference_number,
       c.completeness_status,
       c.complaint_nature,
       c.completeness_complainant_verified,
       c.completeness_contact_verified,
       c.completeness_incident_date_provided,
       c.completeness_incident_location_provided,
       c.completeness_narrative_sufficient,
       c.completeness_evidence_reviewed,
       c.completeness_extra_info_required,
       c.completeness_remarks,
       c.requested_information
  FROM public.complaints c
 ORDER BY c.submitted_at DESC;

-- D7. Incident details on file (reported-incident complaints only).
SELECT 'D7 incident_details' AS check_name,
       d.complaint_id,
       c.reference_number,
       d.property_description,
       d.plate_number,
       d.serial_number,
       d.last_known_location,
       d.last_known_at,
       d.cctv_available,
       d.safety_concern,
       d.already_reported_externally,
       d.externally_reported_where,
       d.recorded_by_name,
       d.updated_at
  FROM public.complaint_incident_details d
  LEFT JOIN public.complaints c ON c.id = d.complaint_id
 ORDER BY d.updated_at DESC;

-- ════════════════════════════════════════════════════════════════
-- E. MANUAL FUNCTIONAL TEST (run one at a time, then undo)
-- ════════════════════════════════════════════════════════════════
-- These are NOT run automatically. They are here so the behaviour can
-- be proven on a scratch complaint rather than assumed.
--
-- E1. The gate refuses a summons on an unassessed complaint.
--     Create a test complaint as a Captain, then:
--
--   INSERT INTO public.summons (complaint_id, ...)
--   VALUES ('<test complaint id>', ...);
--     EXPECT: error 23514, "This complaint cannot proceed to a summons,
--     hearing, Lupon or 15-day period yet."
--
-- E2. The gate refuses a 15-day phase.
--
--   INSERT INTO public.kp_phases (tracker_id, phase_type, start_date, status)
--   VALUES ('<tracker id>', 'Mediation', current_date, 'Active');
--     EXPECT: the same error, UNLESS the complaint's gate is open.
--
-- E3. Identifying a respondent does not open the gate by itself.
--
--   SELECT captain_record_respondent_status(
--     '<test complaint id>', 'identified', 'Juan Dela Cruz',
--     'Name taken from the barangay ID presented in person.');
--     THEN: SELECT workflow_gate_open FROM public.complaints WHERE id = '<test complaint id>';
--     EXPECT: false. The respondent is known, but KP applicability
--     has not been decided, so no summons yet.
--
-- E4. Routing to KP mediation without a reason is refused.
--
--   SELECT captain_set_routing(
--     '<test complaint id>', 'kp_mediation', 'applicable');
--     EXPECT: error, "A written reason is required".
--
-- E5. Routing to KP mediation with a reason opens the gate.
--
--   SELECT captain_set_routing(
--     '<test complaint id>', 'kp_mediation', 'applicable',
--     'Both parties are residents of this barangay; the dispute is
--      local and no criminal act is alleged.');
--     THEN: SELECT workflow_gate_open FROM public.complaints WHERE id = '<test complaint id>';
--     EXPECT: true. Only NOW may a summons or mediation phase be
--     created.
--
-- E6. Routing a case with no named respondent to KP mediation is
--     refused, even by a Captain.
--
--   SELECT captain_set_routing(
--     '<unassessed complaint id>', 'kp_mediation', 'applicable', 'reason text');
--     EXPECT: error mentioning "require an identified respondent".
--
-- E7. Assistance must match the route.
--
--   SELECT captain_record_assistance(
--     '<kp complaint id>', 'external_agency_assistance', 'City Health Office');
--     EXPECT: error, "would contradict the case file".
--
-- E8. A resident cannot write the routing columns.
--
--   As a resident, UPDATE public.complaints
--      SET workflow_gate_open = true WHERE id = '<complaint id>';
--     EXPECT: error, "Routing fields are official records."
--
-- E9. Requesting more information must say what is being asked for.
--
--   SELECT captain_record_completeness(
--     '<test complaint id>', 'needs_information');
--     EXPECT: error, "must say what information".
--
-- E10. A complaint cannot carry two OPEN blotter records.
--
--   SELECT captain_create_blotter_record(
--     '<incident complaint id>', 'Stolen bicycle, barangay center.');
--   SELECT captain_create_blotter_record(
--     '<same id>', 'Second attempt.');
--     EXPECT: the second call errors, "already has an open blotter".
--     (The first call also proves the resident-safe message, the
--     case_statuses row and the notification were written.)
--
-- E11. Assistance and route must still agree, in the new taxonomy.
--
--   SELECT captain_set_routing(
--     '<test complaint id>', 'incident_documentation', 'deferred_unknown_respondent',
--     'Reporting party cannot name the other person.',
--     'The case is treated as a reported incident and referred for documentation.');
--   SELECT captain_record_assistance(
--     '<test complaint id>', 'advised_to_report');
--     EXPECT: succeeds (no agency name needed). Then:
--   SELECT captain_record_assistance(
--     '<a different, kp_mediation complaint>', 'advised_to_report');
--     EXPECT: error, "would contradict the case file".
--
-- E12. A resident cannot fake an information response.
--
--   As a resident, UPDATE public.complaints
--      SET last_information_response_at = now(),
--          information_responses = 1
--    WHERE id = '<complaint id>';
--     EXPECT: error, "Routing fields are official records."
--   (The same two columns are writable ONLY through
--    resident_provide_requested_information, which sets a
--    transaction-local flag the guard honours.)
--
-- E13. The response channel itself.
--
--   1. As an official:
--        SELECT captain_record_completeness(
--          '<own complaint id>', 'needs_information', NULL, NULL, NULL, NULL,
--          NULL, NULL, NULL, NULL, NULL, 'A photo of the damaged wall.', NULL);
--        EXPECT: succeeds, and stamps complaints.requested_information_at.
--      As the RESIDENT of that same complaint:
--        SELECT resident_provide_requested_information(
--          '<own complaint id>', 'Here is the wall.', ARRAY[]::uuid[]);
--        EXPECT: succeeds; information_responses = 1 and
--                last_information_response_at >= requested_information_at.
--      Then as a resident on someone ELSE's complaint:
--        SELECT resident_provide_requested_information(
--          '<a complaint they do not own>', 'test', NULL);
--        EXPECT: error, "only answer an information request on your own".
--      And on a complaint that is not waiting:
--        SELECT resident_provide_requested_information(
--          '<a complaint with no open request>', 'test', NULL);
--        EXPECT: error, "not waiting for additional information".
--      An empty answer is refused too:
--        SELECT resident_provide_requested_information(
--          '<own complaint id>', '   ', NULL);
--        EXPECT: error, "Please write an answer or attach a file".
--
-- D8. Information requests and answers, newest first. This is the pair
--     the Captain's next-step CTA is derived from: a request stamped
--     AFTER the last answer means the resident is still owed a reply.
--
--   SELECT c.reference_number,
--          c.completeness_status,
--          c.requested_information,
--          c.requested_information_at,
--          c.last_information_response_at,
--          c.information_responses,
--          (c.last_information_response_at >= c.requested_information_at)
--            AS current_request_answered
--     FROM public.complaints c
--    WHERE c.requested_information_at IS NOT NULL
--       OR c.information_responses > 0
--    ORDER BY c.requested_information_at DESC NULLS LAST;
--
--   SELECT r.id, r.complaint_id, r.response_text, r.created_at,
--          array_length(array_agg(f.evidence_id), 1) AS attachments
--     FROM public.complaint_information_responses r
--     LEFT JOIN public.complaint_information_response_files f
--            ON f.response_id = r.id
--    GROUP BY r.id
--    ORDER BY r.created_at DESC;
--
-- A8. The response tables exist and are locked down. The guards are the
--     point of the check: the RPC is the only writer.
--
--   SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
--     FROM pg_class c
--    WHERE c.relname IN ('complaint_information_responses',
--                        'complaint_information_response_files');
--     EXPECT: both true / true.
--
--   SELECT policyname, cmd, qual, with_check
--     FROM pg_policies
--    WHERE tablename = 'complaint_information_responses'
--    ORDER BY policyname;
--     EXPECT: only SELECT policies. There must be no INSERT, UPDATE or
--             DELETE policy — a direct client write is meant to fail.
--
-- CLEAN UP the test complaint afterwards:
--   DELETE FROM public.complaints WHERE id = '<test complaint id>';
-- (routing history, assistance, incident-detail and information-response
-- rows all cascade.)
-- ════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE
    'Verification queries above are read-only. Checks to read closely: '
    'A7 (gate default false), B2/B3 (history append-only), '
    'A8 (no inconsistent rows), D5 (tracker agrees with routing).';
END
$$;
