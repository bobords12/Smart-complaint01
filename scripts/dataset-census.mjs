/**
 * READ-ONLY. Counts how much labelled training data the barangay has already
 * accumulated in production. Prints COUNTS ONLY - no narrative text, no names,
 * no identifiers ever leave this script.
 *
 *   node scripts/dataset-census.mjs
 */
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
const h = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

/** Counts rows matching a filter, using the PostgREST count header. */
async function count(table, query = "") {
  const res = await fetch(`${url}/rest/v1/${table}?select=id${query}`, {
    method: "GET",
    headers: { ...h, Range: "0-0", Prefer: "count=exact" },
  });
  const header = res.headers.get("content-range");
  if (!header) return { ok: false, error: `${res.status}` };
  return { ok: true, n: Number(header.split("/")[1]) };
}

/** Grouped tally by one column, no row contents. */
async function groupBy(table, column) {
  const res = await fetch(
    `${url}/rest/v1/${table}?select=${column}&${column}=not.null&limit=100000`,
    { headers: h }
  );
  if (!res.ok) return { error: `${res.status}` };
  const rows = await res.json();
  const tally = {};
  for (const r of rows) {
    const v = r[column] ?? "(null)";
    tally[v] = (tally[v] || 0) + 1;
  }
  return { total: rows.length, tally };
}

console.log("\n=== PRODUCTION DATASET CENSUS (counts only) ===\n");

const total = await count("complaints");
console.log(`complaints total                          : ${total.ok ? total.n : "ERR " + total.error}`);

const withNarrative = await count("complaints", "&description=not.is.null");
console.log(`  with a narrative (describable text)     : ${withNarrative.ok ? withNarrative.n : "ERR " + withNarrative.error}`);

const predicted = await count("complaints", "&predicted_case_type=not.is.null");
console.log(`  with an AI prediction                   : ${predicted.ok ? predicted.n : "ERR " + predicted.error}`);

const confirmed = await count("complaints", "&confirmed_case_type=not.is.null");
console.log(`  with an OFFICIAL confirmation (LABELLED): ${confirmed.ok ? confirmed.n : "ERR " + confirmed.error}`);

const reviews = await count("complaint_reviews", "&confirmed_case_type=not.is.null");
console.log(`  complaint_reviews rows with a decision  : ${reviews.ok ? reviews.n : "ERR " + reviews.error}`);

const logs = await count("complaint_classification_logs");
console.log(`  complaint_classification_logs rows      : ${logs.ok ? logs.n : "ERR " + logs.error}`);

// Where the confirmed labels disagree with the model - the highest-value
// training examples, because they are exactly where the model is wrong.
const disagree = await count(
  "complaints",
  "&confirmed_case_type=not.is.null&predicted_case_type=neq.confirmed_case_type"
);
console.log(
  `  >>> model DISAGREED with the official   : ${disagree.ok ? disagree.n : "ERR " + disagree.error}` +
    (disagree.ok && total.ok && total.n > 0
      ? `  (${((disagree.n / total.n) * 100).toFixed(1)}% of all complaints)`
      : "")
);

const label = await groupBy("complaints", "confirmed_case_type");
if (!label.error) {
  console.log(`\nconfirmed_case_type breakdown (${label.total} labelled rows):`);
  for (const [k, v] of Object.entries(label.tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(5)}  ${k}`);
  }
}

const urg = await groupBy("complaints", "confirmed_urgency");
if (!urg.error) {
  console.log(`\nconfirmed_urgency breakdown (${urg.total} labelled rows):`);
  for (const [k, v] of Object.entries(urg.tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(5)}  ${k}`);
  }
}

console.log(`
------------------------------------------------------------------
WHAT THIS MEANS
  Each complaint with confirmed_case_type is one labelled example:
      (complaints.description)  ->  confirmed_case_type / confirmed_urgency
  That is exactly the (text, label) pair a classifier trains on.
  The predicted_* columns are kept alongside, so you can also measure
  where the model was wrong without re-labelling anything.
`);
