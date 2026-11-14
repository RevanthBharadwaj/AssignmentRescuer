// @vitest-environment jsdom
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { App } from '../src/ui/App';
import { approveAll, fixture, makeService } from './helpers';

afterEach(cleanup);

async function setup(today = '2026-09-02') {
  const { service } = await makeService();
  render(<App service={service} mode="test" today={today} />);
  return service;
}

const dock = (name: string | RegExp) => within(screen.getByRole('navigation', { name: 'Workflow' })).getByRole('button', { name });
const top = (name: string) => within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name });

async function typedSemester(service: Awaited<ReturnType<typeof setup>>) {
  await service.saveProfile('Example University', 'MS Data Science');
  await service.saveSemester({
    name: 'Fall 2026',
    start: { iso: '2026-08-24', year: 2026, month: 8, day: 24, yearSource: 'explicit', time: null, timeZone: null, raw: '' },
    end: { iso: '2026-12-15', year: 2026, month: 12, day: 15, yearSource: 'explicit', time: null, timeZone: null, raw: '' },
  });
  await service.addCourse({ code: 'dsc6400', name: 'Data Ethics', instructor: null });
}

describe('desktop UI', () => {
  it('sends a first time student to semester setup', async () => {
    await setup();
    expect(await screen.findByRole('heading', { name: 'Set up your semester' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start setup →' }));
    expect(await screen.findByRole('heading', { name: 'Your semester' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Courses this semester' })).toBeInTheDocument();
  });

  it('saves school, semester and courses typed in setup without a review step', async () => {
    const service = await setup();
    fireEvent.click(top('Semester setup'));
    fireEvent.change(await screen.findByLabelText('University'), { target: { value: 'Example University' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save school' }));
    expect(await screen.findByText('✓ School saved')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Term'), { target: { value: 'Fall' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } });
    fireEvent.change(screen.getByLabelText('First day'), { target: { value: '2026-08-24' } });
    fireEvent.change(screen.getByLabelText('Last day'), { target: { value: '2026-12-15' } });
    expect(screen.getByText('16 weeks.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save semester' }));
    expect(await screen.findByText('✓ Semester saved')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Course code'), { target: { value: 'mgt 6200' } });
    fireEvent.change(screen.getByLabelText('Course name'), { target: { value: 'Leadership Theories' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add course' }));
    expect(await screen.findByText('✓ MGT 6200 added')).toBeInTheDocument();

    expect(await service.repository.listProposals('pending')).toHaveLength(0);
    const st = await service.onboarding();
    expect(st.questions.map((q) => q.answer)).toEqual(['Example University', null, 'Fall 2026', '2026-08-24', '2026-12-15', '16 weeks', 'MGT 6200 Leadership Theories']);

    fireEvent.click(dock('Courses'));
    expect(await screen.findByRole('button', { name: 'Open MGT 6200' })).toBeInTheDocument();
  });

  it('imports a pasted Canvas modules page into a course and fills its tabs', async () => {
    const service = await setup('2026-09-02');
    await typedSemester(service);
    fireEvent.click(dock('Courses'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open DSC 6400' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Add material' }));
    fireEvent.change(screen.getByLabelText(/Paste anything for DSC 6400/), { target: { value: fixture('canvas-modules.txt') } });
    fireEvent.click(screen.getByRole('button', { name: 'Extract' }));

    expect(await screen.findByRole('heading', { name: /Graded work and deadlines/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Readings, lectures and files/ })).toBeInTheDocument();
    // The project mentioned only in a reminder gets a date typed inline.
    fireEvent.change(screen.getByLabelText('Due date for Project 1: Ethics Case Brief'), { target: { value: '2026-09-20' } });
    fireEvent.click(screen.getByRole('button', { name: /^Approve \d+ selected$/ }));
    expect(await screen.findByText('Nothing waiting for DSC 6400.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }));
    expect(await screen.findByRole('button', { name: 'Week 2: Writing Assignment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Project 1: Ethics Case Brief' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Assignments' }));
    expect(await screen.findByText('645 points listed in your material.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Readings and materials' }));
    expect(await screen.findByText('Foundations of Data Ethics.pdf')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Week 1' })).toBeInTheDocument();

    fireEvent.click(dock('Home'));
    expect(await screen.findByRole('heading', { name: 'Due in the next 7 days' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Week 1: Discussion Question 1' })).toBeInTheDocument();
  });

  it('opens an assignment workspace with its checklist', async () => {
    const service = await setup('2026-09-02');
    await typedSemester(service);
    await service.importForCourse('DSC 6400', [{ kind: 'text', text: fixture('canvas-modules.txt') }]);
    await approveAll(service);
    fireEvent.click(dock('Courses'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open DSC 6400' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Week 15: Final Research Paper' }));
    expect(await screen.findByRole('heading', { name: 'Requirements checklist' })).toBeInTheDocument();
    expect(screen.getByText(/Submit by Dec 14, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Not found in your material yet/)).toBeInTheDocument();
  });

  it('shows old and new values for a changed deadline', async () => {
    const service = await setup();
    await service.import([{ kind: 'text', text: fixture('syllabus.txt') }]);
    await approveAll(service);
    await service.import([{ kind: 'text', text: fixture('announcement-update.txt') }]);
    fireEvent.click(dock(/^Review/));
    const card = await screen.findByRole('article', { name: 'Assignment: Homework 1' });
    expect(within(card).getByText('Changed since you last confirmed it')).toBeInTheDocument();
    expect(within(card).getByText(/Sep 6, 2026/)).toBeInTheDocument();
    expect(within(card).getByText(/Sep 8, 2026/)).toBeInTheDocument();
  });

  it('reports unsupported files honestly on the syllabus import page', async () => {
    await setup();
    fireEvent.click(top('Import a syllabus'));
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'syllabus.pdf', { type: 'application/pdf' });
    fireEvent.change(await screen.findByLabelText('Choose files'), { target: { files: [file] } });
    expect(await screen.findByText(/syllabus\.pdf/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Extract information' }));
    expect(await screen.findByText(/Import of pdf files is not available yet/)).toBeInTheDocument();
  });

  it('lists implemented, experimental and unavailable features', async () => {
    await setup();
    fireEvent.click(top('Features'));
    expect(await screen.findByRole('heading', { name: 'Not available yet' })).toBeInTheDocument();
    expect(screen.getByText('Notifications while the app is closed')).toBeInTheDocument();
  });

  it('prompts for next semester subjects 14 days before the end and stops once answered', async () => {
    const { service } = await makeService();
    await service.import([{ kind: 'text', text: 'Spring 2027\nClasses begin January 11, 2027\nLast day of classes: April 30, 2027' }]);
    await approveAll(service);
    render(<App service={service} mode="test" today="2027-04-16" />);
    expect(await screen.findByText('What subjects are you taking next semester?')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Next semester subjects'), { target: { value: 'CIS 6940, STA 6166' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save subjects' }));
    expect(await screen.findByText('Next semester: CIS 6940, STA 6166')).toBeInTheDocument();
  });
});
