// Verification harness for the programmatic Reklamo Form renderer. Run with:
//   npm run test:reklamo
//
// The Reklamo Form is generated from scratch (no master template, no token
// placeholders), so this harness builds the field model and the DOCX with the
// same module the resident and captain generators use, and validates the
// output end to end against the printed layout the barangay signs.
import crypto from "node:crypto";
import PizZip from "pizzip";
import {
  buildReklamoFormModel,
  renderReklamoFormDocx,
  REKLAMO_SIGNOFF_NAME,
  REKLAMO_SIGNOFF_TITLE,
} from "../lib/reklamo/reklamoForm.js";
import { nextReklamoVersion, reklamoDocxFileIdentifier, reklamoFormDocxFileName } from "../lib/reklamo/reklamoDocument.js";

const failures = [];
const check = (label, condition, detail = "") => {
  if (condition) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
};

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

async function extractParts(blob) {
  const zip = new PizZip(new Uint8Array(await blob.arrayBuffer()));
  const xml = zip.file("word/document.xml").asText();
  const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
    .join("");
  return { zip, xml, text };
}

const data = buildReklamoFormModel({
  complaint: {
    barangay_case_number: "AB-2026-0017",
    title: "Vandalism",
    description:
      "Someone spray-painted the waiting shed last night.\n\nSecond paragraph of the resident's own account.",
    official_received_at: "2026-10-05T07:51:21.804859+00",
  },
  complainantName: "Juan Dela Cruz Sr.",
  complainantAddressLine1: "Unit 4, Mabini Street",
  complainantAddressLine2: "Zone 1 Proper, Abuno, Iligan City",
  respondentName: "",
  respondentAddressLine1: "",
  respondentAddressLine2: "",
  narrative:
    "Someone spray-painted the waiting shed last night.\n\nSecond paragraph of the resident's own account.",
  now: new Date("2026-10-08T12:00:00+08:00"),
});

console.log("\n1. data model (keys and semantics match the token days)");
check("case number", data.case_number === "AB-2026-0017");
check("case for", data.case_for === "Vandalism");
check("field names are the snapshot keys", JSON.stringify(Object.keys(data).sort()).includes('"complainant_name"') && JSON.stringify(Object.keys(data).sort()).includes('"complaint_narrative"'));
check("narrative verbatim", data.complaint_narrative.startsWith("Someone spray-painted"));
check("prepared month is October", data.prepared_month === "October");
check("received month is October", data.received_month === "October");
check("respondent blank", data.respondent_name === "");

console.log("\n2. render");
let blob;
try {
  blob = await renderReklamoFormDocx(data);
  check("render completed", true);
} catch (error) {
  check("render completed", false, `${error.name}: ${error.message}`);
  process.exit(1);
}
const out = new Uint8Array(await blob.arrayBuffer());
check("output is a zip", out[0] === 0x50 && out[1] === 0x4b);
check(
  "postal page is US Letter",
  /<w:pgSz[^>]*w:w="12240"[^>]*w:h="15840"[^>]*\/>/.test(await extractParts(blob).then((r) => r.xml)),
  "must remain letter so it prints on the SAME local paper"
);

const { zip, xml, text } = await extractParts(blob);

console.log("\n3. printed values");
check("no {{ remains", !xml.includes("{{") && !xml.includes("}}"));
check(
  "complainant name printed twice (header + signature)",
  xml.split("Juan Dela Cruz Sr.").length - 1 === 2
);
check("address line1", text.includes("Unit 4, Mabini Street"));
check("address line2", text.includes("Zone 1 Proper, Abuno, Iligan City"));
check("case number printed", text.includes("AB-2026-0017"));
check("For: Vandalism", text.includes("For: Vandalism"));

console.log("\n4. narrative");
check("narrative first line present", text.includes("Someone spray-painted the waiting shed last night."));
check("narrative second paragraph present", text.includes("Second paragraph of the resident"));
check(
  "narrative newlines became <w:br/>",
  /last night\.<\/w:t><\/w:r><w:r><w:br\/><\/w:r><w:r>[\s\S]*?<w:br\/><\/w:r>/.test(xml)
);

