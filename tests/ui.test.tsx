// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { App } from '../src/ui/App';
import { fixture, makeService } from './helpers';

afterEach(cleanup);

async function setup(today = '2026-09-01') {
  const { service } = await makeService();
  render(<App service={service} mode="test" today={today} />);
  return service;
}

describe('desktop UI', () => {
  it('shows onboarding on first launch', async () => {
    await setup();
    expect(await screen.findByText('Set up your semester')).toBeInTheDocument();
    expect(screen.getByText('What university are you attending?')).toBeInTheDocument();
  });

  it('imports pasted text, requires review, and shows confirmed deadlines', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add information' }));
    fireEvent.change(screen.getByLabelText(/Paste text/), { target: { value: fixture('syllabus.txt') } });
    fireEvent.click(screen.getByRole('button', { name: 'Extract information' }));
    const review = await screen.findByRole('button', { name: /Review \d+ items/ });
    fireEvent.click(review);

    expect(await screen.findByRole('heading', { name: 'Review extracted information' })).toBeInTheDocument();
    const final = screen.getByRole('article', { name: 'Assignment: Final Project' });
    expect(within(final).getByText('Time zone not stated')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve all new items with no warnings' }));
    await waitFor(() => expect(screen.getAllByRole('article').length).toBe(1));
    fireEvent.click(within(screen.getByRole('article')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Nothing waiting for review.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(await screen.findByText('Due in the next 14 days')).toBeInTheDocument();
    expect(await screen.findByText('Homework 1')).toBeInTheDocument();
    expect(screen.queryByText('Set up your semester')).not.toBeInTheDocument();
  });

  it('shows old and new values for a changed deadline and keeps the choice', async () => {
    const service = await setup();
    await service.import([{ kind: 'text', text: fixture('syllabus.txt') }]);
    for (const p of await service.repository.listProposals()) await service.approve(p.id);
    await service.import([{ kind: 'text', text: fixture('announcement-update.txt') }]);

    fireEvent.click(screen.getByRole('button', { name: /^Review/ }));
    const card = await screen.findByRole('article', { name: 'Assignment: Homework 1' });
    expect(within(card).getByText('Changed since you last confirmed it')).toBeInTheDocument();
    expect(within(card).getByText(/Sep 6, 2026/)).toBeInTheDocument();
    expect(within(card).getByText(/Sep 8, 2026/)).toBeInTheDocument();
  });

  it('reports unsupported files honestly', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add information' }));
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'syllabus.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file] } });
    expect(await screen.findByText(/syllabus\.pdf/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Extract information' }));
    expect(await screen.findByText(/Import of pdf files is not available yet/)).toBeInTheDocument();
  });

  it('lists implemented, experimental and unavailable features', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Features' }));
    expect(await screen.findByRole('heading', { name: 'Not available yet' })).toBeInTheDocument();
    expect(screen.getByText('Notifications while the app is closed')).toBeInTheDocument();
    expect(screen.getByText('PDF files')).toBeInTheDocument();
  });

  it('prompts for next semester subjects 14 days before the end and stops once answered', async () => {
    const { service } = await makeService();
    await service.import([{ kind: 'text', text: 'Spring 2027\nClasses begin January 11, 2027\nLast day of classes: April 30, 2027' }]);
    for (const p of await service.repository.listProposals()) await service.approve(p.id);
    render(<App service={service} mode="test" today="2027-04-16" />);
    expect(await screen.findByText('What subjects are you taking next semester?')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Next semester subjects'), { target: { value: 'CIS 6940, STA 6166' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save subjects' }));
    expect(await screen.findByText('Next semester: CIS 6940, STA 6166')).toBeInTheDocument();
    expect(screen.queryByText('What subjects are you taking next semester?')).not.toBeInTheDocument();
  });
});
