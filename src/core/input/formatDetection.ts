import type { InputFormat } from '../types';

/**
 * Format detection uses magic bytes first and the file extension second,
 * so a renamed file is still identified by its real content.
 */

const EXT_MAP: Record<string, InputFormat> = {
  txt: 'txt',
  text: 'txt',
  md: 'markdown',
  markdown: 'markdown',
  pdf: 'pdf',
  docx: 'docx',
  doc: 'doc',
  rtf: 'rtf',
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  webp: 'webp',
  heic: 'heic',
  heif: 'heic',
  csv: 'csv',
  xlsx: 'xlsx',
  json: 'json',
  ics: 'ics',
};

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, start: number, len: number): string {
  return String.fromCharCode(...bytes.slice(start, start + len));
}

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
}

export function detectFormat(filename: string, bytes: Uint8Array): InputFormat {
  const ext = extensionOf(filename);
  const byExt = EXT_MAP[ext];

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf'; // %PDF
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (ascii(bytes, 4, 4) === 'ftyp' && /hei[cfx]|mif1/.test(ascii(bytes, 8, 4))) return 'heic';
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return 'doc'; // OLE2
  if (ascii(bytes, 0, 5) === '{\\rtf') return 'rtf';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // ZIP container: trust a docx/xlsx extension, otherwise unknown.
    return byExt === 'docx' || byExt === 'xlsx' ? byExt : 'unknown';
  }

  // Text based formats: must decode as UTF-8 without binary noise.
  if (looksLikeText(bytes)) {
    if (byExt && ['txt', 'markdown', 'csv', 'json', 'ics'].includes(byExt)) return byExt;
    const head = new TextDecoder().decode(bytes.slice(0, 64)).trimStart();
    if (head.startsWith('BEGIN:VCALENDAR')) return 'ics';
    return byExt === undefined || byExt === 'txt' ? 'txt' : 'unknown';
  }
  // A text extension with undecodable bytes: let the extractor report it
  // as a corrupt file rather than an unknown format.
  if (byExt && ['txt', 'markdown', 'csv', 'json', 'ics'].includes(byExt)) return byExt;
  return 'unknown';
}

export function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, 4096);
  if (sample.length === 0) return true;
  let suspicious = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 0x09 || (b > 0x0d && b < 0x20)) suspicious++;
  }
  if (suspicious / sample.length > 0.05) return false;
  try {
    // stream:true tolerates a multibyte character cut at the sample edge.
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true });
    return true;
  } catch {
    return false;
  }
}
