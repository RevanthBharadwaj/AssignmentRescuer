// @vitest-environment jsdom
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../src/ui/App';

// The desktop app downloads the feed in Rust; tests serve the synthetic feed.
vi.mock('../src/ui/feedFetcher', async () => {
  const { fixture } = await import('./helpers');
  return { fetchFeed: async () => fixture('canvas-feed.ics') };
});
// The desktop app calls the model in Rust; tests use a stand-in answer.
const aiCalls: { provider: string; prompt: string }[] = [];
vi.mock('../src/ui/aiClient', () => ({
  completeAi: async (r: { provider: string; prompt: string }) => {
    aiCalls.push(r);
    return JSON.stringify({
      summary: 'Week 2 is about consent. Post the first discussion answer and start the writing assignment.',
      actions: [{ task: 'Post your first answer to Discussion Question 1', due: 'Wednesday', assignment: 'Week 2: Discussion Question 1' }],
      assignments: ['Week 2: Discussion Question 1'],
      cautions: ['Reply to two classmates by Sunday'],
    });
  },
  hasSecret: async () => false,
  setSecret: async () => undefined,
  embedAi: async (_m: string, _u: string, t: string[]) => t.map(() => [1, 0]),
  describeImage: async () => 'Week 1 Reading due Friday, 20 points',
}));
vi.mock('../src/ui/notifier', () => ({ sendEmail: async () => undefined, notifyDesktop: async () => undefined }));
import { approveAll, fixture, fixtureBytes, makeService } from './helpers';

afterEach(cleanup);

async function setup(today = '2026-09-02') {
  const { service } = await makeService();
  render(<App service={service} mode="test" today={today} />);
  return service;
}