console.log("\n5. layout preserved");
check("static Punong Barangay name", REKLAMO_SIGNOFF_NAME === "EDUARD A. LARANIO" && text.includes("EDUARD A. LARANIO"));
check("static title", REKLAMO_SIGNOFF_TITLE === "Punong Barangay/Lupon Chairman" && text.includes("Punong Barangay/Lupon Chairman"));
check("REKLAMO heading", text.replace(/\s+/g, " ").includes("R E K L A M O"));
check("letterhead", text.includes("BARANGAY ABUNO") && /Office of the[\s\S]*Sangguniang Barangay/.test(text));
check("Hiligaynon signature line", text.includes("Nadawat ug gitipigan"));
check("Gihimo sentence kept", text.includes("Gihimo ning ika"));
check("respondent section kept", text.includes("Batok Kang") && text.includes("Respondent/Sinumbong"));
check("complainant label kept", text.includes("Nagsumbong"));
check("no template bucket artifacts", !Object.keys(zip.files).some((n) => n === "masters/") && !text.includes("{{token"));
check("prepared day printed", /ika\s*8\s*bulan\s*October/.test(text.replace(/\s+/g, " ")));
check("received day printed", /ika\s*5\s*bulan sa\s*October\s*tuig/.test(text.replace(/\s+/g, " ")));
check("no raw markup in slate", !/&lt;w:/.test(xml));

console.log("\n5b. polished layout blocks");
check("letterhead breaks into two office lines", /Office of the[\s\S]*Sangguniang Barangay/.test(text));
check(
  "case info uses the actual case number",
  // The barangay's blank form writes "Barangay Case No." with no colon and a
  // printed rule after it; a numbered case replaces that rule with the number.
  text.includes("Barangay Case No. AB-2026-0017"),
  "must not print the blank on an already-numbered case"
);
// Scoped to the respondent block: the printed form also rules the wet
// signature line, so a whole-document underscore count couples this check to
// an unrelated field. Comparing the whole block instead asserts the caption,
// exactly one paper blank, and the closing label - and nothing else.
const respondentBlockText = /Batok Kang[\s\S]*?Respondent\/Sinumbong/.exec(text)?.[0] || "";
check(
  "missing respondent prints exactly one blank name line",
  respondentBlockText === "Batok Kang______________________Respondent/Sinumbong",
  "a missing respondent keeps one paper-form blank, never filler text"
);
check(
  "complainant and case hold separate cells",
  text.includes("Complainant/Nagsumbong") && text.includes("For: Vandalism")
);
check("respondent is NOT inside the case info cell", /Barangay Case No\. AB-2026-0017[\s\S]*Batok Kang/.test(text));
check("received line present after reformat", text.includes("Nadawat ug gitipigan"));

console.log("\n6. failure paths");
const noCase = (() => {
  try {
    buildReklamoFormModel({ complaint: { title: "Theft" }, narrative: "x" });
    return null;
  } catch (e) {
    return e;
  }
})();
check("refuses a case with no barangay case number", noCase !== null && /case number/i.test(noCase.message));

console.log("\n7. versioning");
check("next version after v1+v2 is 3", nextReklamoVersion([{ document_type: "reklamo_form", version: 1 }, { document_type: "reklamo_form", version: 2 }]) === 3);
check("first version is 1", nextReklamoVersion([]) === 1);
check(
  "storage file name",
  reklamoFormDocxFileName("AB-2026-0017", 3) === "reklamo-form-AB-2026-0017-v3.docx",
  reklamoFormDocxFileName("AB-2026-0017", 3)
);

console.log("\n8. submitted stage (resident auto-generation)");
const submitted = buildReklamoFormModel({
  complaint: {
    reference_number: "ABN-2026-000123",
    title: "Fence Boundary Conflict",
    description:
      "Niadtong October 9, 2026, adunay panaglalis namo ni Mark Anthony Dela Cruz bahin sa boundary sa among mga yuta. Matod niya, parte sa akong bakod nakaabot kuno sa ilang property, apan base sa among daang boundary markers, naa ra sa among side ang bakod. Nagkaroon mi og lalis tungod niini ug dili mi magkasabot kung asa gyud ang sakto nga boundary. Gusto nako nga matawag mi duha sa barangay aron maistoryahan ug ma-settle ang among dispute sa malinawon nga paagi.",
    submitted_at: "2026-09-09T13:17:00+00:00",
  },
  complainantName: "Riza Oyangorin",
  complainantAddressLine1: "ANAS",
  complainantAddressLine2: "Purok 1, Abuno, Iligan City",
  respondentName: "Mark Anthony Dela Cruz",
  respondentAddressLine1: "",
  respondentAddressLine2: "",
  narrative:
    "Niadtong October 9, 2026, adunay panaglalis namo ni Mark Anthony Dela Cruz bahin sa boundary sa among mga yuta. Matod niya, parte sa akong bakod nakaabot kuno sa ilang property, apan base sa among daang boundary markers, naa ra sa among side ang bakod. Nagkaroon mi og lalis tungod niini ug dili mi magkasabot kung asa gyud ang sakto nga boundary. Gusto nako nga matawag mi duha sa barangay aron maistoryahan ug ma-settle ang among dispute sa malinawon nga paagi.",
  now: new Date("2026-10-10T12:00:00+08:00"),
  requireCaseNumber: false,
});
check("submitted case number is blank", submitted.case_number === "");
check("submitted prepared month is October", submitted.prepared_month === "October");
check(
  "submitted received blanks when not yet official",
  submitted.received_day === "" && submitted.received_month === "" && submitted.received_year === "",
  JSON.stringify({ day: submitted.received_day, month: submitted.received_month, year: submitted.received_year })
);
check("submitted respondent prints as filed", submitted.respondent_name === "Mark Anthony Dela Cruz");
check("submitted case-for is the complaint title", submitted.case_for === "Fence Boundary Conflict");

