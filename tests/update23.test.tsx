// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { App } from '../src/ui/App';
import { makeService } from './helpers';

vi.mock('../src/ui/notifier', () => ({ sendEmail: async () => undefined, notifyDesktop: async () => undefined }));
vi.mock('../src/ui/sound', () => ({ playFanfare: () => undefined }));
afterEach(cleanup);

const due = (iso: string, time: string | null = '23:59') => { const [y, m, d] = iso.split('-').map(Number); return { iso, month: m, day: d, year: y, time, raw: iso } as never; };

describe('update 23 screens', () => {
  it('asks before marking an assignment done, then celebrates, and undo works', async () => {
    const { service } = await makeService();
    await service.saveStudent({ name: 'Kusumanjali Setti' });
    await service.addCourse({ code: 'BUS 1', name: 'Business', instructor: 'Dr. P' });
    const a = await service.saveTyped('assignment', { title: 'Unit 2 Discussion 1', courseCode: 'BUS 1', dueDate: due('2026-11-20') }, null);
    render(<App service={service} mode="test" today="2026-11-14" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workflow' })).getByRole('button', { name: /Courses/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open BUS 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unit 2 Discussion 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as done' }));
    expect(await screen.findByText(/really done/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not yet' }));
    expect((await service.repository.getRecord(a.id))!.fields.status ?? null).toBe(null);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, it is done' }));
    expect(await screen.findByText(/is marked as done/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Well done, Kusumanjali\./ })).toBeInTheDocument();
    expect((await service.repository.getRecord(a.id))!.fields.status).toBe('submitted');
  });

  it('changes a due date only after confirming', async () => {
    const { service } = await makeService();
    await service.addCourse({ code: 'BUS 1', name: 'Business', instructor: 'Dr. P' });
    const a = await service.saveTyped('assignment', { title: 'Unit 2 Paper', courseCode: 'BUS 1', dueDate: due('2026-11-20') }, null);
    render(<App service={service} mode="test" today="2026-11-14" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workflow' })).getByRole('button', { name: /Courses/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open BUS 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unit 2 Paper' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change due date' }));
    fireEvent.change(screen.getByLabelText('New due date'), { target: { value: '2026-11-25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
    expect(screen.getByText(/Change from .* to .*\?/)).toBeInTheDocument();
    expect((await service.repository.getRecord(a.id))!.fields.dueDate).toMatchObject({ iso: '2026-11-20' });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, change it' }));
    await waitFor(async () => expect((await service.repository.getRecord(a.id))!.fields.dueDate).toMatchObject({ iso: '2026-11-25' }));
  });

  it('shows the bell with what is due, the greeting with the name, sticky notes and the calendar on Home', async () => {
    const { service } = await makeService();
    await service.saveStudent({ name: 'Kusumanjali Setti' });
    await service.addCourse({ code: 'BUS 1', name: 'Business', instructor: 'Dr. P' });
    await service.saveTyped('assignment', { title: 'Unit 2 Paper', courseCode: 'BUS 1', dueDate: due('2026-11-14') }, null);
    render(<App service={service} mode="test" today="2026-11-14" />);
    expect(await screen.findByRole('heading', { level: 1, name: /Kusumanjali\./ })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Notifications, 1 new/ }));
    expect(await screen.findByText(/Unit 2 Paper is due today at 11:59 PM/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Calendar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ New note' }));
    const box = await screen.findByLabelText('Sticky note text');
    fireEvent.change(box, { target: { value: 'Ask the professor about chapter 2' } });
    fireEvent.blur(box);
    await waitFor(async () => expect((await service.stickies())[0]?.text).toBe('Ask the professor about chapter 2'));
    expect(screen.queryByRole('button', { name: 'Calendar' })).not.toBeInTheDocument(); // no separate Calendar tab any more
  });

  it('has no Modules or Policies tab, and shows rules on the Assignments tab', async () => {
    const { service } = await makeService();
    await service.addCourse({ code: 'BUS 1', name: 'Business', instructor: 'Dr. P' });
    render(<App service={service} mode="test" today="2026-11-14" />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workflow' })).getByRole('button', { name: /Courses/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open BUS 1' }));
    const menu = await screen.findByRole('navigation', { name: 'BUS 1 course menu' });
    expect(within(menu).queryByRole('button', { name: /^Modules/ })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: /^Policies/ })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('button', { name: /^Assignments/ }));
    expect(await screen.findByRole('heading', { name: 'Rules and policies' })).toBeInTheDocument();
  });
});
