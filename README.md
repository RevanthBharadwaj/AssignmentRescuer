# Assignment Rescue AI

A local first desktop app for students on macOS and Windows. Paste a syllabus, a Canvas page, an assignment prompt or a rubric, and Assignment Rescue turns it into a confirmed academic timeline where every deadline traces back to the exact line it came from. Nothing is saved until you approve it, and nothing leaves your computer.

Built with Tauri 2, React, TypeScript and SQLite. Builds and tests pass on macOS, Windows and Linux.

![Home screen](docs/screenshots/5-home.png)

> **Where the project stands:** milestone 1 of 12 is done (text input end to end, including Canvas pages), with semester setup and course pages in place. See [PROGRESS.md](PROGRESS.md) for the full status, what is verified, and what comes next.

---

## Contents

1. [What it does today](#what-it-does-today)
2. [Screenshots](#screenshots)
3. [Install and run](#install-and-run)
4. [Using the app](#using-the-app)
5. [Building installers](#building-installers)
6. [Testing](#testing)
7. [Project structure](#project-structure)
8. [Privacy and security](#privacy-and-security)
9. [Design](#design)
10. [Documentation](#documentation)

---

## What it does today

You set up your semester once (school, semester dates, courses). Then, for each course, you open it in Canvas, copy the Modules page, and paste it into the course in the app. The app separates graded work from readings, lectures and files, reads every due date and point value, and shows you one list to approve. After that, Home shows what is due this week across all your courses, each course has its own timeline, and every assignment opens into a workspace with a requirements checklist.

| Area | Status |
|---|---|
| Semester setup with real fields: your name, school, program, term, first and last day, courses; saved sections become read only with a Modify button | ✅ Available |
| Canvas course list (Courses → All Courses) pasted into setup: codes, names, sections and term | ✅ Available |
| Course home with Unit 1 to 7 blocks (state, graded count, points, next due) that open that unit's modules | ✅ Available |
| Chat tab (violet, in the bottom dock): paste anything copied from Canvas and it is sorted into the right course without duplicates; ask about an assignment with your own saved material; works with Ollama, OpenAI or Claude | ✅ Available |
| Real source lookup in Chat: search Crossref and OpenAlex or check a DOI, get an APA 7 reference and in text citation, save it with the assignment; the chat cites only saved sources | ✅ Available |
| Assignment Brief tab: what is required, scoring, resources to read (from the syllabus and your imports) and key dates | ✅ Available |
| Reminders: the day before and the day of, every day for 5 days before big assignments, plus the Wednesday first post for Saturday discussions; desktop notification and text through your own Twilio account while the app is open | ✅ Available |
| Course pages laid out like Canvas: breadcrumbs, and a course menu with Home, Announcements, Syllabus, Modules, Assignments, Policies and rules, Files and sources, Add material | ✅ Available |
| Each piece of material labelled by kind (syllabus, announcement, modules page, assignment instructions, rubric, course policies, reading), chosen when adding or inferred, and changeable later | ✅ Available |
| Assignment pages with Overview, Instructions, Rubric, Course context and Title page; the context gathers the syllabus rules that apply, announcements that mention the assignment and the unit's readings, each with its source | ✅ Available |
| Instructions or a rubric added for a specific assignment are attached to it | ✅ Available |
| Canvas Modules page pasted as text: items, due dates, points, units, readings, lectures, files, reminders | ✅ Available |
| PDF and Word (.docx) files: syllabi, schedules, assignment instructions, rubric tables; each item keeps its page | ✅ Available |
| Syllabus, assignment instructions, rubric, announcement pasted as text; TXT and Markdown files | ✅ Available |
| Calendar: month and week views, coloured by course, breaks and semester days marked, filter by course | ✅ Available |
| Canvas or Blackboard calendar feed: paste the link once, press Sync to pull new and changed deadlines with their due times; .ics files can also be dropped on a course | ✅ Available |
| Mark work to do, in progress or submitted (with undo), course progress by points, urgency labels (due today, tomorrow, overdue) | ✅ Available |
| Drag and drop files onto a course | ✅ Available |
| Review inside each course: approve many items at once, type a date for anything that has none | ✅ Available |
| Changed deadlines and disagreeing sources shown side by side, nothing overwritten silently | ✅ Available |
| Source tracing: every item keeps the exact lines it came from | ✅ Available |
| Home: due in the next 7 days, the week after, and items still needing a date | ✅ Available |
| Assignment workspace with a requirements checklist and a list of missing information | ✅ Available |
| Title page in your paper format (APA 7 student), filled from setup and the course | 🧪 Experimental, preview and copy |
| Next semester subject reminders (14 days before the semester ends, every 14 days until answered) | ✅ Available |
| Content classification and extraction for free text | 🧪 Experimental, rule based |
| Deadline reminders (7, 3, 1 and 0 days before) | 🧪 Experimental, shown while the app is open |
| Scanned PDFs and screenshots (OCR), CSV, Excel | ⏳ Not available yet (scans are detected and reported) |
| Announcements only update assignments you already have; pasting one never adds courses, semesters or module headings | ✅ Available |
| AI assistant (optional, off by default): reads an announcement or an assignment with its course context and saves what to do, linked to that assignment. Free local model through Ollama, or Claude with your own API key and consent | 🧪 Experimental |
| Notifications while closed, the specialised AI agents (research, writing, APA, originality, statistics) | ⏳ Not available yet |

The app's own **Features** screen shows the same list, read from the registry the tests check, so it never claims more than it can do.

## Screenshots

| | |
|---|---|
| **Course home** — breadcrumbs, course menu, what is coming up, latest announcements, which kinds of material you have added | **Modules** — week by week like Canvas: readings and lectures, then graded work |
| ![Course home](docs/screenshots/3-course-home.png) | ![Modules](docs/screenshots/4-course-modules.png) |
| **Assignment page** — status, checklist, and what the course says about it | **Course context** — the announcement and syllabus rules that apply, with sources |
| ![Assignment page](docs/screenshots/7-assignment-workspace.png) | ![Course context](docs/screenshots/11-assignment-context.png) |
| **Syllabus** — section by section, policies marked | **Review inside the course** — one checklist; items without a date get a date box |
| ![Syllabus](docs/screenshots/10-syllabus.png) | ![Review](docs/screenshots/2-review.png) |
| **Semester setup** — saved sections with Modify | **Courses** — one card per course with progress |
| ![Semester setup](docs/screenshots/1-setup.png) | ![Courses](docs/screenshots/6-courses.png) |
| **Title page** — your paper format, filled from setup and the course | **Calendar** — month view coloured by course, with status and breaks |
| ![Title page](docs/screenshots/8-title-page.png) | ![Calendar](docs/screenshots/9-calendar.png) |
| **AI note on an announcement** — what it asks you to do | **AI plan on an assignment** — steps and rules that are easy to miss |
| ![AI note](docs/screenshots/12-announcement-ai.png) | ![AI plan](docs/screenshots/13-assignment-ai-plan.png) |

All screenshots come from the real desktop build, captured automatically by the end to end test with synthetic course data.

## Install and run

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 or newer (22 recommended) | https://nodejs.org |
| Rust | stable | https://rustup.rs |
| Platform libraries | see below | Needed by Tauri |

**macOS:** install Xcode Command Line Tools.

```bash
xcode-select --install
```

**Windows:** install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload. WebView2 is already included in Windows 10 (1803+) and Windows 11.

**Linux (for development only):**

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev build-essential
```

Full details: https://v2.tauri.app/start/prerequisites/

### Get the code and run it

```bash
git clone https://github.com/RevanthBharadwaj/AssignmentRescuer.git
cd AssignmentRescuer
npm install
npm run tauri dev
```

The first run compiles the Rust side and takes a few minutes. After that the app opens in its own window and reloads as you edit the code.

### Quick look in a browser (no Rust needed)

```bash
npm install
npm run dev
```

Open http://localhost:1420. The browser preview uses the same app with an in-browser copy of SQLite (sql.js). Data is kept in that browser only.

## Using the app

1. **Set up your semester.** On first launch Home sends you to **Semester setup** (top bar). Enter your name, university and program, pick the term and year, and set the first and last day of the semester. For courses, open **Courses → All Courses** in Canvas, copy the list and paste it into **Paste your course list**: codes, names, sections and the term are read for you. Use **Modify** on a course to add its instructor. Saved sections turn read only; press **Modify** to change them.
2. **Fill each course.** Open **Courses** in the bottom bar and click a course. The course has a menu on the left like Canvas, with breadcrumbs at the top. Choose **Add material**, then say what you are adding: **Modules page**, **Syllabus**, **Announcement**, **Assignment instructions**, **Rubric**, **Course policies and rules** or **Reading**, or **Not sure**. For the Modules page, open it in Canvas, press **Cmd+A** (Windows: **Ctrl+A**) and **Cmd+C**, paste and click **Extract**. PDFs and Word files can be dropped onto the same card. For instructions or a rubric, pick which assignment they belong to.
2b. **Connect your calendar feed (optional).** In Canvas open **Calendar**, click **Calendar Feed** at the bottom right and copy the link. Paste it in **Semester setup → Calendar feed** and press **Save and sync**. New deadlines and due times appear under **Review**; items already saved are skipped. Press **Sync calendar feed** on the Calendar page whenever you want to update. The link is private: it stays on your computer and only shows as `school.instructure.com/…abcd.ics`.
3. **Approve.** Right below, everything found is listed in groups: graded work and deadlines, readings and files, reminders. Untick anything you don't want. Projects that the course page only mentions ("Project 2 is due next week") have a date box so you can type the date before approving. Click **Approve N selected**. Open **source** on any row to see the exact lines it came from.
4. **Use the course.** **Home** shows what is coming up and the latest announcements. **Announcements**, **Syllabus** (section by section, policies marked), **Modules** (week by week), **Assignments** (filter by discussions, writing, projects, quizzes) and **Policies and rules** each have their own page. **Files and sources** lists everything you added with its label; change a label if the app guessed wrong.
5. **Open an assignment.** Its page has **Overview** (status, checklist, what is missing), **Instructions**, **Rubric**, **Course context** (the syllabus rules that apply, announcements that mention it, and its unit's readings, each with where it came from) and, for papers, **Title page** in your format.
6. **Check Home and Calendar.** Home shows what is due in the next 7 days across all courses, the week after, and anything still waiting for a date. **Calendar** shows the month or week, coloured by course; click a day for its list, click an item to open it, and click a course in the legend to hide it.
7. **Track your work.** The round button next to each item cycles **to do → in progress → submitted**; a toast lets you undo. Each course shows how much of its points you've submitted, and items carry urgency labels such as *tomorrow* or *2 days overdue*.
7b. **Use the AI assistant (optional).** In **Semester setup → AI assistant** pick **Local model (Ollama)** (free, stays on your computer: install Ollama from ollama.com, then run `ollama pull llama3.1` once) or **Claude** (paste an API key from console.anthropic.com, which is kept in your system keychain, and tick the consent box). After that, an announcement you add is read straight away and its note appears under **Announcements** and on every assignment it mentions. On an assignment's Overview, **Make a plan with AI** reads the instructions, rubric, announcements and syllabus rules and saves a step by step plan. AI notes never change dates or items.
8. **Keep it current.** When an instructor changes a date, paste the updated page or announcement. The app shows the old and new date side by side under **Review** and only changes it if you approve.
9. **Next semester.** Fourteen days before the semester ends, Home asks which subjects you're taking next.

**Import a syllabus** (top bar) is for material that isn't tied to one course yet, such as a full program schedule. **Imported material** (bottom bar) lists everything you've pasted and lets you delete it.

## Building installers

```bash
npm run tauri build
```

| Platform | Output |
|---|---|
| macOS | `src-tauri/target/release/bundle/dmg/*.dmg` and `.../macos/*.app` |
| Windows | `src-tauri/target/release/bundle/msi/*.msi` and `.../nsis/*-setup.exe` |

Build each platform on that platform. The GitHub Actions workflow in `.github/workflows/ci.yml` builds both on every push to `main` and uploads the installers as workflow artifacts. Installers are not code signed yet, so macOS Gatekeeper and Windows SmartScreen will warn on first open.

## Testing

```bash
npm run check                                       # type check, lint, all tests, production build
cargo test --manifest-path src-tauri/Cargo.toml     # Rust database layer
```

| Suite | What it covers |
|---|---|
| Vitest (127 tests) | Date parsing, classification, Canvas module lists, PDF and Word extraction, format detection, security, extraction, import pipeline, merging, database repository, transactions, reminders, onboarding, checklist, and React screens (setup, course pages, review) against a real SQLite database |
| Rust (4 tests) | Atomic batches, typed results, parameter validation, calendar feed link validation |
| End to end | The real desktop build driven through WebDriver: first launch, semester setup, pasting a Canvas page into a course, approving, restart, data still there, assignment workspace |

Running the end to end test (Linux):

```bash
sudo apt install webkit2gtk-driver xvfb
cargo install tauri-driver --locked
npx tauri build --debug --no-bundle
tauri-driver &
SCREENSHOT_DIR=docs/screenshots xvfb-run -a node e2e/desktop.e2e.mjs src-tauri/target/debug/assignment-rescue-ai
```

See [docs/TESTING.md](docs/TESTING.md) for how the tests map to the specification.

## Project structure

```
src/
  core/                domain logic, no UI and no I/O
    input/             format detection and text extractors
    classify/          content classifier
    extract/           date parsing, entity extraction, Canvas module lists (canvas.ts)
    merge/             duplicate and conflict detection
    reminders/         next semester and deadline reminder scheduling
    assignments/       requirements checklist
    security/          untrusted input handling
    pipeline.ts        the import pipeline
    service.ts         application service used by the UI
    features.ts        what is implemented, experimental or unavailable
  db/                  SQLite schema, repository and drivers
  ui/                  React screens and styles
src-tauri/             desktop shell and the Rust SQLite layer
tests/                 unit, integration and UI tests with synthetic fixtures
e2e/                   WebDriver test of the real desktop build
docs/                  architecture, design, roadmap, testing, GitHub setup, screenshots
PROGRESS.md            where the project stands
```

## Privacy and security

Everything is stored in one SQLite file in your user app data folder. The app makes no AI calls unless you turn the AI assistant on, and then only when you add an announcement or press an AI button. With a local Ollama model the request goes to localhost only (other addresses are refused) and nothing leaves your computer. With Claude, the material you analyze is sent to Anthropic only after you tick the consent box, and your API key is stored in the macOS Keychain or Windows Credential Manager, never in the database. AI answers are checked before saving: they can only link to assignments you already have, and they cannot change any dates or records. The other network request is downloading your own calendar feed, and only when you press Sync; the feed link must be an https calendar link, downloads are capped at 5 MB and 20 seconds, and the link is never logged. Imported text is treated as data, never as instructions: hidden characters are stripped, and lines that look like attempts to instruct software (for example "ignore previous instructions") are flagged on the review screen. The desktop shell enables no HTTP, shell or file system plugins; the feed download is a single Rust command that accepts only calendar links. The `.gitignore` blocks databases and common document formats so student material can't be committed by accident; the only documents in this repository are synthetic test fixtures.

## Design

The interface uses a dark studio look: a near black canvas, a lime cream accent, large tightly tracked DM Sans headlines, small square label chips, numbered steps, oversized numbers, and a segmented bottom bar for the four main areas (Home, Courses, Review, Imported material). Fonts are bundled with the app so it works offline. Design tokens and rationale are in [docs/DESIGN.md](docs/DESIGN.md).

## Documentation

| File | Contents |
|---|---|
| [PROGRESS.md](PROGRESS.md) | Milestone status, verification, next steps |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Pipeline, data model, storage, matching, reminders, security |
| [docs/DESIGN.md](docs/DESIGN.md) | Visual language and design tokens |
| [docs/ROADMAP.md](docs/ROADMAP.md) | The 12 milestone plan and known limitations |
| [docs/TESTING.md](docs/TESTING.md) | Test suites and specification coverage |
| [docs/GITHUB_SETUP.md](docs/GITHUB_SETUP.md) | Pushing to a GitHub account |
| [docs/specs/universal-academic-input.md](docs/specs/universal-academic-input.md) | The feature specification |
| [docs/specs/paper-format.md](docs/specs/paper-format.md) | The paper format the writing and export tools must produce |
