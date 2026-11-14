/**
 * Finds the passages of the student's saved material that matter for a
 * question. Keywords pick candidates; when an embedding model is set up, the
 * candidates are re ranked by meaning. Without one, keywords alone are used.
 */

export interface Chunk { text: string; source: string }
export type Embedder = (texts: string[]) => Promise<number[][]>;

const STOP = new Set('a an and are as at be by for from how i in is it my of on or that the this to was what when which who will with you your about do does need have has'.split(' '));
const words = (s: string) => (s.toLowerCase().match(/[a-z0-9][a-z0-9'-]+/g) ?? []).filter((w) => !STOP.has(w));

export function chunkText(text: string, source: string, size = 900): Chunk[] {
  const out: Chunk[] = [];
  let cur = '';
  for (const para of text.split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (cur && cur.length + p.length > size) { out.push({ text: cur.trim(), source }); cur = ''; }
    if (p.length > size * 1.5) {
      for (let i = 0; i < p.length; i += size) out.push({ text: p.slice(i, i + size), source });
    } else cur += `${p}\n\n`;
  }
  if (cur.trim()) out.push({ text: cur.trim(), source });
  return out;
}

export function keywordRank(query: string, chunks: Chunk[]): { chunk: Chunk; score: number }[] {
  const q = words(query);
  if (!q.length) return chunks.map((chunk) => ({ chunk, score: 0 }));
  const df = new Map<string, number>();
  const bags = chunks.map((c) => new Set(words(c.text)));
  for (const w of new Set(q)) df.set(w, bags.filter((b) => b.has(w)).length);
  return chunks.map((chunk) => {
    const tokens = words(chunk.text);
    let score = 0;
    for (const w of new Set(q)) {
      const tf = tokens.filter((t) => t === w).length;
      if (tf) score += (1 + Math.log(tf)) * Math.log(1 + chunks.length / (1 + (df.get(w) ?? 0)));
    }
    return { chunk, score: score / Math.sqrt(1 + tokens.length / 120) };
  }).sort((a, b) => b.score - a.score);
}

const cosine = (a: number[], b: number[]) => {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? d / Math.sqrt(x * y) : 0;
};

const cache = new Map<string, number[]>();

export async function retrieve(query: string, chunks: Chunk[], k = 5, embed?: Embedder, tag = ''): Promise<{ chunk: Chunk; how: 'meaning' | 'keywords' }[]> {
  const ranked = keywordRank(query, chunks);
  const candidates = ranked.slice(0, embed ? 40 : k);
  if (embed && candidates.length > 0) {
    try {
      const need = candidates.filter((c) => !cache.has(`${tag}:${c.chunk.text}`));
      if (need.length) {
        const vecs = await embed(need.map((c) => c.chunk.text));
        need.forEach((c, i) => cache.set(`${tag}:${c.chunk.text}`, vecs[i]));
      }
      const [qv] = await embed([query]);
      return candidates
        .map((c) => ({ chunk: c.chunk, s: cosine(qv, cache.get(`${tag}:${c.chunk.text}`) ?? []) }))
        .sort((a, b) => b.s - a.s).slice(0, k).map((c) => ({ chunk: c.chunk, how: 'meaning' as const }));
    } catch { /* fall back to keywords */ }
  }
  return candidates.slice(0, k).filter((c) => c.score > 0).map((c) => ({ chunk: c.chunk, how: 'keywords' as const }));
}
