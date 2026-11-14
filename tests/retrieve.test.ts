import { chunkText, keywordRank, retrieve } from '../src/core/retrieve';
import { guessIntent, modelFor, modelLabel } from '../src/core/models';

const text = `Late work loses ten percent per day.\n\nGrading: discussions are worth 220 points in total.\n\nOffice hours are on Tuesday afternoons by video.\n\nThe final paper presents leadership theories and is worth 330 points.`;

describe('retrieval', () => {
  const chunks = chunkText(text, 'syllabus', 60);
  it('chunks by paragraph', () => expect(chunks.length).toBeGreaterThanOrEqual(3));
  it('ranks by keywords', async () => {
    expect(keywordRank('when are office hours', chunks)[0].chunk.text).toContain('Office hours');
    const r = await retrieve('how many points is the final paper', chunks, 2);
    expect(r[0].chunk.text).toContain('final paper');
    expect(r[0].how).toBe('keywords');
  });
  it('re ranks by meaning when an embedder exists and falls back when it fails', async () => {
    const embed = async (texts: string[]) => texts.map((t) => [/late/i.test(t) ? 1 : 0, /office/i.test(t) ? 1 : 0.1]);
    const r = await retrieve('late policy', chunks, 1, embed, 'test');
    expect(r[0].how).toBe('meaning');
    const bad = await retrieve('office hours', chunks, 1, async () => { throw new Error('down'); }, 'x');
    expect(bad[0].how).toBe('keywords');
  });
});

describe('model roles', () => {
  const s = { provider: 'ollama', model: 'qwen3:4b', writingModel: 'qwen3:8b', visionModel: '', embedModel: 'nomic-embed-text' };
  it('picks the model for each job', () => {
    expect(modelFor(s, 'chat')).toBe('qwen3:4b');
    expect(modelFor(s, 'writing')).toBe('qwen3:8b');
    expect(modelFor(s, 'vision')).toBe('');
    expect(modelFor({ provider: 'ollama', model: 'qwen3:4b' }, 'writing')).toBe('qwen3:4b');
    expect(modelLabel('qwen3:8b')).toBe('Qwen3 8B');
  });
  it('tells assignment text from other text, and asks when unsure', () => {
    expect(guessIntent('Write a 500 word reflection paper in APA. Due Saturday, 150 points. Prompt: describe your learning.')).toBe('assignment');
    expect(guessIntent('Welcome to the course everyone, glad to have you here')).toBe('general');
    expect(guessIntent('Remember the paper is coming up')).toBe('unsure');
    expect(guessIntent('hello about Project 2 Personal Learning Strategy', ['Project 2 Personal Learning Strategy'])).toBe('assignment');
  });
});
