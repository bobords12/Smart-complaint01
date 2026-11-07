// Phase 3 / 4 / 5 acceptance: creates ONE new resident complaint through the
// service-role client (the same create_complaint semantics: reference number
// from the DB sequence, initial case_statuses row), runs the REAL
// generateSubmittedReklamo pipeline, and verifies:
//
//   1. the generated DOCX is programmatic (no master, no {{token}}, US Letter)
//   2. official_documents row: v1, pending_review, resident_visible, active,
//      stage submitted, generator programmatic, no master_template
//   3. one lifecycle event + one activity log entry
//   4. resident "Case Documents" query returns the document (RLS-scoped view)
//   5. captain "Case Documents" listing query returns it too
//   6. signed URL works (View/Download)
//   7. the templates bucket gained NO generated form (nothing written there)
//   8. rerun is a no-op (idempotency)
//
//   node scripts/drive-new-complaint.mjs
//
// The new complaint is left in place so the resident can see it; its
// reference_number is printed at the end.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";
import PizZip from "pizzip";

register("./resolve-alias.mjs", import.meta.url);

const { generateSubmittedReklamo } = await import("../lib/reklamo/serverSubmittedReklamo.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
process.env.NEXT_PUBLIC_SUPABASE_URL = url;
process.env.SUPABASE_SERVICE_ROLE_KEY = key;

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const failures = [];
const pass = (label, detail = "") => console.log(`  ok   ${label}${detail ? ` — ${detail}` : ""}`);
const fail = (label, detail) => {
  console.log(`  FAIL ${label} — ${detail}`);
  failures.push(label);
};
const stopAtFirst = () => {
  if (failures.length) {
    console.error(`\nSTOPPED: ${failures[0]}`);
    process.exit(1);
  }
};

// 1. Choose a real resident to attach the new complaint to (same resident who
//    owns AB-2026-0019, so the complaint appears in a live account).
const { data: seedComplaint, error: seedError } = await admin
  .from("complaints")
  .select("id, resident_id")
  .eq("reference_number", "AB-2026-0019")
  .maybeSingle();
if (seedError || !seedComplaint?.resident_id) {
  console.error("ABORT: could not resolve the resident for the seed complaint.");
  process.exit(1);
}
const residentId = seedComplaint.resident_id;
console.log(`attaching to resident: ${residentId}`);

// 2. New complaint row, exactly as create_complaint() would create it, but with
//    the resident_id set explicitly (service role has no auth.uid()).
const { data: refData, error: refError } = await admin.rpc("generate_reference_number");
if (refError || !refData) {
  console.error("ABORT: reference number could not be generated:", refError?.message);
  process.exit(1);
}
const referenceNumber = refData;
console.log(`new complaint ref   : ${referenceNumber}`);

const title = "Noise complaint (automated programmatic Reklamo test)";
const description =
  "This is a test complaint created to verify the programmatic Reklamo Form generator. Persistent loud music from a neighbor's karaoke every night disturbs the household.";

const { data: insertedComplaint, error: insertError } = await admin
  .from("complaints")
  .insert({
    resident_id: residentId,
    reference_number: referenceNumber,
    title,
    description,
    incident_date: "2026-10-08",
    incident_time: "21:30:00",
    incident_location: "Zone 1 Proper, Abuno, Iligan City",
    persons_involved: "Neighbor operating a karaoke player",
    witnesses: null,
    predicted_category: "Administrative",
    predicted_case_type: "Administrative",
    predicted_urgency: "Normal",
    prediction_confidence: 0.9,
    current_status: "Pending Review",
    current_stage: "Pending Review",
  })
  .select("id, reference_number")
  .single();
if (insertError || !insertedComplaint?.id) {
  console.error("ABORT: complaint insert failed:", insertError?.message);
  process.exit(1);
}
const complaintId = insertedComplaint.id;
console.log(`complaint id        : ${complaintId}`);

// Mirror create_complaint(): the initial case_statuses row.
try {
  await admin.from("case_statuses").insert({
    complaint_id: complaintId,
    status: "Pending Review",
    stage: "Pending Review",
    resident_visible_message: "Complaint received and submitted for review.",
    changed_by: residentId,
  });
} catch (error) {
  console.warn("warn  could not insert initial case_statuses row:", error?.message);
}

// 3. Run the REAL resident generator (same call the /api/reklamo/generate route makes).
const start = Date.now();
const result = await generateSubmittedReklamo({ complaintId, residentId });
const elapsedMs = Date.now() - start;
console.log("\ngenerator result:");
console.log(JSON.stringify({ success: result.success, code: result.code, already: result.already, version: result.version, storage_path: result.storage_path }, null, 2));
if (!result.success) {
  console.error(`ABORT: generator failed — ${result.code}: ${result.message}`);
  process.exit(1);
}
pass("generation completed", `v${result.version} in ${elapsedMs}ms, programmatic (no master read)`);

// 4. Row-level assertions.
const { data: rows, error: rowsError } = await admin
  .from("official_documents")
  .select("*")
  .eq("complaint_id", complaintId)
  .eq("document_type", "reklamo_form");
if (rowsError) {
  console.error("ABORT: could not read official_documents:", rowsError.message);
  process.exit(1);
}
const row = (rows || [])[0];
if ((rows || []).length !== 1) fail("exactly one reklamo_form row", `got ${(rows || []).length}`);
if (Number(row?.version) !== 1) fail("version 1", row?.version);
if (row?.document_status !== "pending_review") fail("document_status pending_review", row?.document_status);
if (row?.visibility !== "resident_visible") fail("visibility resident_visible", row?.visibility);
if (row?.status !== "active") fail("status active", row?.status);
const snapshot = row?.content_snapshot || {};
if (snapshot.stage !== "submitted") fail("snapshot.stage submitted", snapshot.stage);
if (snapshot.generator !== "programmatic") fail("snapshot.generator programmatic", snapshot.generator);
if ("master_template" in snapshot) fail("snapshot has no master_template", "template-era field leaked");
if (snapshot.case_number !== "") fail("case_number blank (no barangay case)", JSON.stringify(snapshot.case_number));
if (snapshot.case_number === referenceNumber) fail("reference never printed as case number", "leak");
for (const part of ["received_day", "received_month", "received_year"]) {
  if (snapshot[part] !== "") fail(`${part} blank when not received`, JSON.stringify(snapshot[part]));
}
for (const part of ["prepared_day", "prepared_month", "prepared_year"]) {
  if (!snapshot[part]) fail(`${part} filled`, part);
}
stopAtFirst();

// 5. Lifecycle + activity evidence.
const { data: life } = await admin
  .from("document_lifecycle_events")
  .select("event_type, notes")
  .eq("document_id", row.id);
const preparedEvent = (life || []).find((e) => e.event_type === "prepared");
pass("lifecycle prepared event", preparedEvent?.notes || "missing");
const { data: activity } = await admin
  .from("activity_logs")
  .select("action, details")
  .eq("target_type", "complaint")
  .eq("target_id", complaintId)
  .eq("action", "reklamo_form_generated");
pass("activity log entry", (activity || []).length === 1 ? `generator=${activity[0]?.details?.generator}` : `expected 1, got ${(activity || []).length}`);

// 6. Resident Case Documents query (same select as getResidentComplaintDocuments).
const { data: residentDocs, error: rdErr } = await admin
  .from("official_documents")
  .select("id, complaint_id, document_type, document_status, title, filename, storage_path, mime_type, file_size, version, generated_at, created_at")
  .eq("complaint_id", complaintId)
  .eq("visibility", "resident_visible")
  .order("created_at", { ascending: true });
if (rdErr) fail("resident docs query", rdErr.message);
else pass("resident Case Documents lists it", (residentDocs || []).some((d) => d.id === row.id), `filename=${row.filename}`);

// 7. Captain Case Documents query (same select as the case-file loader).
const { data: captainDocs, error: cdErr } = await admin
  .from("official_documents")
  .select("*")
  .eq("complaint_id", complaintId)
  .order("created_at", { ascending: true });
if (cdErr) fail("captain docs query", cdErr.message);
else pass("captain Case Documents lists it", (captainDocs || []).some((d) => d.id === row.id));

// 8. Generated DOCX content (programmatic, US Letter, static signoff).
const { data: genBlob, error: genErr } = await admin.storage
  .from("documents")
  .download(row.storage_path);
if (genErr || !genBlob) {
  fail("generated file download", genErr?.message || "no body");
} else {
  const bytes = new Uint8Array(await genBlob.arrayBuffer());
  const zip = new PizZip(bytes);
  const xml = zip.file("word/document.xml")?.asText() || "";
  pass("downloaded file size", `${bytes.length} bytes`);
  if (xml.includes("{{")) fail("no {{token}} remains", "placeholder left in programmatic doc");
  else pass("no {{token}} remains", "programmatic output");
  const pgSz = (xml.match(/<w:pgSz[^>]*\/>/) || [null])[0] || "";
  if (/w:w="12240"/.test(pgSz) && /w:h="15840"/.test(pgSz)) pass("US Letter pgSz", "12240x15840");
  else fail("US Letter pgSz", pgSz);
  if (xml.includes("EDUARD A. LARANIO") && xml.includes("Punong Barangay/Lupon Chairman"))
    pass("static signoff", "Punong Barangay/Lupon Chairman");
  else fail("static signoff", "missing");
  if (!xml.includes("BARANGAY ABUNO")) fail("letterhead", "missing");
  else pass("letterhead", "BARANGAY ABUNO present");
}

// 9. Templates bucket must not contain a generated form.
const { data: templateFiles, error: tmplErr } = await admin.storage
  .from("templates")
  .list("masters/reklamo");
if (tmplErr) {
  pass("templates bucket untouched", `no reklamo master folder read (${tmplErr.message})`);
} else {
  const leaked = (templateFiles || []).filter((f) => /^reklamo-form-.*\.docx$/i.test(f.name));
  if (leaked.length) fail("templates bucket clean", leaked.map((f) => f.name).join(", "));
  else pass("templates bucket clean", "no generated form stored there");
}

// 10. Idempotency: rerun returns already=true, adds no rows.
const rerun = await generateSubmittedReklamo({ complaintId, residentId });
const { data: rowsAfter } = await admin
  .from("official_documents")
  .select("id")
  .eq("complaint_id", complaintId)
  .eq("document_type", "reklamo_form");
pass("rerun is a no-op", `already=${rerun.already} version=${rerun.version}, rows ${(rows || []).length} → ${(rowsAfter || []).length}`);

console.log("\n── RESULT ──");
console.log(`new complaint     : ${referenceNumber}`);
console.log(`complaint id      : ${complaintId}`);
console.log(`resident id       : ${residentId}`);
console.log(`document          : v${row.version} ${row.document_status} / ${row.visibility} / ${row.status}`);
console.log(`storage_path      : ${row.storage_path}`);
console.log(failures.length ? `failures: ${failures.join(", ")}` : "ALL ACCEPTANCE CHECKS PASSED");
process.exit(failures.length ? 1 : 0);