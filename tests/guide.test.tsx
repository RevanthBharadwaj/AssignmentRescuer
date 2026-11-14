// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../src/ui/App';

vi.mock('../src/ui/feedFetcher', async () => ({ fetchFeed: async () => '' }));
vi.mock('../src/ui/aiClient', () => ({ completeAi: async () => '{}', hasSecret: async () => false, setSecret: async () => undefined, embedAi: async () => [], describeImage: async () => '' }));
vi.mock('../src/ui/notifier', () => ({ sendEmail: async () => undefined, notifyDesktop: async () => undefined }));
import { makeService } from './helpers';

afterEach(cleanup);

describe('walkthrough and hints', () => {
  it('walks a new student through the app and goes to each place', async () => {
    const { service } = await makeService();
    render(<App service={service} mode="test" today="2026-09-02" />);
    fireEvent.click(screen.getByRole('button', { name: 'Take the tour' }));
    expect(await screen.findByText('Step 1 of 6')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Turn on the free AI assistant' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose your AI' }));
    expect(await screen.findByRole('heading', { name: 'Your semester' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip the tour' }));
    expect(screen.queryByRole('dialog', { name: 'Welcome tour' })).not.toBeInTheDocument();
    expect(await service.repository.getSetting('tour.done', false)).toBe(true);
  });

  it('shows a tip on a page and remembers when it is dismissed', async () => {
    const { service } = await makeService();
    render(<App service={service} mode="test" today="2026-09-02" />);
    fireEvent.click(screen.getByRole('button', { name: 'Semester setup' }));
    expect(await screen.findByRole('note', { name: /Tip: Do these in order/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('note', { name: /Tip: Do these in order/ })).not.toBeInTheDocument());
    expect(await service.repository.getSetting<string[]>('hints.dismissed', [])).toContain('setup');
  });
});
