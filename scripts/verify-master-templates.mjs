/**
 * Verifies the master-template DOCX engine against the real hearing masters.
 *
 *   node scripts/verify-master-templates.mjs
 *
 * The Notice of Hearing and the Respondent Summons are the two remaining
 * master-based forms (the Reklamo Form is generated programmatically now).
 * Each is rendered from the untouched master in Files for two deliberately
 * different synthetic cases, and the script checks that:
 *
 *   - every field resolves and nothing is left as an unresolved {{token}}
 *   - the letterhead, table, signature block and page furniture survive
 *   - the hearing date, time and venue come from the saved hearing row
 *   - the signatory printed in the master is replaced by the official profile
 *   - Resident A's data cannot appear in Resident B's document, and vice versa
 *   - the master on disk is byte-for-byte unchanged afterwards
 *
 * Set OUT_DIR to also write the generated documents out for inspection.
 * This script reads the masters from disk rather than from the `templates`
 * bucket so it can be run without Supabase credentials; the bytes are the same.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderDocx } from "../lib/documents/docxTemplate.js";
import {
  buildNoticeOfHearingData,
  noticeOfHearingFields,
} from "../lib/hearing/noticeOfHearingDocx.js";
import {
  buildRespondentSummonsData,
  respondentSummonsFields,
} from "../lib/hearing/respondentSummonsDocx.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = path.join(REPO, "Files");
const OUT = process.env.OUT_DIR || null;

const MASTERS = {
  hearing_notice: path.join(FILES, "Notice_of_Hearing_Template.docx"),
  summons: path.join(FILES, "Summons_Template.docx"),
};

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

/** Reads a generated .docx back out as plain text. */
async function extractText(blob) {
  const { default: PizZip } = await import("pizzip");
  const zip = new PizZip(new Uint8Array(await blob.arrayBuffer()));
  const xml = zip.file("word/document.xml").asText();
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((m) =>
    [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((t) => t[1])
      .join("")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
  );
  return { xml, paragraphs, all: paragraphs.join("\n") };
}

const BEFORE = Object.fromEntries(
  Object.entries(MASTERS).map(([k, p]) => [k, sha(readFileSync(p))])
);

const CAPTAIN = { display_name: "RODRIGO C. SAYSON", role: "captain" };
const SECRETARY = { display_name: "RICARDO P. SAYSON", role: "secretary" };

const caseA = {
  id: "11111111-1111-4111-8111-111111111111",
  barangay_case_number: "AB-2026-0001",
  reference_number: "AB-2026-0001",
  created_at: "2026-06-01T02:00:00Z",
  description: "Neighbor withheld the agreed rental deposit since January.",
};
const caseB = {
  id: "22222222-2222-4222-8222-222222222222",
  barangay_case_number: "AB-2026-0002",
  reference_number: "AB-2026-0002",
  created_at: "2026-06-05T02:00:00Z",
  description: "Boundary wall dispute over the eastern lot marker.",
};

const hearingA = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  hearing_date: "2026-06-10",
  hearing_time: "14:00:00",
  venue: "Abuno Barangay Hall",
  title: "First Hearing",
  status: "Upcoming",
};
const hearingB = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  // Deliberately a different YEAR from case A, so a form that accidentally
  // prints the year the master was authored in cannot pass.
  hearing_date: "2027-07-21",
  hearing_time: "09:30:00",
  venue: "Lupon Room",
  title: "First Hearing",
  status: "Upcoming",
};

// The two cases deliberately share a name across roles: A's respondent is B's
// complainant. That is realistic and is exactly what makes the isolation check
// meaningful rather than trivial.
const docA = {
  complaint: caseA,
  complainant: "JUAN DELA CRUZ",
  respondent: "PEDRO SANTOS",
  respondentAddress: "Purok 5, Abuno",
  narrative: caseA.description,
  hearing: hearingA,
  officialProfile: CAPTAIN,
};
const docB = {
  complaint: caseB,
  complainant: "PEDRO SANTOS",
  respondent: "MARIA SANTOS",
  respondentAddress: "Purok 1, Abuno",
  narrative: caseB.description,
  hearing: hearingB,
  officialProfile: SECRETARY,
};

