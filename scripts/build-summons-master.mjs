// Derives the Respondent Summons master from the Notice of Hearing master,
// using the EXACT blank rules exported by the field-map module so the master
// and the field map can never drift apart. Keeps the letterhead table (all
// logos + watermark) and the signature + footer byte-for-byte; replaces only
// the title + body with summons wording. Regenerate + re-upload after running.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";
import { RULE40, RULE24, SUMMONS_BODY_BLANK, ISSUE_BLANK } from "../lib/hearing/respondentSummonsDocx.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(REPO, "Files", "Notice_of_Hearing_Template.docx");
const OUT = path.join(REPO, "Files", "Summons_Template.docx");

const title =
  `<w:p><w:pPr><w:spacing w:after="480"/><w:jc w:val="center"/></w:pPr>` +
  `<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>` +
  `<w:t>SUMMONS</w:t></w:r></w:p>`;

const toLine =
  `<w:p><w:r><w:t xml:space="preserve">To: </w:t></w:r><w:r><w:t>${RULE40}</w:t></w:r></w:p>`;
const addrLine = `<w:p><w:r><w:t>${RULE40}</w:t></w:r></w:p>`;
const reLine =
  `<w:p><w:r><w:t xml:space="preserve">Re:  Case No. </w:t></w:r><w:r><w:t>${RULE24}</w:t></w:r></w:p>`;
const complainantLine =
  `<w:p><w:r><w:t xml:space="preserve">Complainant/s: </w:t></w:r><w:r><w:t>${RULE40}</w:t></w:r></w:p>`;

const bodySentence =
  `<w:p><w:pPr><w:spacing w:after="240" w:line="360" w:lineRule="auto"/></w:pPr>` +
  `<w:r><w:t xml:space="preserve">${SUMMONS_BODY_BLANK}</w:t></w:r>` +
  `<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t>morning/afternoon</w:t></w:r>` +
  `<w:r><w:t xml:space="preserve"> for the amicable settlement of the complaint filed against you.</w:t></w:r></w:p>`;

const warning =
  `<w:p><w:pPr><w:spacing w:after="240" w:line="360" w:lineRule="auto"/></w:pPr>` +
  `<w:r><w:t>You are required to be present at the said hearing. Failure to appear without justifiable reason may result in the issuance of a Certificate to File Action.</w:t></w:r></w:p>`;

const issueLine = `<w:p><w:r><w:t>${ISSUE_BLANK}</w:t></w:r></w:p>`;

const NEW_BODY =
  title + toLine + addrLine + reLine + complainantLine + bodySentence + warning + issueLine;

const zip = new PizZip(readFileSync(SRC));
const PART = "word/document.xml";
const xml = zip.file(PART).asText();
const bodyStart = xml.indexOf("<w:body>") + "<w:body>".length;
const bodyEnd = xml.indexOf("<w:sectPr");
const body = xml.slice(bodyStart, bodyEnd);

const childRx = /<w:(p|tbl)(?:\s[^>]*)?>[\s\S]*?<\/w:\1>/g;
const children = [...body.matchAll(childRx)];
const HEAD = children.slice(0, 5).map((m) => m[0]).join("");
const TAIL = children.slice(11).map((m) => m[0]).join("");

const newXml = xml.slice(0, bodyStart) + HEAD + NEW_BODY + TAIL + xml.slice(bodyEnd);
zip.file(PART, newXml);
const outBytes = zip.generate({ type: "nodebuffer" });
writeFileSync(OUT, outBytes);
console.log(`Wrote ${OUT} (${outBytes.length} bytes)`);

const paras = [...newXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];
console.log(`Total paragraphs: ${paras.length}`);
paras.forEach((m, i) => {
  const nodes = [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)];
  const preview = nodes.map((t) => t[1]).join(" | ").slice(0, 80);
  console.log(`  p${i + 1} (t=${nodes.length}): ${preview}`);
});
