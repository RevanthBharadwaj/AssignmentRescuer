import type { ExtractionMethod, InputFormat } from '../types';

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

/** A PDF made of page images (a scan) with no text to read. */
export class NeedsOcrError extends Error {
  constructor() {
    super('This PDF is a scan with no text layer. Reading scanned pages (OCR) is not available yet; paste the text or use the original document instead.');
    this.name = 'NeedsOcrError';
  }
}

export interface ExtractedText {
  text: string;
  method: ExtractionMethod;
  /** Page start offsets in `text`, when the format has pages. */
  pageOffsets: number[] | null;
}
