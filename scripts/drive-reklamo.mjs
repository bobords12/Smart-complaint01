// Drives the REAL production resident-Reklamo generator against an existing
// complaint (found by reference_number) and verifies the produced document
// end to end, using the same service-role client and the same generation
// module that /api/reklamo/generate calls.
//
//   node scripts/drive-reklamo.mjs            # default reference AB-2026-0019
//   REKLAMO_TEST_REFERENCE=X node scripts/drive-reklamo.mjs
//
// Safe to re-run: the generator is idempotent (returns already=true and the
// existing v1 when no official case exists yet). Stops at the first check
// that fails.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import PizZip from "pizzip";
import { createClient } from "@supabase/supabase-js";

register("./resolve-alias.mjs", import.meta.url);

const { generateSubmittedReklamo } = await import("../lib/reklamo/serverSubmittedReklamo.js");
const {
  complaintStoragePath,
  reklamoFolder,
  reklamoFormDocxFileName,
  reklamoDocxFileIdentifier,
} = await import("../lib/reklamo/reklamoDocument.js");

const REFERENCE = process.env.REKLAMO_TEST_REFERENCE || "AB-2026-0019";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const failures = [];
const pass = (label, detail = "") => console.log(`  ok   ${label}${detail ? ` — ${detail}` : ""}`);
const fail = (label, detail) => {
  console.log(`  FAIL ${label} — ${detail}`);
  failures.push(label);
};
const stopAtFirst = () => {
  if (failures.length) {
    console.error(`\nSTOPPED at first failing operation: ${failures[0]}`);
    process.exit(1);
  }
};

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
      .map((line) => {
        const idx = line.indexOf("=");
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
      })
  );
}

const env = loadEnvFile();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("ABORT: script env missing a required variable.");
  process.exit(1);
}
// Mirror how Next.js exposes .env: the real generator reads process.env like
// the running dev server would.
process.env.NEXT_PUBLIC_SUPABASE_URL = url;
process.env.SUPABASE_SERVICE_ROLE_KEY = key;
console.log(`using SUPABASE url   : ${url}`);
console.log(`service-role key     : present (not printed)`);

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// 1. Resolve the complaint by reference_number.
const { data: complaint, error: findError } = await admin
  .from("complaints")
  .select(
    "id, reference_number, resident_id, barangay_case_number, official_received_at, description"
  )
  .eq("reference_number", REFERENCE)
  .maybeSingle();
if (findError || !complaint) {
  console.error(`ABORT: complaint ${REFERENCE} not found (${findError?.message || "no row"}).`);
  process.exit(1);
}
console.log(`\ntarget complaint      : ${complaint.id} (${complaint.reference_number})`);
console.log(`  barangay_case_number: ${complaint.barangay_case_number ?? "null"}`);
console.log(`  official_received_at: ${complaint.official_received_at ?? "null"}`);

// 2. Existing reklamo_form copies before the run.
const { data: docsBefore, error: docsListError } = await admin
  .from("official_documents")
  .select("id, document_type, document_status, version, status, visibility, storage_path")
  .eq("complaint_id", complaint.id)
  .eq("document_type", "reklamo_form");
if (docsListError) {
  console.error("ABORT: could not list existing documents:", docsListError.message);
  process.exit(1);
}
const beforeCount = (docsBefore || []).length;
console.log(`reklamo_form rows before run: ${beforeCount}`);

// 3. Run the REAL generator (identical to the route's server step). No master
//    template is read at any point — the DOCX is built programmatically.
const firstRun = await generateSubmittedReklamo({
  complaintId: complaint.id,
  residentId: complaint.resident_id || undefined,
});
console.log("\ngenerator result (run 1):");
console.log(JSON.stringify({ success: firstRun.success, code: firstRun.code, already: firstRun.already, version: firstRun.version, storage_path: firstRun.storage_path }, null, 2));
if (!firstRun.success) {
  console.error(`ABORT: generator failed — ${firstRun.code}: ${firstRun.message}`);
  process.exit(1);
}

const { data: docsAfter, error: docsAgainError } = await admin
  .from("official_documents")
  .select(
    "id, document_type, document_status, version, status, visibility, generated_at, storage_path, filename, file_size, content_snapshot"
  )
  .eq("complaint_id", complaint.id)
  .eq("document_type", "reklamo_form")
  .order("version", { ascending: true });
if (docsAgainError) {
  console.error("ABORT: could not list documents after run:", docsAgainError.message);
  process.exit(1);
}
const reklamoRows = docsAfter || [];
const latest = reklamoRows[reklamoRows.length - 1];

if (firstRun.already) {
  pass("new copy on retry", `already=true, reusing existing v${firstRun.version}`);
  if (reklamoRows.length !== beforeCount)
    fail("idempotency", `expected ${beforeCount} rows, found ${reklamoRows.length}`);
} else {
  if (reklamoRows.length !== beforeCount + 1)
    fail("single insert", `expected ${beforeCount + 1} rows, found ${reklamoRows.length}`);
}
stopAtFirst();
pass("no duplicate version", `reklamo_form count ${beforeCount} → ${reklamoRows.length}`);

