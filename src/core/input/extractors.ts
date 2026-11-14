import type { InputFormat } from '../types';
import { isFormatImplemented } from '../features';
import { CorruptFileError, UnsupportedFormatError, type ExtractedText } from './errors';
import { extractPdf } from './pdf';
import { extractDocx } from './docx';

export { CorruptFileError, NeedsOcrError, UnsupportedFormatError, type ExtractedText } from './errors';

/**
 * Text extraction registry. Formats whose extractor has not been built and
 * tested throw `UnsupportedFormatError` instead of pretending to work.
 */

type Extractor = (bytes: Uint8Array) => ExtractedText | Promise<ExtractedText>;

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CorruptFileError('The file is not valid UTF-8 text.');
  }
}

const plainText: Extractor = (bytes) => ({
  text: decodeUtf8(bytes).replace(/^\uFEFF/, ''),
  method: 'deterministic_text',
  pageOffsets: null,
});

const markdown: Extractor = (bytes) => {
  // Keep text content, drop markup that adds no academic meaning.
  const text = decodeUtf8(bytes)
    .replace(/^\uFEFF/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/`{1,3}/g, '');
  return { text, method: 'deterministic_text', pageOffsets: null };
};

const EXTRACTORS: Partial<Record<InputFormat, Extractor>> = {
  plain_text: plainText,
  txt: plainText,
  markdown,
  ics: plainText,
  pdf: extractPdf,
  docx: extractDocx,
};

export async function extractText(format: InputFormat, bytes: Uint8Array): Promise<ExtractedText> {
  const fn = EXTRACTORS[format];
  if (!fn || !isFormatImplemented(format)) throw new UnsupportedFormatError(format);
  return fn(bytes);
}

/** Page number (1 based) for a character offset, or null for formats without pages. */
export function pageAt(pageOffsets: number[] | null | undefined, offset: number): number | null {
  if (!pageOffsets || pageOffsets.length === 0) return null;
  let page = 1;
  for (let i = 0; i < pageOffsets.length; i++) if (offset >= pageOffsets[i]) page = i + 1;
  return page;
}
