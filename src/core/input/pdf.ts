import { CorruptFileError, NeedsOcrError, type ExtractedText } from './errors';

/**
 * PDF text extraction with PDF.js (bundled, no network). Text items are
 * regrouped into lines by their vertical position so that a title and a
 * date drawn as separate runs end up on one line again. Each page's start
 * offset is kept so provenance can point at a page.
 */

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;
let workerSrc: string | null = null;

/** Browser builds call this with the bundled worker URL. */
export function configurePdfWorker(url: string): void {
  workerSrc = url;
}

async function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
    if (workerSrc) m.GlobalWorkerOptions.workerSrc = workerSrc;
    return m;
  });
  return pdfjsPromise;
}

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function itemsToLines(items: Item[]): string[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Item[][] = [];
  for (const it of sorted) {
    const tol = Math.max(2, it.h * 0.4);
    const line = lines.find((l) => Math.abs(l[0].y - it.y) <= tol);
    if (line) line.push(it);
    else lines.push([it]);
  }
  return lines
    .sort((a, b) => b[0].y - a[0].y)
    .map((l) => {
      l.sort((a, b) => a.x - b.x);
      let out = '';
      let end = -Infinity;
      for (const it of l) {
        const gap = it.x - end;
        if (out && gap > Math.max(1, it.h * 0.15) && !out.endsWith(' ') && !it.str.startsWith(' ')) out += gap > it.h * 3 ? '   ' : ' ';
        out += it.str;
        end = it.x + it.w;
      }
      return out.replace(/\s+$/, '');
    })
    .filter((s) => s.trim().length > 0);
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractedText> {
  const pdfjs = await loadPdfJs();
  let doc;
  try {
    // PDF.js takes ownership of the buffer, so give it a copy.
    doc = await pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  } catch (e) {
    throw new CorruptFileError(`The PDF could not be opened (${(e as Error).message}).`);
  }
  const pages: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const raw of content.items) {
        if (!('str' in raw) || !raw.str) continue;
        items.push({ str: raw.str, x: raw.transform[4], y: raw.transform[5], w: raw.width, h: Math.abs(raw.transform[3]) || raw.height || 10 });
      }
      pages.push(itemsToLines(items).join('\n'));
    }
  } finally {
    await doc.destroy();
  }

  const letters = pages.join('').replace(/\s/g, '').length;
  if (letters < 20) throw new NeedsOcrError();

  const pageOffsets: number[] = [];
  let text = '';
  pages.forEach((p, i) => {
    if (i > 0) text += '\n\n';
    pageOffsets.push(text.length);
    text += p;
  });
  return { text, method: 'document_parser', pageOffsets };
}
