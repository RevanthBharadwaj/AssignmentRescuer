// @vitest-environment jsdom
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../src/ui/App';
import { isInstalled } from '../src/core/models';

const pulls: { url: string; tag: string }[] = [];
vi.mock('../src/ui/ollamaClient', () => ({
  canDownload: () => true,
  installedModels: async () => ['qwen3:8b', 'nomic-embed-text:latest'],
  pullModel: async (url: string, tag: string, onProgress: (p: { model: string; status: string; completed: number; total: number }) => void) => {
    pulls.push({ url, tag });
    onProgress({ model: tag, status: 'pulling abc', completed: 50, total: 100 });
  },
}));
vi.mock('../src/ui/feedFetcher', async () => ({ fetchFeed: async () => '' }));
vi.mock('../src/ui/aiClient', () => ({
  completeAi: async () => '', hasSecret: async () => false, setSecret: async () => undefined,
  embedAi: async () => [], describeImage: async () => '',
}));
vi.mock('../src/ui/notifier', () => ({ sendEmail: async () => undefined, notifyDesktop: async () => undefined }));
import { makeService } from './helpers';

afterEach(cleanup);

describe('model download', () => {
  it('recognises installed models, including the latest tag', () => {
    expect(isInstalled(['qwen3:8b', 'nomic-embed-text:latest'], 'qwen3:8b')).toBe(true);
    expect(isInstalled(['qwen3:8b', 'nomic-embed-text:latest'], 'nomic-embed-text')).toBe(true);
    expect(isInstalled(['qwen3:8b'], 'qwen3:4b')).toBe(false);
    expect(isInstalled([], '')).toBe(false);
  });

  it('asks before downloading, shows what is installed and downloads after confirming', async () => {
    const { service } = await makeService();
    render(<App service={service} mode="test" today="2026-09-02" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Semester setup' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Free local model/ }));

    const card = (name: string) => screen.getByRole('radio', { name }).closest('.model-card') as HTMLElement;
    await waitFor(() => expect(within(card('Qwen3 8B')).getByText(/Installed/)).toBeInTheDocument());

    fireEvent.click(within(card('Qwen3 4B')).getByRole('button', { name: 'Download' }));
    expect(pulls).toHaveLength(0); // nothing happens until the student confirms
    expect(within(card('Qwen3 4B')).getByText(/ollama pull qwen3:4b/)).toBeInTheDocument();
    fireEvent.click(within(card('Qwen3 4B')).getByRole('button', { name: 'Cancel' }));
    expect(pulls).toHaveLength(0);

    fireEvent.click(within(card('Qwen3 4B')).getByRole('button', { name: 'Download' }));
    fireEvent.click(within(card('Qwen3 4B')).getByRole('button', { name: 'Yes, download' }));
    await waitFor(() => expect(pulls).toEqual([{ url: 'http://localhost:11434', tag: 'qwen3:4b' }]));
  });
});
