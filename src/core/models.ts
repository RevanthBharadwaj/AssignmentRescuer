/**
 * Models the app can offer. Local models are free open weights from Hugging
 * Face, run through Ollama on the student's own computer. Sizes and memory
 * are approximate; licences differ, so check each model card before sharing
 * the weights with anyone.
 */
export interface LocalModel {
  /** Name Ollama uses: `ollama pull <tag>`. */
  tag: string;
  name: string;
  hf: string;
  size: string;
  memory: string;
  licence: string;
  stars: 1 | 2 | 3 | 4 | 5;
  best: string;
  /** Plain description shown in the info bubble. */
  about: string;
  vision?: boolean;
  recommended?: string;
}

export const LOCAL_MODELS: LocalModel[] = [
  { tag: 'qwen3:4b', name: 'Qwen3 4B', hf: 'Qwen/Qwen3-4B', size: '2.6 GB', memory: '8 GB RAM', licence: 'Apache 2.0', stars: 3, recommended: 'Start here', best: 'Everyday questions, summaries, outlines',
    about: 'Small and quick. Good for what to read, what is required, and short rewrites. It can slip on long, multi part writing, so check its drafts.' },
  { tag: 'qwen3:8b', name: 'Qwen3 8B', hf: 'Qwen/Qwen3-8B', size: '5.2 GB', memory: '16 GB RAM', licence: 'Apache 2.0', stars: 4, recommended: 'Best free writer', best: 'Assignment analysis, polishing your notes, feedback',
    about: 'The strongest free choice here for reasoning and writing. Noticeably better than the 4B model at keeping a long answer on track. Slower on older laptops.' },
  { tag: 'llama3.1:8b', name: 'Llama 3.1 8B', hf: 'meta-llama/Llama-3.1-8B-Instruct', size: '4.9 GB', memory: '16 GB RAM', licence: 'Llama 3.1 Community', stars: 3, best: 'Plain, steady writing',
    about: 'A reliable all rounder with a calm writing style. Slightly behind Qwen3 8B on reasoning. The licence has conditions for redistribution.' },
  { tag: 'gemma3:4b', name: 'Gemma 3 4B', hf: 'google/gemma-3-4b-it', size: '3.3 GB', memory: '8 GB RAM', licence: 'Gemma terms', stars: 3, vision: true, best: 'Light laptops; can read screenshots',
    about: 'Small, and it can look at images, so it can read a screenshot of a Canvas page. Writing quality is similar to Qwen3 4B.' },
  { tag: 'qwen2.5vl:3b', name: 'Qwen2.5 VL 3B', hf: 'Qwen/Qwen2.5-VL-3B-Instruct', size: '3.2 GB', memory: '8 GB RAM', licence: 'Qwen research terms', stars: 3, vision: true, best: 'Understanding screenshots and timelines',
    about: 'Reads images such as course screenshots and visual timelines. Weaker as a writer, so pair it with a text model.' },
  { tag: 'qwen2.5vl:7b', name: 'Qwen2.5 VL 7B', hf: 'Qwen/Qwen2.5-VL-7B-Instruct', size: '6.0 GB', memory: '16 GB RAM', licence: 'Apache 2.0', stars: 4, vision: true, best: 'Detailed screenshots and documents',
    about: 'A more capable image reader for dense pages and tables. Needs a stronger computer.' },
  { tag: 'phi4-mini', name: 'Phi 4 mini', hf: 'microsoft/Phi-4-mini-instruct', size: '2.5 GB', memory: '8 GB RAM', licence: 'MIT', stars: 3, best: 'Maths, logic and structured answers',
    about: 'Small and good at step by step reasoning, with a permissive MIT licence. Less natural as a prose writer.' },
];

export const DEFAULT_LOCAL_TAG = 'qwen3:4b';

/** Helper models the roadmap uses for search and checking, not for chat. */
export const HELPER_MODELS = [
  { name: 'BGE small en v1.5', hf: 'BAAI/bge-small-en-v1.5', job: 'Find the right passages across your course material', status: 'Planned' },
  { name: 'BGE reranker base', hf: 'BAAI/bge-reranker-base', job: 'Put the best passages first', status: 'Planned' },
  { name: 'all MiniLM L6 v2', hf: 'sentence-transformers/all-MiniLM-L6-v2', job: 'Fast duplicate and similarity checks', status: 'Planned' },
  { name: 'BART large MNLI', hf: 'facebook/bart-large-mnli', job: 'Zero shot sorting of pasted content', status: 'Planned' },
];

export interface CloudSetup {
  provider: 'openai' | 'anthropic';
  name: string;
  site: string;
  keyPage: string;
  steps: string[];
  cost: string;
}