console.log("\n== NOTICE OF HEARING ==");
const noticeMaster = readFileSync(MASTERS.hearing_notice);
const noticeA = renderDocx(new Uint8Array(noticeMaster), noticeOfHearingFields(), buildNoticeOfHearingData(docA));
const noticeB = renderDocx(new Uint8Array(noticeMaster), noticeOfHearingFields(), buildNoticeOfHearingData(docB));
const nA = await extractText(noticeA);
const nB = await extractText(noticeB);

check("renders as a readable docx", nA.xml.includes("NOTICE OF HEARING"));
check("letterhead table preserved", nA.xml.includes("<w:tbl>") && nA.all.includes("BARANGAY ABUNO"));
check("no unresolved {{token}}", !nA.xml.includes("{{"), nA.xml.match(/\{\{[^}]*\}\}/g)?.join(","));
check(
  "hearing date/time printed from the saved schedule",
  nA.all.includes("10 day of June 2026 at 2:00 o\u2019clock in the afternoon"),
  nA.paragraphs.find((p) => p.includes("hereby required"))
);
check("master's hard-coded 2026 replaced by the saved year", !/of _+ 2026/.test(nA.all));
check("hard-coded signatory RITCHEL P. SAYSON removed", !nA.all.includes("RITCHEL P. SAYSON"));
check("master's printed office title replaced", nA.all.includes("Punong Barangay/Lupon Chairman"));
check("A: respondent on the To: line", nA.paragraphs[12] === "To: PEDRO SANTOS", JSON.stringify(nA.paragraphs[12]));
check("A: respondent address on the second ruled line", nA.paragraphs[13] === "Purok 5, Abuno", JSON.stringify(nA.paragraphs[13]));
check("A: complainant after the caption", nA.paragraphs[14] === "Complainant/s: JUAN DELA CRUZ", JSON.stringify(nA.paragraphs[14]));
check("A: blank line kept above the signature", nA.paragraphs[17] === "", JSON.stringify(nA.paragraphs[17]));
check("A: signature block sits below the blank line", nA.paragraphs[18] === "RODRIGO C. SAYSON" && nA.paragraphs[19] === "Punong Barangay/Lupon Chairman", JSON.stringify(nA.paragraphs.slice(17, 20)));
check("A: blank line kept below the office title", nA.paragraphs[20] === "", JSON.stringify(nA.paragraphs[20]));
check("A: receipt block still follows the signature", nA.paragraphs[21] === "Received by Complainant/s", JSON.stringify(nA.paragraphs[21]));
check("issued date filled in", /This \d+ day of \w+ \d{4}\./.test(nA.all), nA.paragraphs.find((p) => p.startsWith("This ")));
check("footer furniture kept (O.R No. / Doc. Stamp)", nA.all.includes("O.R No.") && nA.all.includes("Doc. Stamp"));
check("venue NOT invented into the template", !nA.all.includes("Abuno Barangay Hall"));
check("case number NOT invented into the template", !nA.all.includes("AB-2026-0001"));

console.log("\n== TWO-RESIDENT ISOLATION (Notice) ==");
check("A carries A's own hearing", nA.all.includes("10 day of June 2026"));
check("A does NOT carry B's hearing date", !nA.all.includes("21 day of July"));
check("A does NOT carry B's respondent", !nA.all.includes("MARIA SANTOS"));
check("B carries B's own hearing", nB.all.includes("21 day of July 2027 at 9:30 o\u2019clock in the morning"));
check("printed year follows the hearing, not the master's placeholder", nB.all.includes("21 day of July 2027"), nB.paragraphs.find((p) => p.includes("hereby required")));
check("B does NOT carry A's hearing date", !nB.all.includes("10 day of June"));
check("signatory follows the authenticated profile, not the master", nA.all.includes("RODRIGO C. SAYSON") && nB.all.includes("RICARDO P. SAYSON"));

