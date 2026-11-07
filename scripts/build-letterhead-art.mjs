/**
 * Rebuilds lib/reklamo/letterheadArt.js from the barangay's blank form.
 *
 * The letterhead art (the SK seal, the flag banner, the Barangay Abuno seal and
 * the City of Iligan seal) lives only inside the Word master, but the Reklamo
 * Form is generated programmatically — no master is loaded at runtime. The art
 * is therefore extracted here, once, and committed as base64 so the generator
 * can embed it:
 *
 *   - in the server route that issues the resident's submitted copy, and
 *   - in the browser, where ReklamoPanel renders the official copy
 *     (a browser bundle cannot read files with `fs`, so the bytes ship in
 *      the module instead).
 *
 * Source of truth: Files/Reklamo_Template.docx -> word/media/image1-4.png.
 * Re-run after changing the master:  node scripts/build-letterhead-art.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = path.join(REPO, "Files", "Reklamo_Template.docx");
const OUT = path.join(REPO, "lib", "reklamo", "letterheadArt.js");

/** The master's media parts, in the order they are anchored on the letterhead. */
const PARTS = [
  ["SK_SEAL", "word/media/image1.png", "Sangguniang Kabataan seal, anchored at the letterhead's left."],
  ["FLAG_BANNER", "word/media/image2.png", "Philippine flag banner painted behind the whole letterhead."],
  ["BARANGAY_SEAL", "word/media/image3.png", "Barangay Abuno seal, above the Republic line."],
  ["CITY_SEAL", "word/media/image4.png", "City of Iligan seal, at the letterhead's right."],
];

const zip = new PizZip(readFileSync(MASTER));

const entries = PARTS.map(([name, part, role]) => {
  const file = zip.file(part);
  if (!file) throw new Error(`${MASTER} is missing ${part}.`);
  const bytes = file.asUint8Array();
  let sum = 0;
  for (const b of bytes) sum = (sum + b) % 0xffffffff;
  return { name, part, role, bytes, checksum: (sum >>> 0).toString(16).padStart(8, "0") };
});

const lines = [];
lines.push("/**");
lines.push(" * Letterhead art for the generated Reklamo Form.");
lines.push(" *");
lines.push(" * GENERATED FILE — do not edit by hand.");
lines.push(" * Regenerate with:  node scripts/build-letterhead-art.mjs");
lines.push(" *");
lines.push(" * Extracted from the barangay's blank form (Files/Reklamo_Template.docx,");
lines.push(" * word/media/image1-4.png), which is the printed form this generator must");
lines.push(" * reproduce. The Reklamo is built as a DOCX object model rather than filled");
lines.push(" * into that master, so the art is carried here as base64.");
lines.push(" *");
lines.push(" * The bytes ship in the module instead of being read from disk because the");
lines.push(" * same generator runs in two places: the server route that issues the");
lines.push(" * resident's submitted copy, and the browser, where the Captain Portal");
lines.push(" * renders the official copy. Load it with `await loadLetterheadArt()` only");
lines.push(" * when a document is actually being generated, so the bytes never join the");
lines.push(" * initial page bundle.");
lines.push(" */");
lines.push("");
for (const e of entries) {
  lines.push(`/** ${e.role} — ${e.part}, ${e.bytes.length} bytes (crc ${e.checksum}). */`);
  lines.push(`const ${e.name} =`);
  const b64 = Buffer.from(e.bytes).toString("base64");
  for (let i = 0; i < b64.length; i += 100) {
    lines.push(`  "${b64.slice(i, i + 100)}" +`);
  }
  lines[lines.length - 1] = lines[lines.length - 1].replace(/ \+$/, ";");
  lines.push("");
}

lines.push(`/** Original pixel size of each art piece, as the master lays it out. */`);
lines.push("export const LETTERHEAD_ART_SIZE = {");
lines.push("  skSeal: { width: 88.8, height: 76.66,");
lines.push("    emu: { width: 845820, height: 730250 } },");
lines.push("  flagBanner: { width: 880.8, height: 212.6,");
lines.push("    emu: { width: 8389620, height: 2025015 } },");
lines.push("  barangaySeal: { width: 92.8, height: 92.8,");
lines.push("    emu: { width: 883920, height: 883920 } },");
lines.push("  citySeal: { width: 94, height: 94,");
lines.push("    emu: { width: 895350, height: 895350 } },");
lines.push("};");
lines.push("");
lines.push("function decode(base64) {");
lines.push("  if (typeof atob === \"function\") {");
lines.push("    const binary = atob(base64);");
lines.push("    const out = new Uint8Array(binary.length);");
lines.push("    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);");
lines.push("    return out;");
lines.push("  }");
lines.push("  return Buffer.from(base64, \"base64\");");
lines.push("}");
lines.push("");
lines.push("let cached = null;");
lines.push("");
lines.push("/**");
lines.push(" * Decodes the four letterhead images. Cached: a document set is generated");
lines.push(" * repeatedly against one process or one browser session.");
lines.push(" *");
lines.push(" * @returns {Promise<{ skSeal: Uint8Array, flagBanner: Uint8Array,");
lines.push(" *   barangaySeal: Uint8Array, citySeal: Uint8Array }>}");
lines.push(" */");
lines.push("export async function loadLetterheadArt() {");
lines.push("  if (cached) return cached;");
lines.push("  cached = {");
lines.push("    skSeal: decode(SK_SEAL),");
lines.push("    flagBanner: decode(FLAG_BANNER),");
lines.push("    barangaySeal: decode(BARANGAY_SEAL),");
lines.push("    citySeal: decode(CITY_SEAL),");
lines.push("  };");
lines.push("  return cached;");
lines.push("}");
lines.push("");

writeFileSync(OUT, lines.join("\n"), "utf8");

const total = entries.reduce((n, e) => n + e.bytes.length, 0);
console.log(`wrote ${path.relative(REPO, OUT)}`);
for (const e of entries) {
  console.log(`  ${e.name.padEnd(16)} ${String(e.bytes.length).padStart(7)} bytes  crc ${e.checksum}`);
}
console.log(
  `  total ${total} bytes -> ${(Buffer.byteLength(lines.join("\n"), "utf8") / 1024).toFixed(0)} KB module`
);
