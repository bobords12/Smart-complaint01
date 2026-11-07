import PizZip from "pizzip";

/**
 * The official master-template engine for the barangay printed forms.
 *
 * The masters in Files/ are the visual authority for the
 * Notice of Hearing, and they are never edited. A generated
 * document is produced like this:
 *
 *   1. read the untouched master out of the private `templates` bucket
 *   2. unzip it in memory (a .docx is a ZIP of XML parts)
 *   3. replace only the blank field text inside word/document.xml
 *   4. write the parts back and download a NEW file
 *
 * Nothing is written back to the master, so every resident's document starts
 * from the same blank form and the template itself carries no resident data.
 *
 * Fidelity comes from how narrowly the replacement is made. Each field names
 * one paragraph and one text node inside it, together with the exact text that
 * node is expected to hold in the master. Only that node's characters are
 * rewritten: the run keeps its own formatting (Book Antiqua, bold, underline,
 * size), and the surrounding line breaks, tables, letterhead images, indents,
 * tab stops and page setup are all left exactly as the barangay authored them.
 *
 * If a master is ever replaced with a layout whose paragraph or text no longer
 * matches, the render refuses and reports the field that drifted. A template
 * change can never silently produce a mislabelled official document.
 */

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const TEMPLATE_BUCKET = "templates";

/** Storage keys of the untouched masters inside the private bucket. */
export const MASTER_TEMPLATES = {
  hearing_notice: "masters/hearing-notice/Notice_of_Hearing_Template.docx",
  summons: "masters/respondent-summons/Summons_Template.docx",
  amicable_settlement: "masters/amicable-settlement/Amicable_settlement.docx",
};

/** File name of each master, for logging and error messages. */
export const MASTER_TEMPLATE_FILES = {
  hearing_notice: "Notice_of_Hearing_Template.docx",
  summons: "Summons_Template.docx",
  amicable_settlement: "Amicable_settlement.docx",
};

export class TemplateRenderError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "TemplateRenderError";
    this.details = details;
  }
}

const PARAGRAPH_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
const TEXT_NODE_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
/** A `{{field_name}}` token, whether or not Word left it in one run. */
const TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeXml(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

/**
 * Reads an untouched master out of the private bucket.
 *
 * RLS on `templates` only grants SELECT to active captain / oic / secretary
 * profiles, so a resident account cannot reach a master at all.
 */
export async function fetchMasterTemplate(supabase, templateKey) {
  const path = MASTER_TEMPLATES[templateKey];
  const file = MASTER_TEMPLATE_FILES[templateKey] || templateKey;

  if (!path) {
    throw new TemplateRenderError(`Unknown master template "${templateKey}".`, { templateKey });
  }
  if (!supabase) {
    throw new TemplateRenderError("No database client was supplied to read the master template.", {
      templateKey,
    });
  }

  const { data, error } = await supabase.storage.from(TEMPLATE_BUCKET).download(path);
  if (error || !data) {
    throw new TemplateRenderError("Document template is not available.", {
      templateKey,
      file,
      cause: error?.message || "The master template could not be read from storage.",
    });
  }

  const bytes = new Uint8Array(await data.arrayBuffer());

  // A .docx is a ZIP, so it must start with the local-file-header signature.
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new TemplateRenderError("Document template is not available.", {
      templateKey,
      file,
      cause: "The stored master is not a readable Word document.",
    });
  }

  return { bytes, path, file };
}

function renderFieldText(field, data) {
  const raw = typeof field.value === "function" ? field.value(data) : field.value;
  const missing = [];

  const rendered = String(raw ?? "").replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = data?.[key];
    if (isBlank(value)) {
      missing.push(key);
      return "";
    }
    return String(value).trim();
  });

  if (missing.length && !field.optional) {
    throw new TemplateRenderError(
      `A required value is missing for "${field.id}": ${missing.join(", ")}.`,
      { field: field.id, missing }
    );
  }
  return rendered;
}

/**
 * Finds the one text node a field map entry addresses, or refuses the render.
 *
 * The paragraph and text indexes are counted against the master exactly as
 * Word stores them, so a master that has drifted cannot silently produce a
 * mislabelled official document.
 */