let submittedBlob;
try {
  submittedBlob = await renderReklamoFormDocx(submitted);
  check("submitted render completed", true);
} catch (error) {
  check("submitted render completed", false, `${error.name}: ${error.message}`);
}
const submittedXml = await extractParts(submittedBlob).then((r) => r.xml);
check("submitted render leaves no braces", !submittedXml.includes("{{"));

const submittedText = await extractParts(submittedBlob).then((r) => r.text);
const submittedNorm = submittedText.replace(/\s+/g, " ");
check(
  "blank case number renders as a printer blank",
  submittedNorm.includes("Barangay Case No. ______________________"),
  "an unassigned official number is a blank field on the form, not a status word"
);
check(
  "no Submitted online wording in the form",
  !submittedNorm.includes("Submitted online") &&
    !submittedNorm.includes("Submission date") &&
    !submittedNorm.includes("Resident portal"),
  "the submission timestamp belongs to the audit trail, not the paper"
);
check(
  "Submitted online can never be claimed by any version",
  !submittedNorm.includes("Submitted online:"),
  "the portal label must not appear anywhere in the document"
);
check(
  "submitted copy has no blank signature lines",
  (submittedText.match(/______________________/g) || []).length === 1 &&
    submittedText.includes("Barangay Case No. ______________________"),
  "the only written blank is the unassigned case-number field, never a signature slip"
);
check(
  "Nadawat blank remains when not officially received",
  submittedNorm.includes("Nadawat ug gitipigan niining ika ____ bulan sa __________ tuig ______."),
  "the official-receipt line keeps its blank date fields, never a fabricated date"
);
check(
  "submitted copy never fabricates a receipt date",
  !/ika\s*\d+\s*bulan sa __/.test(submittedNorm) && !submittedNorm.includes("bulan sa 2026"),
  "official_received_at is the only source for the receipt date"
);

