import { zipSync, strToU8 } from 'fflate';

/**
 * Writes a Word (.docx) file from the plain markdown the assistant produces
 * (# headings, - bullets, **bold**, *italic*). Layout follows APA 7 student
 * papers: Times New Roman 12, double spaced, 1 inch margins, page number top
 * right, first line indents, centered level 1 headings, hanging indent
 * references, and an optional title page.
 */

export interface TitleLine { text: string; bold?: boolean }
export interface DocOptions {
  /** Title page lines (title, name, school, course, teacher, date). Leave out for no title page. */
  titlePage?: TitleLine[];
  /** false gives single spaced notes style instead of APA body. */
  apa?: boolean;
}

type Run = { text: string; bold?: boolean; italic?: boolean };
type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; runs: Run[]; text: string }
  | { kind: 'para'; runs: Run[] }
  | { kind: 'bullet'; runs: Run[] }
  | { kind: 'number'; n: string; runs: Run[] };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function inlineRuns(text: string): Run[] {
  const t = text.replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)');
  const runs: Run[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    if (m.index > last) runs.push({ text: t.slice(last, m.index) });
    if (m[1] !== undefined) runs.push({ text: m[1], bold: true });
    else runs.push({ text: m[2] ?? m[3], italic: true });
    last = m.index + m[0].length;
  }
  if (last < t.length) runs.push({ text: t.slice(last) });
  return runs.filter((r) => r.text);
}

export function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) blocks.push({ kind: 'para', runs: inlineRuns(buf.join(' ').trim()) });
    buf = [];
  };
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.*\S)\s*#*$/.exec(line);
    const b = /^\s*[-*•]\s+(.*\S)/.exec(line);
    const n = /^\s*(\d+[.)])\s+(.*\S)/.exec(line);
    if (!line.trim()) flush();
    else if (/^[-_*]{3,}$/.test(line.trim())) flush();
    else if (h) {
      flush();
      const plain = h[2].replace(/\*+/g, '').trim();
      blocks.push({ kind: 'heading', level: Math.min(h[1].length, 3) as 1 | 2 | 3, runs: inlineRuns(plain), text: plain });
    } else if (b) { flush(); blocks.push({ kind: 'bullet', runs: inlineRuns(b[1]) }); }
    else if (n) { flush(); blocks.push({ kind: 'number', n: n[1], runs: inlineRuns(n[2]) }); }
    else buf.push(line.trim());
  }
  flush();
  return blocks;
}

const runXml = (r: Run, base = '') =>
  `<w:r><w:rPr>${base}${r.bold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
const para = (runs: Run[], ppr: string, base = '') => `<w:p><w:pPr>${ppr}</w:pPr>${runs.map((r) => runXml(r, base)).join('')}</w:p>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

export function documentXml(md: string, opt: DocOptions = {}): string {
  const body: string[] = [];
  if (opt.titlePage?.length) {
    for (let i = 0; i < 4; i++) body.push(para([], '<w:pStyle w:val="Center"/>'));
    opt.titlePage.forEach((l) => body.push(para([{ text: l.text, bold: l.bold }], '<w:pStyle w:val="Center"/>')));
    body.push(pageBreak);
  }
  let inRefs = false;
  let first = true;
  for (const b of parseBlocks(md)) {
    if (b.kind === 'heading') {
      inRefs = /^references?$/i.test(b.text);
      if (inRefs && !first) body.push(pageBreak);
      const style = b.level === 1 ? 'Heading1' : b.level === 2 ? 'Heading2' : 'Heading3';
      body.push(para(b.runs.map((r) => ({ ...r })), `<w:pStyle w:val="${style}"/>`));
    } else if (b.kind === 'bullet') body.push(para([{ text: '•\t' }, ...b.runs], '<w:pStyle w:val="Item"/>'));
    else if (b.kind === 'number') body.push(para([{ text: `${b.n}\t` }, ...b.runs], '<w:pStyle w:val="Item"/>'));
    else body.push(para(b.runs, inRefs ? '<w:pStyle w:val="Reference"/>' : '<w:pStyle w:val="Body"/>'));
    first = false;
  }
  const sect = '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}${sect}</w:body></w:document>`;
}

const FONT = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/>';
const style = (id: string, name: string, ppr: string, rpr = '', extra = '') =>
  `<w:style w:type="paragraph" w:styleId="${id}"${id === 'Body' ? ' w:default="1"' : ''}><w:name w:val="${name}"/>${extra}<w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;

const stylesXml = (apa: boolean) => {
  const line = apa ? '<w:spacing w:line="480" w:lineRule="auto" w:before="0" w:after="0"/>' : '<w:spacing w:line="276" w:lineRule="auto" w:before="0" w:after="160"/>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>${FONT}<w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults>`
    + style('Body', 'Body', `${line}${apa ? '<w:ind w:firstLine="720"/>' : ''}`)
    + style('Center', 'Center', `<w:spacing w:line="480" w:lineRule="auto"/><w:jc w:val="center"/>`)
    + style('Heading1', 'heading 1', `<w:keepNext/>${line}<w:jc w:val="center"/>`, '<w:b/>')
    + style('Heading2', 'heading 2', `<w:keepNext/>${line}`, '<w:b/>')
    + style('Heading3', 'heading 3', `<w:keepNext/>${line}`, '<w:b/><w:i/>')
    + style('Item', 'Item', `${line}<w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/>`)
    + style('Reference', 'Reference', `${line}<w:ind w:left="720" w:hanging="720"/>`)
    + '</w:styles>';
};

const headerXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>';

export function buildDocx(md: string, opt: DocOptions = {}): Uint8Array {
  const apa = opt.apa !== false;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>'),
    'word/document.xml': strToU8(documentXml(md, opt)),
    'word/styles.xml': strToU8(stylesXml(apa)),
    'word/header1.xml': strToU8(headerXml),
  });
}

export const docFileName = (title: string) => `${(title || 'Assignment draft').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}.docx`;
