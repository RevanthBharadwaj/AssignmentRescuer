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