const paragraphBlocks = [...submittedXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((m) => m[0]);
const isCentered = (xml) => /<w:jc w:val="center"\/>/.test(xml) || /<w:jc w:val="center"\s*\/?>/.test(xml);
const paragraphContaining = (needle) =>
  paragraphBlocks.find((block) => block.replace(/<[^>]+>/g, "").includes(needle));
check(
  "respondent block is below the complainant block",
  /Complainant\/Nagsumbong[\s\S]*Batok Kang[\s\S]*Mark Anthony Dela Cruz[\s\S]*Respondent\/Sinumbong[\s\S]*R E K L A M O/.test(submittedText),
  "order must be complainant, then respondent, then the narrative title"
);
check(
  "respondent labels are not centered in the page",
  !isCentered(paragraphContaining("Batok Kang") || "") &&
    !isCentered(paragraphContaining("Mark Anthony Dela Cruz") || "") &&
    !isCentered(paragraphContaining("Respondent/Sinumbong") || ""),
  "Batok Kang and the respondent labels left-align with the complainant"
);
check(
  "complainant labels are not centered either",
  !isCentered(paragraphContaining("Riza Oyangorin") || "") &&
    !isCentered(paragraphContaining("Complainant/Nagsumbong") || ""),
  "an unboxed two-column table, not centered page text"
);
check(
  "R E K L A M O stays centered",
  ["R", "E", "K", "L", "A", "M", "O"].length > 0 && isCentered(paragraphContaining("R E K L A M O") || ""),
  "the tiltle line is the one centered heading"
);
check(
  "narrative prints without an underline border",
  !/<w:pBdr>[\s\S]*?<w:bottom/.test(submittedXml),
  "the paragraph must not carry a bottom rule under the text"
);
// The barangay's own blank form builds its letterhead from a borderless
// three-cell table, so the four seals and the flag can be anchored to it. The
// rule the old paragraph-only layout enforced still holds and is now checked
// directly instead of by proxy: the letterhead must read as plain centered
// text with no box drawn around it, and the case-information table must still
// begin below it rather than wrapping the letterhead.
const firstTableStart = submittedXml.indexOf("<w:tbl");
const letterheadTableXml = submittedXml.slice(firstTableStart, submittedXml.indexOf("</w:tbl>", firstTableStart));
const caseInfoTableAfterLetterhead =
  submittedXml.indexOf("<w:tbl>", submittedXml.indexOf("Sangguniang Barangay")) >
  submittedXml.indexOf("Sangguniang Barangay");
check(
  "letterhead is plain centered body text, not a bordered box",
  (["Republic of the Philippines", "City of Iligan", "BARANGAY ABUNO", "Office of the", "Sangguniang Barangay"].every(
    (line) => isCentered(paragraphContaining(line) || "")
  )) &&
    /<w:tblBorders>[\s\S]*?<\/w:tblBorders>/.test(letterheadTableXml) &&
    !/<w:(?:top|left|bottom|right|insideH|insideV) w:val="(?!none)/.test(letterheadTableXml) &&
    caseInfoTableAfterLetterhead,
  "the letterhead must be an unbordered centered block, with the case-info table below it"
);

check(
  "official build still refuses a blank case number",
  (() => {
    try {
      buildReklamoFormModel({
        complaint: { reference_number: "ABN-2026-000123", title: "x" },
        narrative: "y",
      });
      return false;
    } catch (e) {
      return /case number/i.test(e.message);
    }
  })()
);
check(
  "file identifier falls back to the reference number",
  reklamoDocxFileIdentifier({ reference_number: "ABN-2026-000123" }) === "ABN-2026-000123"
);
check(
  "file name from reference before case is numbered",
  reklamoFormDocxFileName("ABN-2026-000123", 1) === "reklamo-form-ABN-2026-000123-v1.docx",
  reklamoFormDocxFileName("ABN-2026-000123", 1)
);

console.log("\n9. two-resident isolation");
const caseB = {
  barangay_case_number: "AB-2026-0002",
  title: "Loan dispute",
  description: "Unpaid loan for a sack of rice.",
  official_received_at: "2026-07-21T02:00:00Z",
};
const dataB = buildReklamoFormModel({
  complaint: caseB,
  complainantName: "Maria Santos",
  complainantAddressLine1: "Purok 1",
  complainantAddressLine2: "Abuno",
  respondentName: "Pedro Santos",
  respondentAddressLine1: "Purok 5",
  respondentAddressLine2: "Abuno",
  narrative: caseB.description,
  now: new Date("2026-10-08T12:00:00+08:00"),
});
const blobB = await renderReklamoFormDocx(dataB);
const bText = await extractParts(blobB).then((r) => r.text);
check("A does NOT carry B's case number", !text.includes("AB-2026-0002"));
check("A does NOT carry B's narrative", !text.includes("Unpaid loan"));
check("B carries B's own case number", bText.includes("AB-2026-0002"));
check("A and B are not byte-identical", sha(out) !== sha(new Uint8Array(await blobB.arrayBuffer())));

console.log("\n10. DOCX package validation");
const requiredParts = ["[Content_Types].xml", "word/document.xml", "word/_rels/document.xml.rels"];
const missing = requiredParts.filter((name) => !zip.file(name));
check("required DOCX parts present", missing.length === 0, missing.join(", "));
check("document.xml is well-formed XML", (() => {
  try {
    const stack = [];
    const tagPattern = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s[^<>]*?)?)(\/?)>/g;
    let match;
    while ((match = tagPattern.exec(xml))) {
      const [, closing, name, , selfClosing] = match;
      if (selfClosing === "/") continue;
      if (closing === "/") {
        const top = stack.pop();
        if (top !== name) return false;
      } else stack.push(name);
    }
    return stack.length === 0;
  } catch {
    return false;
  }
})());
const textContent = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
  .map((m) => m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"))
  .join("");
check(
  "no WordprocessingML markup inside text nodes",
  !/<w:|<\/w:|<w:p|<w:r|<w:t|<w:sectPr/.test(textContent),
  "escaped <w:...> must never print as text"
);
check(
  "no raw OOXML fragments anywhere in visible text",
  !/&lt;w:/.test(xml),
  "the old double-wrapped markup bug must not reappear"
);

console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
process.exit(failures.length ? 1 : 0);