console.log("\n== NOTICE ISSUE DATE ==");
const PRINTED_AT = new Date("2026-10-09T02:00:00Z"); // 9 Oct, 10:00 in Manila
const noticeData = buildNoticeOfHearingData({ ...docA, now: PRINTED_AT });
check("notice issue date is the Manila generation day as YYYY-MM-DD", noticeData.issueDate === "2026-10-09", noticeData.issueDate);
check(
  "notice issue parts agree with the ISO day",
  noticeData.issueDay === "9" && noticeData.issueMonth === "October" && noticeData.issueYear === "2026",
  JSON.stringify([noticeData.issueDay, noticeData.issueMonth, noticeData.issueYear])
);
check(
  "notice issue date is the generation day, never the filing day",
  noticeData.issueDate !== "2026-06-01",
  noticeData.issueDate
);
// A document generated just before Manila midnight must still be dated in
// Manila, not on the previous day in the official's own time zone.
const lateNight = buildNoticeOfHearingData({ ...docA, now: new Date("2026-06-01T17:30:00Z") }); // 1:30am 2 June in Manila
check(
  "an early-morning generation is dated to the Manila day, not the UTC day",
  lateNight.issueDate === "2026-06-02" && lateNight.issueDay === "2",
  `${lateNight.issueDate} / ${lateNight.issueDay}`
);

console.log("\n== RESPONDENT SUMMONS ==");
const summonsMaster = readFileSync(MASTERS.summons);
const sumA = renderDocx(
  new Uint8Array(summonsMaster),
  respondentSummonsFields(),
  buildRespondentSummonsData(docA)
);
const sumB = renderDocx(
  new Uint8Array(summonsMaster),
  respondentSummonsFields(),
  buildRespondentSummonsData(docB)
);
const sA = await extractText(sumA);
const sB = await extractText(sumB);

check("renders as a readable docx", sA.xml.includes("SUMMONS"));
check("letterhead table preserved", sA.xml.includes("<w:tbl>") && sA.all.includes("BARANGAY ABUNO"));
check("no unresolved {{token}}", !sA.xml.includes("{{"), sA.xml.match(/\{\{[^}]*\}\}/g)?.join(","));
check(
  "summons opens with SUMMONS, not NOTICE OF HEARING",
  sA.paragraphs[11] === "SUMMONS" && !sA.all.includes("NOTICE OF HEARING"),
  JSON.stringify(sA.paragraphs[11])
);
check(
  "hearing venue, date and time printed from the saved schedule",
  sA.all.includes(
    "at the Abuno Barangay Hall on the 10 day of June 2026 at 2:00 o'clock in the afternoon"
  ),
  sA.paragraphs.find((p) => p.includes("hereby summoned"))
);
check("master's hard-coded 2026 replaced by the saved year", !/of _+ 2026/.test(sA.all));
check("master's hard-coded signatory removed", !sA.all.includes("RITCHEL P. SAYSON"));
check("master's printed office title replaced", sA.all.includes("Punong Barangay/Lupon Chairman"));
check("A: respondent on the To: line", sA.paragraphs[12] === `To: PEDRO SANTOS`, JSON.stringify(sA.paragraphs[12]));
check("A: respondent address on the second ruled line", sA.paragraphs[13] === "Purok 5, Abuno", JSON.stringify(sA.paragraphs[13]));
check("A: case number on the Re: line", sA.paragraphs[14] === "Re:  Case No. AB-2026-0001", JSON.stringify(sA.paragraphs[14]));
check("A: complainant after the caption", sA.paragraphs[15] === "Complainant/s: JUAN DELA CRUZ", JSON.stringify(sA.paragraphs[15]));
check("warning sentence kept", sA.all.includes("Certificate to File Action"));
check("issued date filled in", /This \d+ day of \w+ \d{4}\./.test(sA.all), sA.paragraphs.find((p) => p.startsWith("This ")));
check("footer furniture kept (O.R No. / Doc. Stamp)", sA.all.includes("O.R No.") && sA.all.includes("Doc. Stamp"));