function locateFieldNode(xml, field) {
  const paragraphs = [...xml.matchAll(PARAGRAPH_RE)];
  const { id, para, t, expect } = field;

  if (para < 1 || para > paragraphs.length) {
    throw new TemplateRenderError(
      `The master template layout changed: "${id}" expects paragraph ${para} but the document has ${paragraphs.length}.`,
      { field: id, para, found: paragraphs.length }
    );
  }

  const paragraph = paragraphs[para - 1];
  const nodes = [...paragraph[0].matchAll(TEXT_NODE_RE)];

  if (t < 1 || t > nodes.length) {
    throw new TemplateRenderError(
      `The master template layout changed: "${id}" expects text ${t} in paragraph ${para} but the paragraph has ${nodes.length}.`,
      { field: id, para, t, found: nodes.length }
    );
  }

  const node = nodes[t - 1];
  const actual = unescapeXml(node[1]);

  // `expect` is either the exact text the node must hold, or a predicate for the
  // nodes that are too long to keep in source - the Reklamo's narrative field is
  // a literal rule of several hundred underscore characters.
  const matches =
    typeof expect === "function" ? Boolean(expect(actual)) : actual === expect;

  if (!matches) {
    throw new TemplateRenderError(
      `The master template layout changed: "${id}" expected ${JSON.stringify(
        typeof expect === "function" ? expect.name || "a matching field" : expect
      )} in paragraph ${para} but found ${JSON.stringify(actual)}.`,
      { field: id, para, t, expect: String(expect), actual }
    );
  }

  return {
    start: paragraph.index + node.index,
    end: paragraph.index + node.index + node[0].length,
    node,
  };
}

function applyField(xml, field, data) {
  const { start, node, end } = locateFieldNode(xml, field);
  const replacement = `<w:t xml:space="preserve">${escapeXml(renderFieldText(field, data))}</w:t>`;
  return xml.slice(0, start) + replacement + xml.slice(end);
}

/**
 * Addresses one text node in a master and rewrites its whole content.
 *
 * This is `applyField` without the `{{...}}` substitution step, so a master
 * that still carries a blank writing rule beside a token placeholder can have
 * that rule emptied without touching anything else in the paragraph.
 *
 * @param {string} xml  word/document.xml
 * @param {{ id: string, para: number, t: number, expect: string|Function }} field
 * @param {string} value  the text the node should hold afterwards
 */
export function replaceRunText(xml, field, value) {
  const { start, end } = locateFieldNode(xml, field);
  return xml.slice(0, start) + textRunXml(value) + xml.slice(end);
}

/** Empties one addressed text node, keeping the run and its formatting. */
export function clearRunContent(xml, field) {
  return replaceRunText(xml, field, "");
}

/**
 * Rebuilds a value as the Word content that prints it.
 *
 * A newline inside a complaint narrative has to become a real `<w:br/>`: a
 * literal line feed inside one `<w:t>` is collapsed by Word, which would lose
 * the paragraph breaks the resident actually wrote.
 */
function textRunXml(value) {
  return String(value ?? "")
    .split(/\r\n|\r|\n/)
    .map((part) => `<w:t xml:space="preserve">${escapeXml(part)}</w:t>`)
    .join("<w:br/>");
}

/**
 * Renders a generated document from a master template.
 *
 * @param {Uint8Array} masterBytes  the untouched master, as read from the bucket
 * @param {Array} fields             field map, see `renderFieldText`
 * @param {object} data              values the field templates resolve against
 * @returns {Blob}                   the generated .docx
 */
export function renderDocx(masterBytes, fields, data) {
  const zip = new PizZip(masterBytes);
  const part = "word/document.xml";
  const file = zip.file(part);
  if (!file) {
    throw new TemplateRenderError("Document template is not available.", {
      cause: "The master has no word/document.xml part, so it is not a Word document.",
    });
  }

  let xml = file.asText();
  for (const field of fields) {
    xml = applyField(xml, field, data);
  }

  if (xml.includes("{{")) {
    throw new TemplateRenderError("Document template is not available.", {
      cause: "An unresolved field placeholder remained after rendering.",
    });
  }

  zip.file(part, xml);
  return new Blob([zip.generate({ type: "uint8array" })], { type: DOCX_MIME });
}