export const CLOUD_SETUP: CloudSetup[] = [
  { provider: 'openai', name: 'OpenAI', site: 'platform.openai.com', keyPage: 'platform.openai.com/api-keys', cost: 'Paid per use. A semester of chat is usually a few dollars.',
    steps: ['Sign in at platform.openai.com and add a small prepaid balance under Billing.', 'Open API keys and create a new secret key.', 'Copy it once and paste it into the API key box here.', 'Tick the consent box, then save.'] },
  { provider: 'anthropic', name: 'Claude (Anthropic)', site: 'console.anthropic.com', keyPage: 'console.anthropic.com/settings/keys', cost: 'Paid per use. A semester of chat is usually a few dollars.',
    steps: ['Sign in at console.anthropic.com and add credit under Billing.', 'Open API keys and create a key.', 'Copy it once and paste it into the API key box here.', 'Tick the consent box, then save.'] },
];

export const pullCommand = (tag: string) => `ollama pull ${tag}`;
export const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

/* ---------- which model does which job ---------- */

export type Role = 'chat' | 'writing' | 'vision' | 'embed';

export interface EmbedModel { tag: string; name: string; size: string; about: string; stars: 1 | 2 | 3 | 4 | 5; hf: string; recommended?: string }
export const EMBED_MODELS: EmbedModel[] = [
  { tag: 'nomic-embed-text', name: 'Nomic Embed Text', size: '0.3 GB', hf: 'nomic-ai/nomic-embed-text-v1.5', stars: 4, recommended: 'Start here', about: 'Finds the passages of your syllabus and notes that match a question, by meaning and not just by word. Small and fast.' },
  { tag: 'all-minilm', name: 'all MiniLM L6 v2', size: '0.05 GB', hf: 'sentence-transformers/all-MiniLM-L6-v2', stars: 3, about: 'Tiny and very fast. A good pick on a slow computer; slightly less precise than Nomic.' },
  { tag: 'bge-m3', name: 'BGE M3', size: '1.2 GB', hf: 'BAAI/bge-m3', stars: 5, about: 'The most accurate search model here, from the BGE family. Larger download and slower on older laptops.' },
];

export const ROLE_INFO: Record<Role, { label: string; job: string; hint: string }> = {
  chat: { label: 'Everyday model', job: 'Questions, summaries and sorting what you paste', hint: 'Your default free model. Used whenever the message is not about an assignment.' },
  writing: { label: 'Assignment model', job: 'Planning, drafting and polishing assignments', hint: 'Used when you work on an assignment or paste assignment material. A stronger model gives better writing.' },
  vision: { label: 'Image model', job: 'Reading screenshots and photos', hint: 'Used when you attach a picture. It runs on this computer; the image is never uploaded.' },
  embed: { label: 'Search model', job: 'Finding the right passages in your saved material', hint: 'Used before each answer to pull the passages that matter. Optional: without it the app searches by keywords.' },
};

export const DEFAULT_WRITING_TAG = 'qwen3:8b';
export const DEFAULT_VISION_TAG = 'qwen2.5vl:3b';
export const DEFAULT_EMBED_TAG = 'nomic-embed-text';

interface RoleSettings { provider: string; model: string; writingModel?: string; visionModel?: string; embedModel?: string }

/** The model for a job. Empty means that job is not set up. */
export function modelFor(s: RoleSettings, role: Role): string {
  if (role === 'chat') return s.model;
  if (role === 'writing') return s.writingModel || s.model;
  if (role === 'vision') return s.visionModel ?? '';
  return s.embedModel ?? '';
}

/** Short name for the screen, for example "Qwen3 8B". */
export function modelLabel(tag: string): string {
  const all = [...LOCAL_MODELS.map((m) => [m.tag, m.name]), ...EMBED_MODELS.map((m) => [m.tag, m.name])];
  return all.find(([t]) => t === tag)?.[1] ?? tag;
}

/**
 * Is a message about an assignment? 2 or more cues: yes. None: no. One cue:
 * unsure, so the chat asks.
 */
const CUES = [/\bdue\b/i, /\brubric\b/i, /\bpoints?\b/i, /\bsubmit|submission\b/i, /\bdiscussion (question|post|board|prompt)\b/i, /\b(essay|paper|project|assignment|case study|reflection|response paper)\b/i, /\bword(s| count)?\b.*\d|\d.*\bwords?\b/i, /\bAPA\b/i, /\bprompt\b/i, /\b(write|draft|outline|rewrite|polish)\b/i];
export type Intent = 'assignment' | 'general' | 'unsure';
export function guessIntent(text: string, titles: string[] = []): Intent {
  const lower = text.toLowerCase();
  if (titles.some((t) => t.length > 6 && lower.includes(t.toLowerCase()))) return 'assignment';
  const n = CUES.filter((re) => re.test(text)).length;
  return n >= 3 ? 'assignment' : n === 0 ? 'general' : 'unsure';
}
