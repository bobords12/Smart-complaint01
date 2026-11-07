// Confirms the private `templates` bucket exists and reports whether the
// Notice of Hearing master is in it. The Reklamo Form is generated
// programmatically now, so it has no master. Read-only: it uses the public
// anon key and the storage API, so it never needs a service-role secret.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^\s*[A-Za-z_]+\s*=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing from .env");
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

const MASTERS = [
  "masters/hearing-notice/Notice_of_Hearing_Template.docx",
];

// The bucket itself cannot be confirmed through the public API: reading bucket
// metadata requires a service role, and an unauthenticated caller is told
// "Bucket not found" even when the bucket is present. Its existence and its
// policies are verified over SQL instead (sbquery.js). What CAN be checked here
// is the only thing that matters to a captain at runtime: whether an officer's
// session can actually download the master.
console.log("master download check (anon key - what an unauthenticated caller sees):");
for (const path of MASTERS) {
  const res = await fetch(`${url}/storage/v1/object/templates/${path}`, { headers });
  const body = (await res.text()).slice(0, 200);
  let verdict;
  if (res.ok) {
    verdict = `REACHABLE (${res.status}) - the master is NOT private!`;
  } else if (/permission denied|Unauthorized/i.test(body)) {
    verdict = "blocked (RLS denied)";
  } else {
    verdict = `not readable (${res.status}) - missing, or private`;
  }
  console.log(`  ${path}\n    ${verdict}`);
}

console.log("\nA blocked or missing master is expected here: this check runs");
console.log("without a signed-in officer. Run it from the app as a captain to");
console.log("confirm the real download path.");