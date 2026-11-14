import { unzipSync, strFromU8 } from 'fflate';
import { CorruptFileError, type ExtractedText } from './errors';

/**
 * Word (.docx) text extraction. A .docx is a zip of XML; the body is read
 * in order, paragraphs become lines and table rows become "a | b | c"
 * lines, so rubric tables keep their structure.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

function paragraphText(xml: string): string {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1] !== undefined) out += decode(m[1]);
    else if (m[0].startsWith('<w:tab')) out += '\t';
    else out += '\n';
  }
  return out;
}

export function extractDocx(bytes: Uint8Array): ExtractedText {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' });
  } catch {
    throw new CorruptFileError('The Word file could not be opened.');
  }
  const doc = files['word/document.xml'];
  if (!doc) throw new CorruptFileError('This does not look like a Word document (no document body found).');
  const xml = strFromU8(doc);
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? '';

  const lines: string[] = [];
  const block = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = block.exec(body)) !== null) {
    const part = m[0];
    if (part.startsWith('<w:tbl')) {
      for (const row of part.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) ?? []) {
        const cells = (row.match(/<w:tc[\s>][\s\S]*?<\/w:tc>/g) ?? []).map((c) =>
          (c.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []).map(paragraphText).join(' ').trim(),
        );
        if (cells.some(Boolean)) lines.push(cells.join(' | '));
      }
    } else {
      lines.push(paragraphText(part));
    }
  }
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, method: 'document_parser', pageOffsets: null };
}