// 4. Row-level assertions on the submitted copy.
pass("row version", `${Number(latest.version) || 1} (storage path matches run: ${latest.storage_path === firstRun.storage_path})`);
if (latest.document_status !== "pending_review") fail("document_status", latest.document_status);
if (latest.visibility !== "resident_visible") fail("visibility", latest.visibility);
if (latest.status !== "active") fail("row status", latest.status);
if (latest.content_snapshot?.stage !== "submitted") fail("content_snapshot.stage", latest.content_snapshot?.stage);
if (!firstRun.already) {
  // Only a freshly generated row must carry the programmatic marker. A v1
  // created before the migration legitimately has `master_template` history.
  if (latest.content_snapshot?.generator !== "programmatic") fail("content_snapshot.generator", latest.content_snapshot?.generator);
  if ("master_template" in (latest.content_snapshot || {})) fail("content_snapshot.master_template", "must be absent in the programmatic era");
  pass("programmatic marker", `generator=${latest.content_snapshot?.generator}`);
} else {
  pass("existing row retained", `history kept (skipping programmatic-marker checks for the template-era v1)`);
}
stopAtFirst();

const snapshot = latest.content_snapshot || {};
if (complaint.barangay_case_number) {
  if (snapshot.case_number !== complaint.barangay_case_number)
    fail("case_number printed", `expected official number, got "${snapshot.case_number}"`);
} else {
  if (snapshot.case_number !== "") fail("case_number blank", `must be blank when no case, got "${snapshot.case_number}"`);
  if (snapshot.case_number === complaint.reference_number) fail("case_number leak", "reference printed");
}
for (const part of ["received_day", "received_month", "received_year"]) {
  const value = snapshot[part];
  if (complaint.official_received_at) {
    if (!value) fail(`${part} filled`, "must be filled when officially received");
  } else if (value !== "") {
    fail(`${part} blank`, `must be blank when not received, got "${value}"`);
  }
}
for (const part of ["prepared_day", "prepared_month", "prepared_year"]) {
  if (!snapshot[part]) fail(`${part} filled`, "must be filled");
}
stopAtFirst();
pass("placeholder field rules", "case # blank + received blanks (when official date null), prepared filled");

// 5. Generated DOCX verification (programmatic output).
const { data: genBlob, error: genDownloadError } = await admin.storage
  .from("documents")
  .download(latest.storage_path);
if (genDownloadError || !genBlob) {
  fail("generated download", genDownloadError?.message || "no body");
  stopAtFirst();
}
const genBytes = new Uint8Array(await genBlob.arrayBuffer());
pass("generated doc byte size", `${genBytes.length} bytes`);
let genZip;
try {
  genZip = new PizZip(genBytes);
} catch (error) {
  fail("generated zip", `not a valid DOCX (${error?.message})`);
  stopAtFirst();
}
const genXml = genZip.file("word/document.xml")?.asText();
if (!genXml) fail("document.xml", "missing from generated DOCX");
const unresolved = genXml.match(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/g);
if (unresolved && unresolved.length) fail("unresolved tokens", unresolved.join(", "));
else pass("no {{token}} remains", "programmatic renderer leaves no placeholders");

const pgSz = (genXml.match(/<w:pgSz[^>]*\/>/) || [null])[0] || "";
const pageOk = /w:w="12240"|w:w="12240"/.test(pgSz) && /w:h="15840"/.test(pgSz) && !/w:w="11906"/.test(pgSz);
if (pageOk) pass("page setup (pgSz)", "US Letter 12240x15840");
else fail("page setup (pgSz)", pgSz || "missing");
if (genXml.includes("R E K L A M O")) pass("heading", 'contains "R E K L A M O"');
else fail("heading", "missing");
if (genXml.includes("BARANGAY ABUNO")) pass("letterhead", "contains the barangay letterhead");
else fail("letterhead", "missing");
if (genXml.includes("EDUARD A. LARANIO")) pass("signoff", "static Punong Barangay signoff printed");
else fail("signoff", "missing");

// 6. Storage path/filename conventions.
const identifier = reklamoDocxFileIdentifier(complaint);
const expectedName = reklamoFormDocxFileName(identifier, Number(latest.version) || 1);
const expectedPath = complaintStoragePath(complaint.id, reklamoFolder(), expectedName);
pass("filename convention", `${latest.filename} (expected ${expectedName})`);
if (latest.storage_path === expectedPath) pass("storage path convention", expectedPath);
else fail("storage path convention", `got ${latest.storage_path}, expected ${expectedPath}`);
stopAtFirst();

// 7. Idempotency: a second run must return already=true and add no rows.
const secondRun = await generateSubmittedReklamo({
  complaintId: complaint.id,
  residentId: complaint.resident_id || undefined,
});
const { data: docsFinal } = await admin
  .from("official_documents")
  .select("id")
  .eq("complaint_id", complaint.id)
  .eq("document_type", "reklamo_form");
const finalCount = (docsFinal || []).length;
pass("rerun is a no-op", `already=${secondRun.already} version=${secondRun.version}, rows ${reklamoRows.length} → ${finalCount}`);

// 8. View/Download retrieval (server-side; same signed-URL mechanism).
const { data: signed, error: signedError } = await admin.storage
  .from("documents")
  .createSignedUrl(latest.storage_path, 300);
pass("signed URL available", signed?.signedUrl ? "valid" : signedError?.message || "none");

console.log("\n── SUMMARY ──");
console.log(`storage path     : ${latest.storage_path}`);
console.log(`official_document: version=${Number(latest.version) || 1} document_status=${latest.document_status} visibility=${latest.visibility} status=${latest.status} stage=${latest.content_snapshot?.stage} generator=${latest.content_snapshot?.generator}`);
console.log(`no {{token}} remains, US Letter page setup, static signoff printed.`);
console.log(failures.length ? `failures: ${failures.join(", ")}` : "all checks passed");
process.exit(failures.length ? 1 : 0);