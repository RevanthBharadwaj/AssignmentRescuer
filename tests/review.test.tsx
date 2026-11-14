// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { App } from '../src/ui/App';
import { makeService } from './helpers';
vi.mock('../src/ui/notifier', () => ({ sendEmail: async () => undefined, notifyDesktop: async () => undefined }));
afterEach(cleanup);

describe('Review page suggestions and draft check', () => {
  it('shows a suggestion, applies it, and undo brings it back', async () => {
    const { service } = await makeService();
    await service.addCourse({ code: 'BUS 799', name: 'Empty', instructor: 'Dr. X' });
    render(<App service={service} mode="test" today="2026-11-14" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workflow' })).getByRole('button', { name: /Review/ }));
    expect(await screen.findByText(/BUS 799 has nothing in it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the course' }));
    await waitFor(() => expect(screen.queryByText(/BUS 799 has nothing in it/)).not.toBeInTheDocument());
    fireEvent.click((await screen.findAllByRole('button', { name: 'Undo' }))[0]);
    await waitFor(async () => expect((await service.repository.listRecords()).some((r) => r.fields.code === 'BUS 799')).toBe(true));
  });
});
