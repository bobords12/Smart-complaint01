/** Apply only the reviewed SVM-specific migration via Supabase Management API.
 *  Usage: node scripts/apply-svm-migration.mjs --check | --apply | --verify
 *  Reads the personal access token locally; never prints it or persists it.
 */
import { readFile } from "node:fs/promises";

const mode = process.argv[2];
if (!["--check", "--apply", "--verify"].includes(mode)) {
  console.error("Usage: node scripts/apply-svm-migration.mjs --check|--apply|--verify");
  process.exit(2);
}

const root = new URL("../", import.meta.url);
const config = await readFile(new URL("supabase/config.toml", root), "utf8");
const ref = config.match(/^project_id\s*=\s*"([a-z0-9]+)"/m)?.[1];
const tokenFile = await readFile(new URL("accesstoken.txt", root), "utf8");
const token = tokenFile.match(/\bsbp_[a-f0-9]+\b/)?.[0];
const urlRef = tokenFile.match(/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!ref || !token || urlRef !== ref) throw Error("Token file project URL does not match supabase/config.toml");

const base = `https://api.supabase.com/v1/projects/${ref}`;
async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Error(`Supabase Management API HTTP ${response.status}: ${
    JSON.stringify(result?.message || result?.error || "request failed").replaceAll(token, "[REDACTED]")
  }`);
  return result;
}
const project = await api("");
if (project.id !== ref) throw Error("Management API returned a different project");
console.log(`Connected to Supabase project ${ref}`);

async function query(sql) {
  const result = await api("/database/query", { method: "POST", body: JSON.stringify({ query: sql }) });
  if (!Array.isArray(result)) throw Error("Unexpected SQL query response; migration status is unknown");
  return result;
}

const prerequisites = await query(`
SELECT
 to_regclass('public.complaints') IS NOT NULL AS complaints,
 to_regclass('public.profiles') IS NOT NULL AS profiles,
 to_regclass('public.audit_logs') IS NOT NULL AS audit_logs,
 to_regtype('public.app_role') IS NOT NULL AS app_role,
 EXISTS (SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='complaints' AND column_name='prediction_model') AS prediction_model;
`);
const ready = prerequisites[0];
if (!ready?.complaints || !ready?.profiles || !ready?.audit_logs || !ready?.app_role || !ready?.prediction_model) {
  throw Error(`Required schema missing: ${JSON.stringify(ready)}`);
}
console.log(`Prerequisites present (complaints, profiles, audit_logs, app_role, prediction_model).`);
if (mode === "--check") process.exit(0);

if (mode === "--apply") {
  const sql = await readFile(new URL("supabase/manual/35_svm_specific_prediction.sql", root), "utf8");
  await query(`BEGIN;\n${sql}\nCOMMIT;`);
  console.log("Migration query completed; checking installed objects.");
}

const installed = await query(`
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
     AND table_name='complaints' AND column_name IN ('predicted_specific_category','confirmed_specific_category')
     AND data_type='text') AS text_columns,
  (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.complaints'::regclass AND NOT tgisinternal
     AND tgenabled='O' AND tgname IN ('guard_specific_categorization','audit_specific_categorization')) AS triggers,
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.complaints'::regclass) AS complaints_rls,
  to_regprocedure('public.confirm_specific_category(uuid,text)') IS NOT NULL AS confirm_function,
  to_regprocedure('public.guard_specific_categorization()') IS NOT NULL AS guard_function,
  to_regprocedure('public.audit_specific_categorization()') IS NOT NULL AS audit_function,
  (SELECT rolname FROM pg_roles WHERE rolname='anon' AND has_function_privilege('anon', 'public.confirm_specific_category(uuid,text)', 'EXECUTE')) AS anon_execute_role,
  has_function_privilege('authenticated', 'public.confirm_specific_category(uuid,text)', 'EXECUTE') AS authenticated_execute,
  (SELECT column_default IS NULL FROM information_schema.columns WHERE table_schema='public'
     AND table_name='complaints' AND column_name='prediction_model') AS old_default_removed;
`);
const row = installed[0];
if (Number(row?.text_columns) !== 2 || Number(row?.triggers) !== 2 || !row.complaints_rls || !row.confirm_function ||
    !row.guard_function || !row.audit_function || row.anon_execute_role ||
    !row.authenticated_execute || !row.old_default_removed) {
  throw Error(`Migration verification failed: ${JSON.stringify(row)}`);
}
console.log("Verified: 2 text columns, 2 enabled triggers, 3 functions, complaints RLS enabled, authenticated-only confirm RPC, old default removed.");
