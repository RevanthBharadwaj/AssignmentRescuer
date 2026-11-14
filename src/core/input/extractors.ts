import type { ExtractionMethod, InputFormat } from '../types';
import { isFormatImplemented } from '../features';

/**
 * Text extraction registry. Each format maps to an extractor. Formats whose
 * extractor has not been built and tested throw `UnsupportedFormatError`
 * instead of pretending to work.
 */

export class UnsupportedFormatError extends Error {
  constructor(public readonly format: InputFormat, message?: string) {
    super(message ?? `Import of ${format} files is not available yet.`);
    this.name = 'UnsupportedFormatError';
  }
}

export class CorruptFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptFileError';
  }
}

export interface ExtractedText {
  text: string;
  method: ExtractionMethod;
  /** Page boundaries as char offsets, when the format has pages. */
  pageOffsets: number[] | null;
}

type Extractor = (bytes: Uint8Array) => ExtractedText;

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
};

export function extractText(format: InputFormat, bytes: Uint8Array): ExtractedText {
  const fn = EXTRACTORS[format];
  if (!fn || !isFormatImplemented(format)) throw new UnsupportedFormatError(format);
  return fn(bytes);
}
