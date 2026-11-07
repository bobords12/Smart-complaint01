/**
 * Uploads the local master templates into the private `templates` bucket.
 *
 *   node scripts/upload-master-templates.mjs
 *
 * Storage is written with PUT, not POST + x-upsert: a PUT on an existing key
 * replaces it, which is what a master correction needs. The service-role key
 * is read from .env and never printed or echoed back.
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
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Supabase URL / service-role key missing from .env");
  process.exit(1);
}

const MASTERS = [
  {
    label: "Notice of Hearing",
    local: "Files/Notice_of_Hearing_Template.docx",
    remote: "masters/hearing-notice/Notice_of_Hearing_Template.docx",
  },
];

const MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);

let failures = 0;
for (const { label, local, remote } of MASTERS) {
  const bytes = readFileSync(path.join(REPO, local));
  const res = await fetch(`${url}/storage/v1/object/templates/${remote}`, {
    method: "PUT",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": MIME,
      "x-upsert": "true",
    },
    body: bytes,
  });
  const text = (await res.text()).slice(0, 300);
  const ok = res.ok;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  console.log(`        local  ${bytes.length} bytes  sha ${sha(bytes)}`);
  console.log(`        remote ${remote}`);
  if (!ok) console.log(`        ${res.status} ${text}`);
}

console.log(`\n${failures === 0 ? "UPLOAD COMPLETE" : `${failures} UPLOAD(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
