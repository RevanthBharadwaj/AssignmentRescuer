// @vitest-environment jsdom
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../src/ui/App';

vi.mock('../src/ui/feedFetcher', async () => ({ fetchFeed: async () => '' }));
vi.mock('../src/ui/aiClient', () => ({
  completeAi: async () => '# Leadership and Trust\n\nMy first paragraph.\n\n# References\nRivera, M. (2021). Example.',
  hasSecret: async () => false,
  setSecret: async () => undefined,
  embedAi: async (_m: string, _u: string, t: string[]) => t.map(() => [1, 0]),
  describeImage: async () => 'Week 1 Reading due Friday, 20 points',
}));
const saved: { name: string; size: number }[] = [];
vi.mock('../src/ui/exporter', () => ({ saveDocx: async (name: string, bytes: Uint8Array) => { saved.push({ name, size: bytes.length }); return `Downloads/${name}`; } }));
vi.mock('../src/ui/notifier', () => ({ sendEmail: async () => undefined, notifyDesktop: async () => undefined }));
vi.mock('../src/ui/scholarClient', () => ({
  scholarGet: async (url: string) => {
    if (url.includes('openalex')) return JSON.stringify({ results: [] });
    return JSON.stringify({ message: { items: [{ DOI: '10.9999/example.101', title: ['Learning Habits in Online Seminars'], author: [{ family: 'Rivera', given: 'Maria' }], issued: { 'date-parts': [[2021]] }, 'container-title': ['Journal of Example Studies'], volume: '12', issue: '3', page: '45-67', type: 'journal-article' }] } });
  },
}));
import { approveAll, fixture, makeService } from './helpers';

afterEach(cleanup);

async function setup() {
  const { service } = await makeService();
  await service.saveProfile('Example University', 'MS Data Science');
  await service.saveSemester({
    name: 'Fall 2026',
    start: { iso: '2026-08-24', year: 2026, month: 8, day: 24, yearSource: 'explicit', time: null, timeZone: null, raw: '' },
    end: { iso: '2026-12-15', year: 2026, month: 12, day: 15, yearSource: 'explicit', time: null, timeZone: null, raw: '' },
  });
  await service.addCourse({ code: 'dsc6400', name: 'Data Ethics', instructor: null });
  await service.importForCourse('DSC 6400', [{ kind: 'text', text: fixture('canvas-modules.txt') }]);
  await approveAll(service);
  render(<App service={service} mode="test" today="2026-09-02" />);
  return service;
}