console.log("\n== TWO-RESIDENT ISOLATION (Summons) ==");
check("A carries A's own hearing", sA.all.includes("10 day of June 2026"));
check("A does NOT carry B's hearing date", !sA.all.includes("21 day of July"));
check("A does NOT carry B's respondent", !sA.all.includes("MARIA SANTOS"));
check("B carries B's own hearing", sB.all.includes("21 day of July 2027 at 9:30 o'clock in the morning"));
check("printed year follows the hearing, not the master's placeholder", sB.all.includes("21 day of July 2027"), sB.paragraphs.find((p) => p.includes("hereby summoned")));
check("B carries B's own venue", sB.all.includes("at the Lupon Room"));
check("signatory follows the authenticated profile, not the master", sA.all.includes("RODRIGO C. SAYSON") && sB.all.includes("RICARDO P. SAYSON"));

console.log("\n== SUMMONS GUARDS ==");
try {
  renderDocx(new Uint8Array(summonsMaster), respondentSummonsFields(), buildRespondentSummonsData({ ...docA, hearing: null }));
  check("refuses to render with no saved hearing", false);
} catch (error) {
  check("refuses to render with no saved hearing", /No hearing schedule has been saved/.test(error.message), error.message);
}
try {
  renderDocx(new Uint8Array(summonsMaster), respondentSummonsFields(), buildRespondentSummonsData({ ...docA, complaint: null }));
  check("refuses to render with no complaint", false);
} catch (error) {
  check("refuses to render with no complaint", /Complaint record could not be found/.test(error.message), error.message);
}
try {
  const drifted = respondentSummonsFields().map((f) => (f.id === "respondent_name" ? { ...f, expect: "SOMETHING ELSE" } : f));
  renderDocx(new Uint8Array(summonsMaster), drifted, buildRespondentSummonsData(docA));
  check("refuses when the master layout has drifted", false);
} catch (error) {
  check("refuses when the master layout has drifted", /layout changed/.test(error.message), error.message);
}
try {
  renderDocx(new Uint8Array(summonsMaster), respondentSummonsFields(), buildRespondentSummonsData({ ...docA, hearing: { ...hearingA, hearing_time: null } }));
  check("refuses when the hearing has no time", false);
} catch (error) {
  check("refuses when the hearing has no time", /no time recorded/.test(error.message), error.message);
}

console.log("\n== MASTER TEMPLATE UNCHANGED ==");
for (const [key, file] of Object.entries(MASTERS)) {
  const after = sha(readFileSync(file));
  check(`${path.basename(file)} unchanged on disk`, after === BEFORE[key], `${BEFORE[key]} -> ${after}`);
}

console.log("\n== GUARDS ==");
try {
  renderDocx(new Uint8Array(noticeMaster), noticeOfHearingFields(), buildNoticeOfHearingData({ ...docA, hearing: null }));
  check("refuses to render with no saved hearing", false);
} catch (error) {
  check("refuses to render with no saved hearing", /No hearing schedule has been saved/.test(error.message), error.message);
}
try {
  const drifted = noticeOfHearingFields().map((f) => (f.id === "complainant" ? { ...f, expect: "SOMETHING ELSE" } : f));
  renderDocx(new Uint8Array(noticeMaster), drifted, buildNoticeOfHearingData(docA));
  check("refuses when the master layout has drifted", false);
} catch (error) {
  check("refuses when the master layout has drifted", /layout changed/.test(error.message), error.message);
}
try {
  renderDocx(new Uint8Array(noticeMaster), noticeOfHearingFields(), buildNoticeOfHearingData({ ...docA, hearing: { ...hearingA, hearing_date: null } }));
  check("refuses when the hearing has no date", false);
} catch (error) {
  check("refuses when the hearing has no date", /No hearing schedule has been saved/.test(error.message), error.message);
}

if (OUT) {
  writeFileSync(path.join(OUT, "gen-notice-A.docx"), Buffer.from(await noticeA.arrayBuffer()));
  writeFileSync(path.join(OUT, "gen-notice-B.docx"), Buffer.from(await noticeB.arrayBuffer()));
  writeFileSync(path.join(OUT, "gen-summons-A.docx"), Buffer.from(await sumA.arrayBuffer()));
  writeFileSync(path.join(OUT, "gen-summons-B.docx"), Buffer.from(await sumB.arrayBuffer()));
  console.log(`\nwrote 4 generated documents to ${OUT}`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);