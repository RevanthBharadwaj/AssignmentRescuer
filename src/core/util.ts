/** FNV-1a 32 bit, hex. Used for stable ids, not for security. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newId(prefix: string): string {
  const rand = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return `${prefix}_${rand}`;
}

/** Normalise free text into a comparison key. */
export function normaliseKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”"'’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normaliseCourseCode(code: string): string {
  const m = /^([A-Za-z]{2,4})\s*-?\s*(\d{3,4}[A-Za-z]?)$/.exec(code.trim());
  return m ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}` : code.trim().toUpperCase();
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export function parseCount(s: string): number | null {
  const t = s.toLowerCase().replace(/,/g, '');
  if (/^\d+$/.test(t)) return Number(t);
  return WORD_NUMBERS[t] ?? null;
}