const dock = (name: string | RegExp) => within(screen.getByRole('navigation', { name: 'Workflow' })).getByRole('button', { name });
const menu = async (name: string) => within(await screen.findByRole('navigation', { name: /course menu/ })).findByRole('button', { name: new RegExp(`^${name}`) });
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

  it('saves setup sections, then shows them read only with a Modify button', async () => {
    const service = await setup();
    fireEvent.click(top('Semester setup'));
    fireEvent.change(await screen.findByLabelText('Your name (for title pages)'), { target: { value: 'Alex Student' } });
    fireEvent.change(screen.getByLabelText('University'), { target: { value: 'Example University' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save school' }));
    expect(await screen.findByText('✓ School saved')).toBeInTheDocument();
    // Saved: values shown as text, inputs gone, Modify offered.
    expect(screen.queryByLabelText('University')).not.toBeInTheDocument();
    expect(screen.getByText('Alex Student')).toBeInTheDocument();
    const modify = screen.getAllByRole('button', { name: 'Modify' })[0];
    expect(modify).toHaveClass('modify');
    fireEvent.click(modify);
    expect(screen.getByLabelText('University')).toHaveValue('Example University');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('University')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Term'), { target: { value: 'Fall' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } });
    fireEvent.change(screen.getByLabelText('First day'), { target: { value: '2026-08-24' } });
    fireEvent.change(screen.getByLabelText('Last day'), { target: { value: '2026-12-15' } });
    expect(screen.getByText('16 weeks.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save semester' }));
    expect(await screen.findByText('✓ Semester saved')).toBeInTheDocument();
    expect(screen.queryByLabelText('First day')).not.toBeInTheDocument();
    expect(screen.getByText('Aug 24, 2026 to Dec 15, 2026')).toBeInTheDocument();

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

  it('asks which semester you are in and leaves out courses from other terms unless ticked', async () => {
    const service = await setup();
    await service.saveSemester({ name: 'Fall 2026', start: null, end: null });
    fireEvent.click(top('Semester setup'));
    fireEvent.change(await screen.findByLabelText('Course list'), { target: { value: [
      '2026FA Strategic Management (BUS-610-7AB12)',
      '2027SP Advanced Ethics (BUS-701A-EX9Y1)',
      '2027SP AI for Executives (BUS-729A-CX7Z1)',
    ].join('\n') } });
    // The list includes the saved semester, so no question, but the other term stays out.
    expect(await screen.findByText(/matches your saved semester, Fall 2026/)).toBeInTheDocument();
    const found = screen.getByRole('list', { name: 'Courses found' });
    expect(within(found).getByText('BUS 610')).toBeInTheDocument();
    expect(within(found).queryByText('BUS 701A')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add BUS 729A anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 courses' }));
    expect(await screen.findByText('✓ 2 courses added')).toBeInTheDocument();
    expect((await service.repository.listRecords('course')).map((c) => c.fields.code).sort()).toEqual(['BUS 610', 'BUS 729A']);
  });

  it('asks before switching to a term that is not the saved semester', async () => {
    const service = await setup();
    await service.saveSemester({ name: 'Fall 2026', start: null, end: null });
    fireEvent.click(top('Semester setup'));
    fireEvent.change(await screen.findByLabelText('Course list'), { target: { value: '2027SP Advanced Ethics (BUS-701A-EX9Y1)' } });
    expect(await screen.findByText(/your saved semester is Fall 2026/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Add \d course/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'I am in Spring 2027' }));
    expect(screen.getByText(/change your semester from Fall 2026 to Spring 2027/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 course' }));
    expect(await screen.findByText('✓ 1 course added')).toBeInTheDocument();
    expect((await service.onboarding()).currentSemester?.fields.name).toBe('Spring 2027');
  });

  it('removes unwanted rows from a pasted course list with the cross button before adding', async () => {
    const service = await setup();
    fireEvent.click(top('Semester setup'));
    fireEvent.change(await screen.findByLabelText('Course list'), { target: { value: [
      'Click to add 2026FA Applied Practicum (BUS-799-SX1Y2)',
      '2026FA Strategic Management (BUS-610-7AB12)',
      '2026FA Managerial Accounting (ACC-620A-SY01)',
    ].join('\n') } });
    fireEvent.click(await screen.findByRole('button', { name: 'I am in Fall 2026' }));
    const found = screen.getByRole('list', { name: 'Courses found' });
    expect(within(found).getByText('Applied Practicum', { exact: false })).toBeInTheDocument();
    expect(within(found).queryByText(/Click to add/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove BUS 799 from this list' }));
    expect(within(screen.getByRole('list', { name: 'Courses found' })).queryByText('BUS 799')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 courses' }));
    expect(await screen.findByText('✓ 2 courses added')).toBeInTheDocument();
    expect((await service.repository.listRecords('course')).map((c) => c.fields.code)).toEqual(['BUS 610', 'ACC 620A']);
  });

  it('adds courses from a pasted Canvas course list and lets each be modified', async () => {
    const service = await setup();
    fireEvent.click(top('Semester setup'));
    fireEvent.change(await screen.findByLabelText('Course list'), { target: { value: [
      '* [2026FA Strategic Management (BUS-610-7AB12)](https://school.instructure.com/courses/111)',
      '2026FA Strategic Management (BUS-610-7AB12)',
      'Term: 2026 Fall',
      '* [2026FA Managerial Accounting (ACC-620A-SY01)](https://school.instructure.com/courses/222)',
      'Term: 2026 Fall',
    ].join('\n') } });
    expect(screen.queryByRole('list', { name: 'Courses found' })).toBeNull(); // asks first
    fireEvent.click(screen.getByRole('button', { name: 'I am in Fall 2026' }));
    const found = screen.getByRole('list', { name: 'Courses found' });
    expect(within(found).getByText('BUS 610')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 courses' }));
    expect(await screen.findByText('✓ 2 courses added')).toBeInTheDocument();

    const courses = await service.repository.listRecords('course');
    expect(courses.map((c) => [c.fields.code, c.fields.name, c.fields.section, c.fields.semester])).toEqual([
      ['BUS 610', 'Strategic Management', '7AB12', 'Fall 2026'],
      ['ACC 620A', 'Managerial Accounting', 'SY01', 'Fall 2026'],
    ]);
    // The list's term became the semester.
    expect((await service.onboarding()).currentSemester?.fields.name).toBe('Fall 2026');

    fireEvent.click(await screen.findByRole('button', { name: 'Modify BUS 610' }));
    fireEvent.change(screen.getByLabelText('Instructor'), { target: { value: 'Dr. Jane Doe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('✓ BUS 610 updated')).toBeInTheDocument();
    const bus = await service.repository.findRecordByKey('course', 'BUS 610');
    expect(bus?.fields).toMatchObject({ instructor: 'Dr. Jane Doe', section: '7AB12', name: 'Strategic Management' });
  });

  it('imports a pasted Canvas modules page into a course and fills its sections', async () => {
    const service = await setup('2026-09-02');
    await typedSemester(service);
    fireEvent.click(dock('Courses'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open DSC 6400' }));
    // Canvas-style breadcrumbs and course menu.
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' }, { timeout: 3000 });
    await within(crumbs).findByText('DSC 6400');
    expect(within(crumbs).getAllByRole('listitem').map((li) => li.textContent?.replace('›', '').trim())).toEqual(['Home', 'Courses', 'DSC 6400']);
    fireEvent.click(await menu('Add material'));
    fireEvent.click(await screen.findByLabelText(/Modules page/));
    fireEvent.change(screen.getByLabelText(/Paste modules page for DSC 6400/), { target: { value: fixture('canvas-modules.txt') } });
    fireEvent.click(screen.getByRole('button', { name: 'Extract' }));

    expect(await screen.findByRole('heading', { name: /Graded work and deadlines/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Due date for Project 1: Ethics Case Brief'), { target: { value: '2026-09-20' } });
    fireEvent.click(screen.getByRole('button', { name: /^Approve \d+ selected$/ }));
    expect(await screen.findByText('Nothing waiting for DSC 6400.')).toBeInTheDocument();

    fireEvent.click(await menu('Modules'));
    expect(await screen.findByRole('heading', { name: 'Week 1' })).toBeInTheDocument();
    expect(screen.getByText('Foundations of Data Ethics.pdf')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Modules')).toBeInTheDocument();

    fireEvent.click(await menu('Assignments'));
    expect(await screen.findByText(/645 points listed in your material/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Discussions/ }));
    expect(screen.queryByRole('button', { name: 'Final Exam' })).not.toBeInTheDocument();

    fireEvent.click(await menu('Files and sources'));
    expect(await screen.findByRole('combobox', { name: /What is Modules page \(DSC 6400\)/ })).toHaveValue('modules');

    fireEvent.click(dock('Home'));
    expect(await screen.findByRole('heading', { name: 'Due in the next 7 days' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Week 1: Discussion Question 1' })).toBeInTheDocument();
  });

  it('keeps syllabus, announcements and policies apart and links them to assignments', async () => {
    const service = await setup('2026-09-02');
    await typedSemester(service);
    await service.importForCourse('DSC 6400', [{ kind: 'text', text: fixture('canvas-modules.txt') }]);
    await service.importForCourse('DSC 6400', [{ kind: 'text', text: fixture('syllabus-policies.txt'), hints: { material: 'syllabus' } }]);
    await service.importForCourse('DSC 6400', [{ kind: 'text', text: 'Week 2 writing assignment update\nThe Week 2 writing assignment now needs four scholarly sources.', hints: { material: 'announcement' } }]);
    await approveAll(service);
    fireEvent.click(dock('Courses'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open DSC 6400' }));

    fireEvent.click(await screen.findByRole('button', { name: /^Announcements/ }));
    expect(await screen.findByRole('article', { name: 'Announcement: Week 2 writing assignment update' })).toBeInTheDocument();
    fireEvent.click(await menu('Syllabus'));
    expect(await screen.findByText('Late Work Policy')).toBeInTheDocument();
    fireEvent.click(await menu('Policies and rules'));
    expect(await screen.findByRole('article', { name: 'Policy: Use of Artificial Intelligence' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'AI use' }));
    expect(screen.queryByRole('article', { name: 'Policy: Grading Scale' })).not.toBeInTheDocument();

    fireEvent.click(await menu('Assignments'));
    fireEvent.click(await screen.findByRole('button', { name: 'Week 2: Writing Assignment' }));
    await screen.findByRole('heading', { name: 'Week 2: Writing Assignment' });
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getAllByRole('listitem').map((li) => li.textContent?.replace('›', '').trim())).toEqual(['Home', 'Courses', 'DSC 6400', 'Assignments', 'Week 2: Writing Assignment']);
    expect(await screen.findByText(/1 announcement mentions this assignment/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Course context/ }));
    expect(await screen.findByText('Writing Standards')).toBeInTheDocument();
    expect(screen.getByText('Week 2 writing assignment update')).toBeInTheDocument();
    expect(screen.getByText('Week 2: Lecture')).toBeInTheDocument();

    // Add instructions for this exact assignment from its page.
    fireEvent.click(screen.getByRole('tab', { name: /Instructions/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add instructions for this assignment' }));
    expect(await screen.findByLabelText('For which assignment?')).toHaveDisplayValue(/Week 2: Writing Assignment/);
  });

  it('turns on a local AI model, reads a pasted announcement and saves what to do on the assignment', async () => {
    const service = await setup('2026-09-02');
    await typedSemester(service);
    await service.importForCourse('DSC 6400', [{ kind: 'text', text: fixture('canvas-modules.txt') }]);
    await approveAll(service);

    fireEvent.click(top('Semester setup'));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Claude \(Anthropic API\)/ }));
    expect(screen.getByRole('button', { name: 'Save AI settings' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Claude \(Anthropic API\)/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Free local model/ }));
    expect(screen.getByRole('radio', { name: 'Qwen3 4B' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'About Qwen3 8B' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Set up' })[0]);
    expect(screen.getByText(/ollama pull qwen3:4b/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    expect((await screen.findAllByText('Qwen3 4B')).length).toBeGreaterThan(0);

    fireEvent.click(dock('Courses'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open DSC 6400' }));
    fireEvent.click(await menu('Add material'));
    fireEvent.click(await screen.findByRole('radio', { name: /Announcement/ }));
    fireEvent.change(screen.getByLabelText(/Paste announcement/), { target: { value: fixture('announcement-week2.txt') } });
    fireEvent.click(screen.getByRole('button', { name: 'Extract' }));
    expect(await screen.findByText(/AI note saved/)).toBeInTheDocument();
    expect(aiCalls.at(-1)).toMatchObject({ provider: 'ollama' });

    fireEvent.click(screen.getByRole('button', { name: 'See what to do →' }));
    expect(await screen.findByText(/Week 2 is about consent/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '✦ Analyze again' })).toBeInTheDocument();

    fireEvent.click(await menu('Assignments'));
    fireEvent.click(await screen.findByRole('button', { name: 'Week 2: Discussion Question 1' }));
    expect(await screen.findByText('Post your first answer to Discussion Question 1')).toBeInTheDocument();
    expect(screen.getByText('Reply to two classmates by Sunday')).toBeInTheDocument();
  });

  it('opens an assignment workspace with its checklist', async () => {
    const service = await setup('2026-09-02');
    await typedSemester(service);
    await service.importForCourse('DSC 6400', [{ kind: 'text', text: fixture('canvas-modules.txt') }]);
    await approveAll(service);
    fireEvent.click(dock('Courses'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open DSC 6400' }));
    fireEvent.click(await menu('Assignments'));
    fireEvent.click(await screen.findByRole('button', { name: 'Week 15: Final Research Paper' }));
    expect(await screen.findByRole('heading', { name: 'Requirements checklist' })).toBeInTheDocument();
    expect(screen.getByText(/Submit by Dec 14, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Not found in your material yet/)).toBeInTheDocument();
  });

  it("builds the title page in the student's format from setup and course details", async () => {
    const service = await setup('2026-09-02');
    await typedSemester(service);
    await service.saveStudent({ name: 'Alex Student' });
    await service.addCourse({ code: 'DSC 6400', name: 'Data Ethics', instructor: 'Dr. Ana Patel' });
    await service.importForCourse('DSC 6400', [{ kind: 'text', text: fixture('canvas-modules.txt') }]);
    await approveAll(service);
    fireEvent.click(dock('Courses'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open DSC 6400' }));
    fireEvent.click(await menu('Assignments'));
    fireEvent.click(await screen.findByRole('button', { name: 'Week 15: Final Research Paper' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Title page' }));
    const page = await screen.findByLabelText('Title page preview');
    expect(within(page).getByText('[Paper title]')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Paper title'), { target: { value: 'Consent in Data Collection' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }));
    const lines = async () => [...(await screen.findByLabelText('Title page preview')).querySelectorAll('.title-block p')].map((p) => p.textContent);
    await screen.findByText('Consent in Data Collection');
    expect(await lines()).toEqual(['Consent in Data Collection', 'Alex Student', 'Example University', 'DSC-6400: Data Ethics', 'Dr. Ana Patel', 'December 14, 2026']);
  });

  it('shows deadlines on a month and week calendar, coloured by course', async () => {
    const service = await setup('2026-09-02');
    await typedSemester(service);
    await service.importForCourse('DSC 6400', [{ kind: 'text', text: fixture('canvas-modules.txt') }]);
    await approveAll(service);
    fireEvent.click(dock('Calendar'));
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
    const sep6 = screen.getByRole('gridcell', { name: '2026-09-06: 2 items' });
    const pill = within(sep6).getByRole('button', { name: 'Week 1: Discussion Question 1' });
    expect(pill.style.getPropertyValue('--c')).toMatch(/^#[0-9a-f]{6}$/);
    fireEvent.click(sep6);
    expect(await screen.findByRole('heading', { name: 'Sep 6, 2026' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'December 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Final Exam' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: /^2026-12-15/ })).toHaveTextContent('Last day of the semester');

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getAllByRole('gridcell')).toHaveLength(7);
    // Hiding a course removes its items.
    fireEvent.click(screen.getByRole('button', { name: /DSC 6400/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(screen.queryByRole('button', { name: 'Week 1: Discussion Question 1' })).not.toBeInTheDocument();
  });

  it('marks work in progress and submitted, with undo and course progress', async () => {
    const service = await setup('2026-09-02');
    await typedSemester(service);
    await service.importForCourse('DSC 6400', [{ kind: 'text', text: fixture('canvas-modules.txt') }]);
    await approveAll(service);
    fireEvent.click(dock('Courses'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open DSC 6400' }));
    fireEvent.click(await menu('Assignments'));
    const status = await screen.findByRole('button', { name: 'Week 15: Final Research Paper: To do. Change status' });
    fireEvent.click(status);
    fireEvent.click(await screen.findByRole('button', { name: 'Week 15: Final Research Paper: In progress. Change status' }));
    expect(await screen.findByText('Marked “Week 15: Final Research Paper” as submitted')).toBeInTheDocument();
    expect(await screen.findByText(/46% of points submitted/)).toBeInTheDocument();
    const undos = screen.getAllByRole('button', { name: 'Undo' });
    fireEvent.click(undos[undos.length - 1]);
    expect(await screen.findByRole('button', { name: 'Week 15: Final Research Paper: In progress. Change status' })).toBeInTheDocument();
  });

  it('imports a PDF syllabus dropped into a course', async () => {
    const service = await setup('2026-09-02');
    await typedSemester(service);
    fireEvent.click(dock('Courses'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open DSC 6400' }));
    fireEvent.click(await menu('Add material'));
    const file = new File([fixtureBytes('syllabus.pdf')], 'syllabus.pdf', { type: 'application/pdf' });
    fireEvent.change(await screen.findByLabelText('Choose files for this course'), { target: { files: [file] } });
    expect(await screen.findByText(/Found \d+ items for DSC 6400/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Homework 1' })).toBeChecked();
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
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'schedule.png', { type: 'image/png' });
    fireEvent.change(await screen.findByLabelText('Choose files'), { target: { files: [file] } });
    expect(await screen.findByText(/schedule\.png/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Extract information' }));
    expect(await screen.findByText(/Import of png files is not available yet/)).toBeInTheDocument();
  });

  it('saves a calendar feed link in setup, syncs it, and hides the private part of the link', async () => {
    const service = await setup('2026-09-02');
    await typedSemester(service);
    fireEvent.click(top('Semester setup'));
    fireEvent.change(await screen.findByLabelText('Calendar feed link'), { target: { value: 'https://school.instructure.com/feeds/calendars/user_secret123abc.ics' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and sync' }));
    expect(await screen.findByText(/Calendar synced: \d+ new/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Review extracted information' })).toBeInTheDocument();
    fireEvent.click(top('Semester setup'));
    expect(await screen.findByText('school.instructure.com/…3abc.ics')).toBeInTheDocument();
    expect(screen.queryByText(/secret123/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeInTheDocument();
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
