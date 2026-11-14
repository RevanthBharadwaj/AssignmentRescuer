// @vitest-environment jsdom
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../src/ui/App';

vi.mock('../src/ui/feedFetcher', async () => ({ fetchFeed: async () => '' }));
vi.mock('../src/ui/aiClient', () => ({
  completeAi: async () => 'Start with the Unit 1 reading, then outline your post.',
  hasSecret: async () => false,
  setSecret: async () => undefined,
}));
vi.mock('../src/ui/notifier', () => ({ sendSms: async () => undefined, notifyDesktop: async () => undefined }));
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
    expect(await screen.findByText(/Turn on the AI|Start with the Unit 1 reading/)).toBeInTheDocument();
  });
});
