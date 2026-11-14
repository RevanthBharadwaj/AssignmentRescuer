// End to end test of the real desktop build through tauri-driver (WebDriver).
// Usage: tauri-driver running on :4444, then
//   node e2e/desktop.e2e.mjs <path-to-app-binary>
// Verifies: boot, paste import, review approval through the Rust SQLite layer,
// and that confirmed data survives an app restart.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Optional: SCREENSHOT_DIR=/some/dir saves PNGs of key screens.
const SHOTS = process.env.SCREENSHOT_DIR;
async function shot(sid, name) {
  if (!SHOTS) return;
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
const click = async (sid, xp) => wd('POST', `/session/${sid}/element/${await find(sid, xp)}/click`, {});
const text = async (sid) => wd('POST', `/session/${sid}/execute/sync`, { script: 'return document.body.innerText', args: [] });

function isoIn(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d;
}
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const due = isoIn(6);
const dueText = `${MONTHS[due.getMonth()]} ${due.getDate()}, ${due.getFullYear()}`;
const PASTE = [
  'CIS 6930 Applied Machine Learning',
  `Homework 7 due ${dueText} at 11:59 PM ET (40 points)`,
  `Lab 4 due ${dueText} at 5:00 PM ET`,
].join('\n');

let sid = await session();
try {
  await find(sid, "//h1[normalize-space()='Your semester']", 20000);
  await click(sid, "//nav/button[contains(., 'Add information')]");
  await find(sid, "//textarea[@id='paste']");
  // Set the value the way React expects, then fire an input event.
  await wd('POST', `/session/${sid}/execute/sync`, {
    script: `const el = document.getElementById('paste'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, arguments[1]); el.dispatchEvent(new Event('input', { bubbles: true }));`,
    args: [null, PASTE],
  });
  await shot(sid, '1-add-information');
  await click(sid, "//button[normalize-space()='Extract information']");
  await click(sid, "//button[starts-with(normalize-space(), 'Review ')]");
  await find(sid, "//h1[normalize-space()='Review extracted information']");
  await shot(sid, '2-review');
  await click(sid, "//button[normalize-space()='Approve all new items with no warnings']");
  await find(sid, "//*[normalize-space()='Nothing waiting for review.']", 15000);
  await click(sid, "//nav/button[contains(., 'Home')]");
  await find(sid, "//*[normalize-space()='Homework 7']");
  await shot(sid, '3-home');
  const body1 = await text(sid);
  assert.match(body1, /Lab 4/);
  console.log('PASS import and approve through the desktop SQLite commands');
} catch (e) {
  console.error('PAGE TEXT:\n' + (await text(sid)));
  throw e;
} finally {
  await wd('DELETE', `/session/${sid}`);
}

await sleep(1500);
sid = await session();
try {
  await find(sid, "//*[normalize-space()='Homework 7']", 20000);
  await click(sid, "//nav/button[contains(., 'Courses')]");
  await find(sid, "//h2[contains(., 'CIS 6930')]");
  await click(sid, "//button[normalize-space()='Open']");
  const body = await text(sid);
  assert.match(body, /Requirements checklist/);
  await shot(sid, '4-assignment-workspace');
  console.log('PASS data persisted after restart');
} finally {
  await wd('DELETE', `/session/${sid}`);
}
