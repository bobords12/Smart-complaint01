-- ══════════════════════════════════════════════════════════
-- QA provisioning — Lupon + PNP accounts.
--
-- The accounts already existed (lupon1-3@gmail.com, adminpnp@gmail.com)
-- but every one of them still had profiles.role = 'resident', so
-- middleware refused them at /lupon and /pnp. Nothing had ever been
-- constituted or referred either.
--
-- Roles are set exactly the way public.update_user_role() would set
-- them — same UPDATE, same official_profiles maintenance — because
-- going through that function is impossible here: it rejects
-- pnp_officer (is_manageable_role() allows only resident/captain/oic/
-- secretary/lupon), which is the documented, deliberately SQL-only
-- provisioning path for police accounts (PNP_SETUP_GUIDE.md §3).
--
-- pnp_officer_profiles is intentionally NOT inserted: the guide says
-- rank / station / personnel number are real-world facts and that a
-- NULL field beats a placeholder.
--
-- Idempotent — safe to re-run.
-- ══════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The three Lupon members ──────────────────────────────
UPDATE public.profiles p
   SET role = 'lupon', updated_at = now()
  FROM auth.users u
 WHERE u.id = p.id
   AND lower(u.email) IN ('lupon1@gmail.com', 'lupon2@gmail.com', 'lupon3@gmail.com')
   AND p.role IS DISTINCT FROM 'lupon';

INSERT INTO public.official_profiles (user_id, position)
SELECT u.id, 'lupon'
  FROM auth.users u
 WHERE lower(u.email) IN ('lupon1@gmail.com', 'lupon2@gmail.com', 'lupon3@gmail.com')
   AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id AND p.role = 'lupon')
ON CONFLICT (user_id) DO UPDATE
  SET position = 'lupon', updated_at = now();

-- ── 2. The PNP officer ──────────────────────────────────────
UPDATE public.profiles p
   SET role = 'pnp_officer', updated_at = now()
  FROM auth.users u
 WHERE u.id = p.id
   AND lower(u.email) = 'adminpnp@gmail.com'
   AND p.role IS DISTINCT FROM 'pnp_officer';

INSERT INTO public.official_profiles (user_id, position)
SELECT u.id, 'pnp_officer'
  FROM auth.users u
 WHERE lower(u.email) = 'adminpnp@gmail.com'
   AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id AND p.role = 'pnp_officer')
ON CONFLICT (user_id) DO UPDATE
  SET position = 'pnp_officer', updated_at = now();

-- ── 3. A unit, so the Captain's assignment dialog can filter ─
--     (PNP_SETUP_GUIDE.md §4. An officer with no unit row can
--      still be assigned, just without a unit label — but the
--      create-time blast only reaches officers who have one.)
INSERT INTO public.pnp_portal_units (unit_code, unit_name)
VALUES ('CRU', 'Community Relations Unit')
ON CONFLICT (unit_code) DO NOTHING;

INSERT INTO public.pnp_officer_units (officer_id, unit_id)
SELECT p.id, pu.id
  FROM public.profiles p
  JOIN auth.users au ON au.id = p.id AND lower(au.email) = 'adminpnp@gmail.com'
  JOIN public.pnp_portal_units pu ON pu.unit_code = 'CRU'
 WHERE p.role = 'pnp_officer'
ON CONFLICT DO NOTHING;

COMMIT;

-- ── 4. Verification ─────────────────────────────────────────
SELECT 'account' AS what,
       COALESCE(au.email, '?') AS a,
       COALESCE(p.role::text, 'NO_PROFILE') AS b,
       COALESCE(p.account_status::text, '-') AS c,
       COALESCE((
         SELECT string_agg(op.position, ',')
           FROM public.official_profiles op WHERE op.user_id = p.id
       ), '-') AS d
  FROM public.profiles p
  FULL JOIN auth.users au ON au.id = p.id
 WHERE lower(COALESCE(au.email, '')) IN
       ('lupon1@gmail.com', 'lupon2@gmail.com', 'lupon3@gmail.com', 'adminpnp@gmail.com')

UNION ALL
SELECT 'unit',
       pu.unit_code,
       pu.unit_name,
       count(op.officer_id)::text,
       COALESCE(string_agg(au.email, ','), 'no officers')
  FROM public.pnp_portal_units pu
  LEFT JOIN public.pnp_officer_units op ON op.unit_id = pu.id
  LEFT JOIN auth.users au ON au.id = op.officer_id
 GROUP BY pu.id, pu.unit_code, pu.unit_name
 ORDER BY 1, 2;
