// @vitest-environment jsdom
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../src/ui/App';

vi.mock('../src/ui/feedFetcher', async () => ({ fetchFeed: async () => '' }));
vi.mock('../src/ui/aiClient', () => ({
  completeAi: async () => '# Leadership and Trust\n\nMy first paragraph.\n\n# References\nRivera, M. (2021). Example.',
  hasSecret: async () => false,
  setSecret: async () => undefined,
}));
const saved: { name: string; size: number }[] = [];
vi.mock('../src/ui/exporter', () => ({ saveDocx: async (name: string, bytes: Uint8Array) => { saved.push({ name, size: bytes.length }); return `Downloads/${name}`; } }));
vi.mock('../src/ui/notifier', () => ({ sendSms: async () => undefined, notifyDesktop: async () => undefined }));
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

  it('finds a real source, saves its APA reference with the assignment and lets the chat cite only that', async () => {
    const service = await setup();
    const a = (await service.repository.listRecords('assignment'))[0];
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workflow' })).getByRole('button', { name: /Chat/ }));
    fireEvent.change(await screen.findByLabelText('Course'), { target: { value: 'DSC 6400' } });
    fireEvent.change(screen.getByLabelText('Working on'), { target: { value: a.id } });
    fireEvent.click(screen.getByText('Find real sources and APA references'));
    fireEvent.change(screen.getByLabelText('Search sources'), { target: { value: 'learning habits seminars' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/\(Rivera, 2021\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save with this assignment' }));
    expect(await screen.findByText('Saved for this assignment')).toBeInTheDocument();
    const refs = await service.referencesFor(a.key);
    expect(refs).toHaveLength(1);
    expect(String(refs[0].fields.summary)).toBe('Rivera, M. (2021). Learning Habits in Online Seminars. Journal of Example Studies, 12(3), 45–67. https://doi.org/10.9999/example.101');
    expect(await service.chatSystemFor('DSC 6400', a.id, '2026-09-02')).toContain('VERIFIED SOURCES');
  });

  it('writes the assignment as a document and saves it as a Word file', async () => {
    const service = await setup();
    await service.saveAiSettings({ provider: 'ollama', model: 'qwen3:4b', ollamaUrl: 'http://localhost:11434', cloudConsent: false });
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
});
