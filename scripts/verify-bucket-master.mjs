/**
 * Reads the master back out of the private `templates` bucket with the
 * service-role key and compares it byte-for-byte with the local file, then
 * renders a document from the DOWNLOADED bytes. Proves the bucket copy is the
 * one the app will actually use.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = Object.fromEntries(
  readFileSync(path.join(REPO, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^\s*[A-Za-z_]+\s*=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const REMOTE = "masters/hearing-notice/Notice_of_Hearing_Template.docx";
const LOCAL = path.join(REPO, "Files/Notice_of_Hearing_Template.docx");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` -> ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const res = await fetch(`${url}/storage/v1/object/templates/${REMOTE}`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
check("bucket master is readable", res.ok, String(res.status));
const downloaded = Buffer.from(await res.arrayBuffer());
const local = readFileSync(LOCAL);

check(
  "bucket copy is byte-for-byte the local master",
  createHash("sha256").update(downloaded).digest("hex") ===
    createHash("sha256").update(local).digest("hex"),
  `${downloaded.length} vs ${local.length} bytes`
);

const { renderDocx } = await import("../lib/documents/docxTemplate.js");
const {
  buildNoticeOfHearingData,
  noticeOfHearingFields,
} = await import("../lib/hearing/noticeOfHearingDocx.js");

let blob = null;
try {
  blob = renderDocx(
    new Uint8Array(downloaded),
    noticeOfHearingFields(),
    buildNoticeOfHearingData({
      complaint: { id: "abc", barangay_case_number: null, reference_number: "AB-2026-0028" },
      complainant: "Riza Oyangorin",
      respondent: "Jose Dela Cruz",
      respondentAddress: "Purok 3, Abuno",
      hearing: { id: "h1", hearing_date: "2026-10-12", hearing_time: "10:59:00", title: "First Hearing" },
      officialProfile: { display_name: "RODRIGO C. SAYSON", role: "captain" },
      now: new Date("2026-10-11T02:00:00Z"),
    })
  );
  check("renders from the BUCKET bytes, not just the local file", true);
} catch (error) {
  check("renders from the BUCKET bytes, not just the local file", false, error.message);
}

if (blob) {
  const { default: PizZip } = await import("pizzip");
  const zip = new PizZip(new Uint8Array(await blob.arrayBuffer()));
  const xml = zip.file("word/document.xml").asText();
  const paras = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((m) =>
    [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join("")
  );
  check("To: caption carries the respondent", paras[12] === "To: Jose Dela Cruz", paras[12]);
  check("complainant caption carries the name", paras[14] === "Complainant/s: Riza Oyangorin", paras[14]);
  check("letterhead survived the round trip", xml.includes("<w:tbl>") && xml.includes("BARANGAY ABUNO"));
  check("no unresolved token", !xml.includes("{{"));
}

console.log(`\n${failures === 0 ? "BUCKET MASTER VERIFIED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
