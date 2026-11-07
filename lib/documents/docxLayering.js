/**
 * Layering for Word documents rendered on screen.
 *
 * WHY THIS EXISTS
 *   Word keeps a per-picture "behind document text" flag — the OOXML attribute
 *   `behindDoc` — that decides whether an anchored picture paints over the
 *   body text or behind it. Barangay letterheads depend on it. The Notice of
 *   Hearing carries five pictures: three small ones (the seal, the logo) in
 *   front of the text, and two large ones behind it — the decorative ribbon
 *   across the top and the ASENSO ABUNO watermark.
 *
 *   docx-preview reads that attribute and throws it away. Its parseDrawing
 *   Wrapper contains a bare `globalXmlParser.boolAttr(node, "behindDoc")`
 *   with no assignment, so both kinds of picture render with identical CSS
 *   and paint in plain document order. The result is not a subtle difference:
 *   elementFromPoint over the middle of "BARANGAY ABUNO" returns the ribbon
 *   <img>, and the body paragraphs sit underneath the watermark. A notice
 *   opened in the viewer reads as a scrambled form even though the stored
 *   file is byte-for-byte the template with its blanks filled.
 *
 * WHAT THIS DOES
 *   Recovers the flag from the document itself and re-applies it as a
 *   negative z-index, so the two decorations paint behind the text again the
 *   way Word paints them.
 *
 *   A .docx is a ZIP, and `word/document.xml` lists its pictures in document
 *   order — which is also the order docx-preview emits them — so a list of
 *   booleans is enough to line the two up. Only that one entry is read, and
 *   only with the browser's own DecompressionStream: no new dependency, and
 *   nothing beyond the bytes the viewer has already fetched.
 *
 * WHEN IT DECLINES TO ACT
 *   The correspondence is only safe when the two sides agree on a count. A
 *   drawing is counted when it references an image (`r:embed`), because a
 *   picture that carries none produces no <img> and cannot shift the pairing;
 *   and `mc:AlternateContent` blocks are a known source of disagreement,
 *   since docx-preview drops them where Word renders one branch. If the
 *   counts differ, nothing is applied and the document previews exactly as it
 *   did before — being wrong about which picture goes behind the text would
 *   be worse than leaving it in front.
 */

/** The main document body. Headers and footers are separate ZIP entries. */
const DOCUMENT_PART = "word/document.xml";

/**
 * What docx-preview emits for every drawing: renderDrawing always sets a text
 * indent on the wrapper div it creates, and nothing else in the renderer puts
 * one on a <div>. Paragraph indents land on <p>, table markup on <table>.
 */
const DRAWING_WRAPPER_SELECTOR = 'div[style*="text-indent"]';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

/** ZIP stores entries deflated with raw DEFLATE; the browser can inflate it. */
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(
    new DecompressionStream("deflate-raw")
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read one named entry out of a .docx without unpacking the archive.
 *
 * @param {ArrayBuffer} arrayBuffer the whole .docx
 * @param {string} entryName e.g. "word/document.xml"
 * @returns {Promise<Uint8Array|null>} the uncompressed entry, or null
 */
async function readZipEntry(arrayBuffer, entryName) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  // The End Of Central Directory record sits at the end, possibly followed by
  // up to 64KB of archive comment, so search backwards for its signature.
  let eocdOffset = -1;
  const lastOffset = bytes.length - 22;
  const firstOffset = Math.max(0, lastOffset - 0xffff);
  for (let i = lastOffset; i >= firstOffset; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return null;

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder();

  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) return null;

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    if (name === entryName) {
      if (view.getUint32(localOffset, true) !== LOCAL_HEADER_SIGNATURE) return null;
      // The local header repeats the name and extra field; the compressed
      // payload only starts after both.
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const raw = bytes.subarray(start, start + compressedSize);
      if (method === 0) return raw.slice();
      if (method === 8) return inflateRaw(raw);
      return null;
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return null;
}

/**
 * Which pictures in the body belong behind the text, in document order.
 *
 * @param {ArrayBuffer} arrayBuffer the .docx already fetched for previewing
 * @returns {Promise<boolean[]>} one entry per picture; empty when the answer
 *   could not be determined, which leaves the preview as it was.
 */
export async function readBehindTextDrawings(arrayBuffer) {
  if (!arrayBuffer) return [];
  try {
    const part = await readZipEntry(arrayBuffer, DOCUMENT_PART);
    if (!part) return [];

    const xml = new TextDecoder().decode(part);
    const behind = [];

    const drawings = /<(wp:inline|wp:anchor)\b([^>]*)>/g;
    let match;
    while ((match = drawings.exec(xml))) {
      const tagName = match[1];
      const closing = `</${tagName}>`;
      const end = xml.indexOf(closing, drawings.lastIndex);
      const element = xml.slice(match.index, end < 0 ? match.index + 4096 : end + closing.length);

      // A picture with no image reference draws nothing, so it produces no
      // wrapper in the preview and must not occupy a slot in this list.
      if (!/r:embed=/.test(element)) continue;

      behind.push(/behindDoc="1"/.test(match[2]));
    }

    return behind;
  } catch {
    // Anything unexpected — a malformed archive, a browser without
    // DecompressionStream — leaves the document previewing as it did.
    return [];
  }
}

/**
 * Push the flagged pictures behind the rendered text.
 *
 * The negative z-index only means "behind the page's own content" while the
 * page itself is a stacking context; app/globals.css makes `section.docx` one
 * so the picture stays above the white sheet and below the type, rather than
 * disappearing behind both.
 *
 * @param {ParentNode} root the element docx-preview rendered into
 * @param {boolean[]} mask from readBehindTextDrawings
 * @returns {number} how many pictures were moved, so a caller can tell the
 *   pairing held
 */
export function applyBehindTextLayering(root, mask) {
  if (!root || !Array.isArray(mask) || mask.length === 0) return 0;

  // Scoped to <article> because that is docx-preview's body element; <header>
  // and <footer> siblings come from other ZIP entries that were not scanned.
  const wrappers = Array.from(root.querySelectorAll(`article ${DRAWING_WRAPPER_SELECTOR}`))
    .filter((node) => node.querySelector("img"));

  // The pairing is positional, so a disagreement about how many pictures
  // exist means the list cannot be trusted. Standing down is the honest
  // answer; guessing at which ribbon is the watermark is not.
  if (wrappers.length !== mask.length) return 0;

  let applied = 0;
  wrappers.forEach((wrapper, index) => {
    if (!mask[index]) return;
    wrapper.style.zIndex = "-1";
    applied += 1;
  });

  return applied;
}