/**
 * Resolves every `{{token}}` inside one paragraph, however Word split them.
 *
 * Word stores a placeholder as several runs whenever a spell-check marker,
 * a style change or an edit lands inside it, so `{{complainant_name}}` can
 * arrive as `{{` + `complainant_name` + `}}` in three separate `<w:t>` nodes.
 * The paragraph's text nodes are therefore read as one logical string, each
 * token's character range is mapped back to the runs it spans, the resolved
 * value is written into the first of those runs and only the consumed
 * fragments are removed from the rest. Text before and after a token, and
 * every run the token never touched, keeps its own formatting.
 *
 * @returns {{ xml: string, hits: string[] }}
 */
function renderTokensInParagraph(paragraphXml, data, missing) {
  const nodes = [...paragraphXml.matchAll(TEXT_NODE_RE)];
  if (!nodes.length) return { xml: paragraphXml, hits: [], residual: "" };

  const texts = nodes.map((node) => unescapeXml(node[1]));
  const owner = [];
  const offset = [];
  let logical = "";
  texts.forEach((text, index) => {
    for (let i = 0; i < text.length; i += 1) {
      logical += text[i];
      owner.push(index);
      offset.push(i);
    }
  });

  const edits = nodes.map(() => []);
  const hits = [];

  TOKEN_RE.lastIndex = 0;
  let match = TOKEN_RE.exec(logical);
  while (match) {
    const key = match[1];
    const first = match.index;
    const last = match.index + match[0].length - 1;
    const firstNode = owner[first];
    const lastNode = owner[last];

    const raw = data?.[key];
    if (isBlank(raw)) missing.push(key);
    const value = isBlank(raw) ? "" : String(raw).trim();

    if (firstNode === lastNode) {
      edits[firstNode].push({ from: offset[first], to: offset[last] + 1, value });
    } else {
      edits[firstNode].push({ from: offset[first], to: texts[firstNode].length, value });
      for (let i = firstNode + 1; i < lastNode; i += 1) {
        edits[i].push({ from: 0, to: texts[i].length, value: "" });
      }
      edits[lastNode].push({ from: 0, to: offset[last] + 1, value: "" });
    }

    hits.push(key);
    match = TOKEN_RE.exec(logical);
  }

  if (!hits.length) return { xml: paragraphXml, hits: [], residual: logical };

  let out = "";
  let residual = "";
  let cursor = 0;
  nodes.forEach((node, index) => {
    const start = node.index;
    const full = node[0];
    const ops = edits[index].sort((a, b) => b.from - a.from);

    out += paragraphXml.slice(cursor, start);
    if (!ops.length) {
      out += full;
      residual += texts[index];
    } else {
      let text = texts[index];
      // The master text with the consumed placeholder fragments taken out: what
      // is left is the paragraph's own words, which must never still hold a "{".
      let leftover = texts[index];
      for (const op of ops) {
        text = text.slice(0, op.from) + op.value + text.slice(op.to);
        leftover = leftover.slice(0, op.from) + leftover.slice(op.to);
      }
      out += textRunXml(text);
      residual += leftover;
    }
    cursor = start + full.length;
  });
  out += paragraphXml.slice(cursor);

  return { xml: out, hits, residual };
}

/**
 * Renders a generated document whose master carries `{{token}}` placeholders.
 *
 * Use this for masters whose blanks are named tokens rather than underscore
 * rules. Tokens are resolved generically - no placeholder is named here - so a
 * master can gain, rename or repeat a placeholder without a code change.
 *
 * @param {Uint8Array} masterBytes  the untouched master, as read from the bucket
 * @param {object} data              values keyed by placeholder name
 * @param {object} [options]
 * @param {string[]} [options.requiredKeys] placeholders that must have a value
 * @param {Array}    [options.clears]       field-map entries whose run is emptied
 * @returns {Blob}                          the generated .docx
 */
