// End to end test of the real desktop build through tauri-driver (WebDriver).
// Usage: tauri-driver running on :4444, then
//   node e2e/desktop.e2e.mjs <path-to-app-binary>
// Verifies: boot, paste import, review approval through the Rust SQLite layer,
// and that confirmed data survives an app restart.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Optional: SCREENSHOT_DIR=/some/dir saves PNGs of key screens.
const SHOTS = process.env.SCREENSHOT_DIR;
async function shot(sid, name) {
  if (!SHOTS) return;
  await new Promise((r) => setTimeout(r, 900)); // let entrance animations finish
  const b64 = await wd('GET', `/session/${sid}/screenshot`);
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'));
}

const APP = process.argv[2];
const WD = 'http://127.0.0.1:4444';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wd(method, path, body) {
  const res = await fetch(WD + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (json.value && json.value.error) throw new Error(`${path}: ${json.value.error} ${json.value.message}`);
  return json.value;
}
const ELEM = 'element-6066-11e4-a52e-4f735466cecb';

async function session() {
  const v = await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP } } } });
  return v.sessionId;
}
async function find(sid, xpath, timeout = 10000) {
  const end = Date.now() + timeout;
  for (;;) {
    try { const v = await wd('POST', `/session/${sid}/element`, { using: 'xpath', value: xpath }); return v[ELEM] ?? Object.values(v)[0]; }
    catch (e) { if (Date.now() > end) throw e; await sleep(250); }
  }
}
// Centre the element first so the fixed bottom dock never covers it.
const click = async (sid, xp) => {
  const id = await find(sid, xp);
  await wd('POST', `/session/${sid}/execute/sync`, {
    script: "const r = document.evaluate(arguments[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; if (r) r.scrollIntoView({ block: 'center' });",
    args: [xp],
  });
  return wd('POST', `/session/${sid}/element/${id}/click`, {});
};
const text = async (sid) => wd('POST', `/session/${sid}/execute/sync`, { script: 'return document.body.innerText', args: [] });

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const at = (days) => new Date(Date.now() + days * 86400000);
const short = (days) => { const d = at(days); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const isoDay = (days) => at(days).toISOString().slice(0, 10);
const year = at(-60).getFullYear();
const season = ['Spring', 'Spring', 'Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Fall', 'Fall', 'Fall', 'Fall', 'Fall'][at(-60).getMonth()];

// Synthetic Canvas "Modules" page with dates relative to today.
const item = (type, title, days, pts) => [type, title, ...(days === null ? [] : [short(days)]), ...(pts === null ? [] : [`${pts} pts`]), 'ViewMust view in order to complete this module item'];
const PASTE = [
  ' COURSE RESOURCES', 'Attachment', 'Course Handbook.pdf', 'Discussion Topic', 'Ask the Instructor',
  'WEEK 11', ' WEEK 11', 'Complete All Items', 'Module Completed', 'Context Module Sub Header',
  'READING ASSIGNMENT', ...item('Page', 'Week 11: Readings', null, null), ...item('Attachment', 'Algorithmic Fairness in Practice.pdf', null, null),
  'Context Module Sub Header', 'LECTURE', ...item('Page', 'Week 11: Lecture', null, null),
  'Context Module Sub Header', 'DISCUSSION QUESTIONS', ...item('Discussion Topic', 'Week 11: Discussion Question 1', 2, 20), ...item('Discussion Topic', 'Week 11: Discussion Question 2', 2, 20),
  'Context Module Sub Header', 'WRITING ASSIGNMENT', ...item('Assignment', 'Week 11: Writing Assignment', 4, 150),
  'Reminder: Project 3: Privacy Impact Assessment is due next week.',
  'WEEK 12', ' WEEK 12', 'Complete All Items', 'Module In Progress', 'Context Module Sub Header',
  'READING ASSIGNMENT', ...item('Page', 'Week 12: Readings', null, null), ...item('Attachment', 'Consent and Data Collection.pdf', null, null),
  'Context Module Sub Header', 'LECTURE', ...item('Page', 'Week 12: Lecture', null, null),
  'Context Module Sub Header', 'DISCUSSION QUESTIONS', ...item('Discussion Topic', 'Week 12: Discussion Question', 9, 20),
  'Context Module Sub Header', 'WRITING ASSIGNMENT', ...item('Assignment', 'Week 12: Writing Assignment', 11, 150),
  'FINAL WEEK', ' FINAL WEEK', 'Complete All Items', 'Module Locked',
  ...item('Quiz', 'Final Exam', 18, 200), ...item('Assignment', 'Week 15: Final Research Paper', 23, 330),
].join('\n');

/** Set a form field found by its label text, the way React expects. */
async function fill(sid, labelText, value) {
  await wd('POST', `/session/${sid}/execute/sync`, {
    script: `
      const label = [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(arguments[0]));
      const el = label && (label.control || label.querySelector('input,select,textarea'));
      if (!el) throw new Error('no field ' + arguments[0]);
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, arguments[1]);
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));`,
    args: [labelText, value],
  });
}

let sid = await session();
try {
  await find(sid, "//h1[normalize-space()='Your semester']", 20000);
  await sleep(800);
  await shot(sid, '0-home-first-launch');

  // Semester setup with real fields.
  await click(sid, "//nav[@aria-label='Main']/button[normalize-space()='Semester setup']");
  await find(sid, "//h2[normalize-space()='Courses this semester']");
  await fill(sid, 'Your name (for title pages)', 'Alex Student');
  await fill(sid, 'University', 'Example State University');
  await fill(sid, 'Degree or program', 'MS in Data Science');
  await click(sid, "//button[normalize-space()='Save school']");
  await find(sid, "//*[normalize-space()='✓ School saved']");
  await fill(sid, 'Term', season);
  await fill(sid, 'Year', String(year));
  await fill(sid, 'First day', isoDay(-75));
  await fill(sid, 'Last day', isoDay(30));
  await click(sid, "//button[normalize-space()='Save semester']");
  await find(sid, "//*[normalize-space()='✓ Semester saved']");
  // Paste a Canvas "All Courses" list.
  await wd('POST', `/session/${sid}/execute/sync`, {
    script: `const el = document.querySelector('textarea[aria-label="Course list"]');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, arguments[0]);
      el.dispatchEvent(new Event('input', { bubbles: true }));`,
    args: [[
      `* [${year}FA Data Ethics (DSC-6400-7AB12)](https://school.instructure.com/courses/111)`,
      `${year}FA Data Ethics (DSC-6400-7AB12)`, `Term: ${year} Fall`,
      `* [${year}FA Statistical Methods (STA-6166-SY01)](https://school.instructure.com/courses/222)`,
      `${year}FA Statistical Methods (STA-6166-SY01)`, `Term: ${year} Fall`,
    ].join('\n')],
  });
  await click(sid, "//button[normalize-space()='Add 2 courses']");
  await find(sid, "//*[normalize-space()='✓ 2 courses added']");
  await click(sid, "//button[@aria-label='Modify DSC 6400']");
  await fill(sid, 'Instructor', 'Dr. Ana Patel');
  await click(sid, "//li[contains(@class,'editing')]//button[normalize-space()='Save']");
  await find(sid, "//*[normalize-space()='✓ DSC 6400 updated']");
  await wd('POST', `/session/${sid}/execute/sync`, { script: 'window.scrollTo(0, 0)', args: [] });
  await sleep(300);
  await shot(sid, '1-setup');

  // Inside a course: Canvas-style menu, and each kind of material added as what it is.
  const menu = (label) => click(sid, `//nav[contains(@aria-label,'course menu')]/button[starts-with(normalize-space(), '${label}')]`);
  const kind = (label) => click(sid, `//label[contains(@class,'kind-option')][.//span[normalize-space()='${label}']]`);
  const approveAll = async () => {
    // Close any toasts first: they sit over the bottom right of the window.
    await wd('POST', `/session/${sid}/execute/sync`, { script: "document.querySelectorAll('.toast button[aria-label=\"Dismiss\"]').forEach((b) => b.click())", args: [] });
    await sleep(200);
    await click(sid, "//button[starts-with(normalize-space(), 'Approve ') and contains(., 'selected')]");
    await find(sid, "//button[normalize-space()='Approve 0 selected'] | //*[starts-with(normalize-space(), 'Nothing waiting for')] | //article[contains(@class,'proposal')]", 15000);
    await sleep(800);
    // Anything that changes a saved value (for example semester dates) keeps the saved value here.
    for (let i = 0; i < 5; i++) {
      const n = await wd('POST', `/session/${sid}/execute/sync`, { script: "return document.querySelectorAll('article.proposal').length", args: [] });
      if (!n) break;
      await click(sid, "(//article[contains(@class,'proposal')]//button[normalize-space()='Reject'])[1]");
      await sleep(300);
    }
    await find(sid, "//*[normalize-space()='Nothing waiting for DSC 6400.']", 15000);
  };

  await click(sid, "//nav[@aria-label='Workflow']/button[contains(., 'Courses')]");
  await click(sid, "//button[@aria-label='Open DSC 6400']");
  await menu('Add material');
  await kind('Modules page');
  await fill(sid, 'Paste modules page for DSC 6400', PASTE);
  await click(sid, "//button[normalize-space()='Extract' and not(@disabled)]");
  await find(sid, "//h3[contains(., 'Graded work and deadlines')]");
  await wd('POST', `/session/${sid}/execute/sync`, { script: "[...document.querySelectorAll('h2')].find((h) => h.textContent.includes('Waiting for your review')).scrollIntoView({ block: 'start' }); window.scrollBy(0, -70);", args: [] });
  await shot(sid, '2-review');
  await approveAll();

  // The syllabus, with its policies.
  await kind('Syllabus');
  await fill(sid, 'Paste syllabus for DSC 6400', readFileSync(new URL('../tests/fixtures/syllabus-policies.txt', import.meta.url), 'utf8'));
  await click(sid, "//button[normalize-space()='Extract' and not(@disabled)]");
  await find(sid, "//div[contains(@class,'import-result')]//*[contains(., 'Syllabus (DSC 6400)')]");
  if (await wd('POST', `/session/${sid}/execute/sync`, { script: "return document.querySelectorAll('.review-table input:checked').length", args: [] })) await approveAll();

  // An announcement that mentions an assignment.
  await kind('Announcement');
  await fill(sid, 'Paste announcement for DSC 6400', 'Week 11 writing assignment update\nHi everyone, the Week 11 writing assignment now needs four scholarly sources instead of three.');
  await click(sid, "//button[normalize-space()='Extract' and not(@disabled)]");
  await find(sid, "//div[contains(@class,'import-result')]//*[contains(., 'Announcement (DSC 6400)')]");

  await menu('Home');
  await find(sid, "//h2[normalize-space()='Coming up']");
  await shot(sid, '3-course-home');
  await menu('Modules');
  await find(sid, "//*[normalize-space()='Algorithmic Fairness in Practice.pdf']");
  await shot(sid, '4-course-modules');
  await menu('Syllabus');
  await find(sid, "//span[normalize-space()='Late Work Policy']");
  await shot(sid, '10-syllabus');

  // Mark an item submitted from the course home.
  await menu('Home');
  await click(sid, "//button[@aria-label='Week 11: Discussion Question 1: To do. Change status']");
  await click(sid, "//button[@aria-label='Week 11: Discussion Question 1: In progress. Change status']");
  await find(sid, "//*[contains(., 'as submitted')]");

  // Drop a PDF syllabus (PDF.js runs in the app's worker).
  await menu('Add material');
  await kind('Syllabus');
  const pdf = readFileSync(new URL('../tests/fixtures/syllabus.pdf', import.meta.url)).toString('base64');
  await wd('POST', `/session/${sid}/execute/sync`, {
    script: `const bytes = Uint8Array.from(atob(arguments[0]), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'syllabus.pdf', { type: 'application/pdf' }));
      const input = document.querySelector('input[aria-label="Choose files for this course"]');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));`,
    args: [pdf],
  });
  await find(sid, "//strong[starts-with(normalize-space(), 'Found ') and contains(., 'for DSC 6400')]", 20000);
  await approveAll();

  await click(sid, "//nav[@aria-label='Workflow']/button[contains(., 'Calendar')]");
  await find(sid, "//div[@role='grid']");
  await shot(sid, '9-calendar');

  // Calendar feed: the Rust download command answers with a readable error
  // when the server cannot be reached (this sandbox has no internet).
  await click(sid, "//nav[@aria-label='Main']/button[normalize-space()='Semester setup']");
  await find(sid, "//input[@type='url']", 15000);
  await fill(sid, 'Calendar feed link', 'https://calendar.invalid/feeds/calendars/user_test.ics');
  await click(sid, "//button[normalize-space()='Save and sync']");
  await find(sid, "//*[@role='alert' and (contains(., 'Could not reach the calendar server') or contains(., 'calendar server answered'))]", 30000);
  await find(sid, "//dd[normalize-space()='calendar.invalid/…user_test.ics' or contains(., '…')]");
  console.log('PASS setup, course import and approval through the desktop SQLite commands');
} catch (e) {
  console.error('PAGE TEXT:\n' + (await text(sid)));
  throw e;
} finally {
  await wd('DELETE', `/session/${sid}`);
}

await sleep(1500);
sid = await session();
try {
  await find(sid, "//button[normalize-space()='Week 11: Discussion Question 1']", 20000);
  await sleep(800);
  await shot(sid, '5-home');
  await click(sid, "//nav[@aria-label='Workflow']/button[contains(., 'Courses')]");
  await find(sid, "//button[@aria-label='Open DSC 6400']");
  await shot(sid, '6-courses');
  await click(sid, "//button[@aria-label='Open DSC 6400']");
  const menu2 = (label) => click(sid, `//nav[contains(@aria-label,'course menu')]/button[starts-with(normalize-space(), '${label}')]`);
  await menu2('Assignments');
  await click(sid, "//button[normalize-space()='Week 11: Writing Assignment']");
  await find(sid, "//h2[normalize-space()='Requirements checklist']");
  await find(sid, "//*[contains(., 'announcement mentions this assignment')]");
  await shot(sid, '7-assignment-workspace');
  await click(sid, "//button[@role='tab'][starts-with(normalize-space(), 'Course context')]");
  await find(sid, "//strong[normalize-space()='Writing Standards']");
  await shot(sid, '11-assignment-context');

  await menu2('Assignments');
  await click(sid, "//button[normalize-space()='Week 15: Final Research Paper']");
  await click(sid, "//button[@role='tab'][normalize-space()='Title page']");
  await find(sid, "//div[@aria-label='Title page preview']");
  await fill(sid, 'Paper title', 'Consent and Fairness in Data Collection');
  await click(sid, "//button[normalize-space()='Save title']");
  await find(sid, "//p[normalize-space()='Consent and Fairness in Data Collection']");
  await wd('POST', `/session/${sid}/execute/sync`, { script: "document.querySelector('.paper').scrollIntoView({ block: 'center' })", args: [] });
  await shot(sid, '8-title-page');
  const body = await text(sid);
  assert.match(body, /Final Research Paper/);
  console.log('PASS data persisted after restart');
} catch (e) {
  console.error('PAGE TEXT:\n' + (await text(sid)));
  throw e;
} finally {
  await wd('DELETE', `/session/${sid}`);
}
