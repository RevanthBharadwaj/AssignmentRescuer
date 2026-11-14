/** Words for the first run tour and the page hints. Plain text only. */

export interface TourStep { id: string; title: string; body: string; route: { name: string; tab?: string } ; action: string }

export const TOUR: TourStep[] = [
  { id: 'setup', title: 'Set up your semester once', body: 'Add your name, school, the semester dates and your courses. Paste your Canvas course list and the app reads the codes and names for you.', route: { name: 'setup' }, action: 'Open Semester setup' },
  { id: 'ai', title: 'Turn on the free AI assistant', body: 'Pick a free model that runs on your computer (nothing is uploaded) or add an OpenAI or Claude key. The app uses a different model for everyday questions, assignments, images and search, and always tells you which one answered.', route: { name: 'setup' }, action: 'Choose your AI' },
  { id: 'paste', title: 'Give each course its material', body: 'Open a course, choose Add material, and paste what you copied from Canvas (select all, copy). Syllabus, Modules, announcements, PDFs and Word files all work. The app sorts each one into the right place and never saves the same thing twice.', route: { name: 'courses' }, action: 'Open Courses' },
  { id: 'review', title: 'Approve what it found', body: 'Nothing is saved until you approve it. Review shows every date and point value it read, with where it came from, so you can fix a mistake before it matters.', route: { name: 'review' }, action: 'Open Review' },
  { id: 'chat', title: 'Ask the chat about anything', body: 'Choose a course and an assignment, then ask what is required, how it is scored and what to read. Paste more material or attach a file or screenshot at any time. It can also write the assignment as a Word document from your own notes.', route: { name: 'chat' }, action: 'Open Chat' },
  { id: 'calendar', title: 'Watch the calendar and reminders', body: 'The calendar shows due dates and the first discussion post that is due before the Saturday deadline. Turn on reminders in Semester setup to get a desktop notice or an email the day before, the day of, and every day for five days before big assignments.', route: { name: 'calendar' }, action: 'Open Calendar' },
];

export const HINTS: Record<string, { title: string; text: string }> = {
  home: { title: 'Start here', text: 'This page shows what is due this week across all your courses. If it is empty, open Semester setup, add your courses, then paste a course\'s Modules page into it.' },
  setup: { title: 'Do these in order', text: 'School and semester first, then courses, then the AI assistant, then reminders. Each saved section turns into a summary with a Modify button.' },
  courses: { title: 'One page per course', text: 'Open a course to see its units, syllabus, announcements, assignments and rules. The unit blocks on a course home open that unit\'s modules.' },
  review: { title: 'You are in control', text: 'Items wait here until you approve them. Use Approve all when the list looks right, or open an item to see exactly which line it came from.' },
  calendar: { title: 'Reading the calendar', text: 'Assignments show on their due date. A discussion with a Saturday deadline also shows its first post, due earlier in the week, so you do not miss it.' },
  chat: { title: 'Three things to try', text: 'Paste an announcement and I will tell you what it asks. Pick an assignment and ask what to read first. Attach a PDF or a screenshot and I will file it in the course. The line under each answer names the model that wrote it.' },
  sources: { title: 'Everything you imported', text: 'Every file and paste lives here, labelled by what the app decided it was. You can delete any of it. Nothing leaves your computer unless you turn on a cloud AI.' },
  add: { title: 'Pasting works best', text: 'In Canvas, open the page, press Cmd+A (Ctrl+A on Windows), then Cmd+C, and paste here. The app decides whether it is a syllabus, modules, an announcement or an assignment.' },
  syllabus: { title: 'How the syllabus is organized', text: 'The app groups it into overview, grading, books and readings, units and assignments, and rules. Use the pills at the top to jump between groups.' },
  modules: { title: 'Modules, week by week', text: 'Readings and lectures come first, then graded work. Click an assignment to open its workspace and brief.' },
  announcements: { title: 'Announcements', text: 'Newest first. When the AI is on, "See what to do" lists the tasks an announcement asks for and links them to the right assignment.' },
  assignments: { title: 'Assignments', text: 'Sorted by due date. Open one to see its requirements, scoring, resources and a brief, or send it to Chat.' },
};