describe('unit blocks and chat', () => {
  it('shows unit blocks on the course home and opens that unit', async () => {
    await setup();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workflow' })).getByRole('button', { name: /Courses/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open DSC 6400' }));
    const blocks = await screen.findAllByRole('button', { name: /^Open Unit \d/ });
    expect(blocks.length).toBeGreaterThan(0);
    fireEvent.click(blocks[0]);
    expect(await screen.findByRole('heading', { name: 'Week 1' })).toBeInTheDocument();
  });

  it('has a chat tab that saves a paste once and answers questions', async () => {
    const service = await setup();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workflow' })).getByRole('button', { name: /Chat/ }));
    fireEvent.change(await screen.findByLabelText('Course'), { target: { value: 'DSC 6400' } });
    const paste = fixture('canvas-modules.txt');
    const before = (await service.repository.listRecords('assignment')).length;
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: paste } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/already|nothing new|duplicate|no new/i, undefined, { timeout: 4000 })).toBeInTheDocument();
    expect((await service.repository.listRecords('assignment')).length).toBe(before);

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'What should I read first?' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Turn on the AI/)).toBeInTheDocument();
  });

  it('asks when pasted material names a different semester and saves nothing until told', async () => {
    const service = await setup();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workflow' })).getByRole('button', { name: /Chat/ }));
    fireEvent.change(await screen.findByLabelText('Course'), { target: { value: 'DSC 6400' } });
    const before = (await service.repository.listRecords('assignment')).length;
    const other = `Spring 2027 Week 1\nReading due Friday, Jan 15, 20 points\n${'Read the chapter carefully and post in the forum. '.repeat(12)}`;
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: other } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/This says Spring 2027, but your semester is Fall 2026/)).toBeInTheDocument();
    expect((await service.repository.listRecords('assignment')).length).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'No, it is another semester' }));
    expect(await screen.findByText(/I did not save it/)).toBeInTheDocument();
    expect((await service.repository.listRecords('assignment')).length).toBe(before);
  });

  it('uses the find sources tool from chat, saves the APA reference and lets the chat cite only that', async () => {
    const service = await setup();
    await service.saveAiSettings({ provider: 'ollama', model: 'qwen3:4b', ollamaUrl: 'http://localhost:11434', cloudConsent: true, writingModel: 'qwen3:8b', visionModel: '', embedModel: '', enabled: { ollama: true, anthropic: true, openai: false } });
    const a = (await service.repository.listRecords('assignment'))[0];
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workflow' })).getByRole('button', { name: /Chat/ }));
    fireEvent.change(await screen.findByLabelText('Course'), { target: { value: 'DSC 6400' } });
    fireEvent.change(screen.getByLabelText('Working on'), { target: { value: a.id } });
    expect(screen.queryByText('Find real sources and APA references')).toBeNull();
    expect(screen.getByLabelText('Tools the chat can use')).toHaveTextContent('Find sources');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'find sources on learning habits seminars' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask anyway' }));
    expect(await screen.findByText(/Find sources: 1 found for "learning habits seminars"/)).toBeInTheDocument();
    expect(await screen.findByText(/\(Rivera, 2021\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save with this assignment' }));
    expect(await screen.findByText(/Sources saved for this assignment \(1\)/)).toBeInTheDocument();
    const refs = await service.referencesFor(a.key);
    expect(refs).toHaveLength(1);
    expect(String(refs[0].fields.summary)).toBe('Rivera, M. (2021). Learning Habits in Online Seminars. Journal of Example Studies, 12(3), 45–67. https://doi.org/10.9999/example.101');
    expect(await service.chatSystemFor('DSC 6400', a.id, '2026-09-02')).toContain('VERIFIED SOURCES');
  });

  it('writes the assignment as a document and saves it as a Word file', async () => {
    const service = await setup();
    await service.saveAiSettings({ provider: 'ollama', model: 'qwen3:4b', ollamaUrl: 'http://localhost:11434', cloudConsent: true, writingModel: 'qwen3:8b', visionModel: '', embedModel: '', enabled: { ollama: true, anthropic: true, openai: false } });
    const a = (await service.repository.listRecords('assignment'))[0];
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workflow' })).getByRole('button', { name: /Chat/ }));
    fireEvent.change(await screen.findByLabelText('Course'), { target: { value: 'DSC 6400' } });
    fireEvent.change(screen.getByLabelText('Working on'), { target: { value: a.id } });
    fireEvent.click(await screen.findByRole('button', { name: 'Write this assignment as a document' }));
    expect(await screen.findByText(/My first paragraph/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download as Word document' }));
    expect(await screen.findByText(/Saved Word document/)).toBeInTheDocument();
    expect(saved[0].name).toBe('Leadership and Trust.docx');
    expect(saved[0].size).toBeGreaterThan(500);
  });

  it('names the model, uses the assignment model for assignment work and asks when unsure', async () => {
    const service = await setup();
    await service.saveAiSettings({ provider: 'ollama', model: 'qwen3:4b', ollamaUrl: 'http://localhost:11434', cloudConsent: true, writingModel: 'qwen3:8b', visionModel: '', embedModel: '', enabled: { ollama: true, anthropic: true, openai: false } });
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workflow' })).getByRole('button', { name: /Chat/ }));
    fireEvent.change(await screen.findByLabelText('Course'), { target: { value: 'DSC 6400' } });
    expect(await screen.findByText(/Everyday: Qwen3 4B · Assignments: Claude Sonnet 5.5/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello, how is everyone today' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Qwen3 4B · everyday chat \(free, on this computer\)/)).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Write the Week 2 reflection paper in APA, 500 words, due Saturday, 50 points' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask anyway' }));
    expect(await screen.findByText(/Claude Sonnet 5.5 · assignment analysis/)).toBeInTheDocument();

    const long = `Reminder about the paper.\n${'Please keep reading the course material carefully and ask questions in the forum. '.repeat(8)}`;
    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: long } });
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Is this about an assignment, or something else/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Something else' }));
    await screen.findAllByText(/Qwen3 4B · everyday chat|saved|already|nothing new|No new|added|found/i, undefined, { timeout: 4000 });
    expect(screen.queryByText(/Is this about an assignment, or something else/)).not.toBeInTheDocument();
  });

  it('waits for the syllabus and brief before analyzing an assignment, then goes ahead when asked', async () => {
    const service = await setup();
    await service.saveAiSettings({ provider: 'ollama', model: 'qwen3:4b', ollamaUrl: 'http://localhost:11434', cloudConsent: true, writingModel: 'qwen3:8b', visionModel: '', embedModel: '', enabled: { ollama: true, anthropic: true, openai: false } });
    const a = (await service.repository.listRecords('assignment'))[0];
    const ctx = await service.assignmentContext('DSC 6400', a.id);
    expect(ctx.blocking).toBe(true);
    expect(ctx.missing).toContain('the syllabus');
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workflow' })).getByRole('button', { name: /Chat/ }));
    fireEvent.change(await screen.findByLabelText('Course'), { target: { value: 'DSC 6400' } });
    fireEvent.change(screen.getByLabelText('Working on'), { target: { value: a.id } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'How should I plan this one?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/missing the syllabus/)).toBeInTheDocument();
    expect(screen.queryByText(/Claude Sonnet 5.5 · assignment analysis/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ask anyway' }));
    expect(await screen.findByText(/Claude Sonnet 5.5 · assignment analysis/)).toBeInTheDocument();
  });

  it('says assignments need Claude when only a local model is on', async () => {
    const service = await setup();
    await service.saveAiSettings({ provider: 'ollama', model: 'qwen3:4b', ollamaUrl: 'http://localhost:11434', cloudConsent: false });
    const a = (await service.repository.listRecords('assignment'))[0];
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workflow' })).getByRole('button', { name: /Chat/ }));
    fireEvent.change(await screen.findByLabelText('Course'), { target: { value: 'DSC 6400' } });
    fireEvent.change(screen.getByLabelText('Working on'), { target: { value: a.id } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'How should I plan this one?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask anyway' }));
    expect(await screen.findByText(/Assignment analysis uses Claude/)).toBeInTheDocument();
  });
});