export function renderDocxTokens(masterBytes, data, { requiredKeys = [], clears = [] } = {}) {
  const zip = new PizZip(masterBytes);
  const part = "word/document.xml";
  const file = zip.file(part);
  if (!file) {
    throw new TemplateRenderError("Document template is not available.", {
      cause: "The master has no word/document.xml part, so it is not a Word document.",
    });
  }

  let xml = file.asText();
  for (const field of clears) {
    xml = replaceRunText(xml, field, typeof field.value === "string" ? field.value : "");
  }

  // One pass, and only one: the tokens live in the master, and replacing one
  // can only ever consume characters, never introduce a further token. Scanning
  // again would re-read the values just written - a resident who types "{{"
  // into their own narrative would have it swallowed as if it were a field.
  const missing = [];
  const paragraphs = [...xml.matchAll(PARAGRAPH_RE)];
  let out = "";
  let cursor = 0;
  let residual = "";

  for (const paragraph of paragraphs) {
    const start = paragraph.index;
    const body = paragraph[0];
    out += xml.slice(cursor, start);
    const result = renderTokensInParagraph(body, data, missing);
    out += result.xml;
    residual += result.residual;
    cursor = start + body.length;
  }
  out += xml.slice(cursor);
  xml = out;

  // Only the master's own wording is inspected, so a "{{" the resident typed
  // into their narrative prints as written while a placeholder the renderer
  // could not recognise is refused rather than printed on an official form.
  if (residual.includes("{{")) {
    const leftover = residual.slice(residual.indexOf("{{"), residual.indexOf("{{") + 40);
    throw new TemplateRenderError("Document template is not available.", {
      cause: `An unresolved field placeholder remained after rendering: ${JSON.stringify(leftover)}.`,
    });
  }

  const absent = requiredKeys.filter((key) => isBlank(data?.[key]));
  if (absent.length) {
    throw new TemplateRenderError(
      `A required value is missing: ${absent.join(", ")}.`,
      { missing: absent }
    );
  }

  zip.file(part, xml);
  return new Blob([zip.generate({ type: "uint8array" })], { type: DOCX_MIME });
}

/** Strips anything a storage key or a download name must not carry. */
function sanitizeSegment(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The canonical case number every document for a case reuses, e.g.
 * "AB-2026-0001". Never generated here: it is read from the complaint row.
 */
export function canonicalCaseNumber(complaint) {
  const value = complaint?.barangay_case_number || complaint?.reference_number;
  return isBlank(value) ? null : String(value).trim();
}

/**
 * A case-specific document name, e.g. "AB-2026-0001_Notice-of-Hearing.docx".
 * Falls back to the complaint id when the case number has not been issued yet,
 * so a filename is never empty and never a random name.
 */
export function caseDocumentFileName(complaint, label) {
  const caseNumber = canonicalCaseNumber(complaint);
  const stem = caseNumber
    ? sanitizeSegment(caseNumber)
    : `case-${sanitizeSegment(complaint?.id).slice(0, 8)}`;
  return `${stem}_${sanitizeSegment(label)}.docx`;
}

/**
 * Where a generated document is stored. The complaint id scopes the path so a
 * file can never be reached by guessing a case number alone.
 */
export function caseDocumentStoragePath(complaint, label) {
  return `complaints/${complaint.id}/${caseDocumentFileName(complaint, label)}`;
}

/**
 * The next version number for one document type of one case.
 *
 * Version numbers belong in the storage key as well as in the row: a captain
 * who prints a notice twice must get two files, so regenerating a document
 * after a reschedule adds a version instead of overwriting the notice that was
 * already handed to a party.
 *
 * @param {Array} documents  the case's documents
 * @param {string} documentType
 * @returns {number}
 */
export function nextDocumentVersion(documents, documentType) {
  const versions = (documents || [])
    .filter((doc) => doc.document_type === documentType)
    .map((doc) => Number(doc.version) || 1);
  return versions.length ? Math.max(...versions) + 1 : 1;
}