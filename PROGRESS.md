# Progress

Last updated: November 14, 2026 (announcements and the AI assistant)

## Summary

Milestone 1 of 12 is complete and verified on Linux. The app is now organised the way a student works: set up the semester once, add courses, then paste each course's Canvas Modules page (or a syllabus) into that course and approve what was found. The first test with a real Canvas page showed the old parser could not read it; that is fixed, and a real 56 item course page now imports with every date and point value and no false conflicts. macOS and Windows builds run in CI; the first macOS build was installed and opened.

```
Milestones   [##----------]  1 of 12 complete, 2 partly done
Spec input formats   plain text ✅  TXT ✅  Markdown ✅  manual ✅  PDF ⏳  DOCX ⏳  images ⏳  CSV ⏳  XLSX ⏳  ICS ⏳
```

## Milestones

| # | Milestone | Status | Notes |
|---|---|---|---|
| 1 | Plain text and manual entry | ✅ Done | Pipeline, provenance, review, merging, onboarding, reminders |
| 2 | PDF and DOCX | 🟡 Mostly done | PDF and DOCX work; DOC, RTF and OCR for scanned PDFs remain |
| 3 | Images and screenshots | ⏳ Not started | PNG, JPEG, WebP, HEIC; OCR and an optional vision model with consent |
| 4 | CSV and XLSX | 🟡 Partly | ICS files and calendar feeds done; CSV, XLSX and JSON remain |
| 5 | Content classification | 🟡 Partly | Rule based classifier works; needs an evaluation set and accuracy targets |
| 6 | Entity extraction | 🟡 Partly | Deterministic extractor and assignment context work; needs an evaluation set and an AI fallback |
| 7 | Student confirmation workflow | ✅ Done | Delivered with milestone 1 |
| 8 | Timeline merging | 🟡 Partly | Record level merging done; unified timeline view not started |
| 9 | Calendar integration | 🟡 Mostly done | Month and week views, course colours, filters; a dedicated daily agenda remains |
| 10 | Reminder integration | 🟡 Partly | Scheduling done; notifications while the app is closed not started |
| 11 | AI quality evaluation and agents | 🟡 Started | Optional AI briefing assistant (Ollama or Claude) works; the 12 specialised agents and an evaluation set remain |
| 12 | Cross platform packaging | 🟡 Partly | CI builds .dmg and .msi; code signing not set up |

## Done so far

**Announcements and the AI assistant (latest)**

1. A pasted announcement no longer turns into separate review items. It only updates assignments you already have (for example a moved due date); mentions of other weeks, modules, the course or the semester are ignored, and anything already saved is skipped without asking.
2. Optional AI assistant, off by default, set up in Semester setup step 05. A free local model through Ollama (localhost only) or Claude with your API key in the system keychain and explicit consent.
3. With the assistant on, an added announcement is read straight away and a note is saved with a summary, a checklist of what to do and the rules that are easy to miss, linked to the assignments it mentions. **Make a plan with AI** on an assignment reads its instructions, rubric, announcements and syllabus rules.
4. The material is fenced off as untrusted data in the prompt, the answer is checked before saving, and AI notes never change dates or records.
5. Tested with a stand-in model in unit and interface tests, and end to end through the real Rust command with a stand-in Ollama server.

**Calendar feed and calendar files**

1. Paste the Canvas (or Blackboard) calendar feed link once in Semester setup; **Sync** downloads it through a Rust command that accepts only https calendar links (5 MB and 20 second limits, link never logged). This is the app's only network request.
2. Calendar files and feeds are parsed directly: folded lines, escapes, all-day events, and UTC times converted to the student's own time zone (a Canvas 11:59 PM deadline stays 11:59 PM, not the next day).
3. Events are matched to courses from Canvas's bracketed course tag, by code or by course name. Canvas assignment events become assignments with their link; calendar events (exams, live sessions) become calendar items.
4. On sync, items that match saved ones exactly are skipped; items saved earlier without a time get their due time as a reviewable change; changed dates are shown old and new as always.
5. .ics files can also be dropped on a course, keeping only that course's events.
6. CI updated to the Node 24 versions of the GitHub actions (checkout, setup-node, upload-artifact v5).
7. 127 Vitest tests and 4 Rust tests; the desktop end to end test now also checks the feed download path reports an unreachable server clearly.

**CI results**

The macOS and Windows jobs passed on GitHub for the Canvas-style courses update and produced installers, so both platforms are verified.

**Canvas-style courses, material sorted by kind, assignment context (latest)**

1. Feedback: everything in a course sat in one box, so syllabus, announcements and assignments could not be told apart, and assignments did not draw on the rest of the course.
2. Every piece of material now has a kind: syllabus, announcement, modules page, assignment instructions, rubric, course policies and rules, or reading. The student picks it when adding (or chooses "Not sure" and the app infers it) and can change it under Files and sources.
3. Courses look and work like Canvas: breadcrumbs on every page (Home › Courses › BUS 610 › Assignments › Paper 1) and a course menu with Home, Announcements, Syllabus, Modules, Assignments, Policies and rules, Files and sources, and Add material.
4. The syllabus is split into its sections, and policy sections (late work, academic integrity, AI use, formatting, grading, participation, communication, accessibility, attendance, submission) are tagged and collected on the Policies page.
5. Each assignment page has Overview, Instructions, Rubric, Course context and Title page. Course context gathers the syllabus rules that apply to that kind of work (formatting and integrity first for papers, participation first for discussions), announcements that mention the assignment, and the readings and notes for its unit, each with its source and line.
6. Instructions or a rubric added for a chosen assignment are attached to that assignment instead of creating a new one.
7. 120 Vitest tests; the desktop end to end test adds a modules page, a syllabus, an announcement and a PDF as different kinds and checks the assignment's course context.

**PDF and Word import, calendar, status and a livelier interface (latest)**

1. Milestone 2 core: PDF (PDF.js, bundled, offline) and Word .docx import. PDF lines are rebuilt from text positions so a title and its date drawn separately stay together; every item records its page. Word tables become rows, so rubric tables work. Scanned PDFs are detected and reported instead of returning nothing; OCR is still planned.
2. Content imported before is now read again when added to a course, instead of being skipped as "already imported" (the likely cause of an empty course after re-pasting a Canvas page). The import result is a clear card with counts.
3. Items added to a course are reviewed in that course even when their text names another course; the row says where the item will be filed.
4. Calendar (milestone 9): month and week views, colours per course, today, breaks and first and last day marked, a legend to hide courses, a day panel, and click through to assignments.
5. Status and progress: to do, in progress, submitted on every graded item with an undo toast; course progress by points on course cards and pages; urgency labels; checklist ticks are saved with a progress bar.
6. Interaction and motion: count-up stats that link to their pages, staggered list entrances, page transitions, card hover lift, drag and drop onto a course, all respecting reduced motion.
7. Word counts written as "a 1,200-1,500 word paper" or "a 750-word reflection" are now read.
8. 112 Vitest tests; the desktop end to end test also drops a PDF into a course in the real app, resolves a semester date conflict and opens the calendar.

**Setup polish, course list import and title page (latest)**

1. Saved setup sections are shown read only, with values as text and an olive Modify button; Modify opens the fields again with Save and Cancel.
2. Setup asks for your name (used on title pages).
3. A Canvas course list (Courses → All Courses) pasted into setup adds every course with its code, name and section, and sets the semester name from the term if none is set. Each saved course has Modify (name, instructor) and remove.
4. The student's paper format was recorded from a submitted paper in `docs/specs/paper-format.md` (APA 7 student format: Times New Roman 12, double spaced, 1 inch margins, page number top right, title page order).
5. Paper-type assignments show a title page preview in that format, filled from setup, the course and the due date. Word export of full papers is part of the writing milestone.
6. 101 Vitest tests; the desktop end to end test now pastes a course list, modifies a course and builds a title page.

**Course centred app and Canvas import (latest)**

1. Feedback from the first real use: everything went through one generic page, there was no place for a course, and a pasted Canvas Modules page produced junk (titles and dates on separate lines were never paired, Canvas interface text was read as content, and "Unit 3: Lecture" was treated as the same item as "Unit 5: Lecture").
2. New Canvas module list parser: pairs each item with the due date and points on the following lines, ignores Canvas interface text, files readings, lectures, PDFs and forums as course materials by week, and turns projects mentioned only in reminders ("Project 2 is due next week") into undated items with a due note.
3. Matching fixes: numbers in titles must match in order, items from the same paste are never merged by similarity, the instructor pattern no longer grabs stray letters, and term codes like 2026FA resolve dates that have no year.
4. Semester setup with real fields (school, program, term, first and last day, courses), saved without review because the student typed them.
5. Course pages with Timeline, Assignments, Readings and materials, and Add material tabs. Review happens inside the course as one checklist with bulk approve and a date box for undated items.
6. Home is now a this week dashboard: due in the next 7 days, the week after, and items still needing a date.
7. Tests: 95 Vitest tests (new Canvas fixture and UI flows), 3 Rust tests, and the desktop end to end test now covers setup and a Canvas paste into a course.

**Milestone 1, universal input for text (commit `507f646`)**

1. Import pipeline: format detection by file signature, text and Markdown extraction, cleaning of hidden characters, prompt injection flagging, duplicate upload detection by content hash.
2. Classification into 16 content types, several per input.
3. Extraction of university, program, semester dates and breaks, courses and instructors, assignments with points, word and page counts, scholarly source counts, citation style and submission rules, discussion and peer reply deadlines, readings, exams, milestones, weekly modules, rubric criteria with performance levels, and DOIs.
4. Provenance on every record: source, file name, import time, line, character span, excerpt, method, verification and confirmation status.
5. Review: create, update, duplicate and conflict proposals, old and new values side by side, per field choice, change log, manual corrections, source deletion.
6. Semester onboarding answered from imports or typing, resumable.
7. Deterministic reminders for next semester subjects and deadlines.
8. Assignment workspace with a requirements checklist and missing information questions.
9. Desktop storage on a single SQLite connection with real transactions. The first version used the Tauri SQL plugin; the end to end test showed its connection pool locking the database, so it was replaced.

**Interface redesign**

The interface was rebuilt in a dark studio style: near black background, lime cream accent, large DM Sans headlines, label chips, numbered onboarding steps, oversized stats, and a bottom bar for the four workflow stages. Fonts are bundled locally. See `docs/DESIGN.md`.

## Verification

| Check | Linux | macOS | Windows |
|---|---|---|---|
| Type check, lint | ✅ | ✅ | ✅ |
| 137 Vitest tests | ✅ | ✅ | ✅ |
| Rust tests | ✅ | ✅ | ✅ |
| Production frontend build | ✅ | ✅ | ✅ |
| Desktop app compiles and launches | ✅ | ✅ | ✅ (compiles; not launched in CI) |
| End to end: import, approve, restart, data kept | ✅ | not supported by tauri-driver | not set up yet |
| Installer build | not targeted | ✅ .dmg; opens after clearing the quarantine flag | ✅ .msi and .exe built; not yet installed by a person |

"Runs in CI" means the workflow is written but has not reported a result yet. macOS and Windows support should be called verified only after the Actions run on GitHub passes.

## Known limitations

1. Extraction is rule based. Canvas Modules pages, common syllabi and assignment instructions work; other LMS layouts (Blackboard, Moodle, D2L) and Canvas's Assignments or Syllabus pages have not been tested with real samples yet.
2. A date without a year resolves only once a semester is known.
3. Numeric dates are read as month/day (US order).
4. Week context carries forward until the next week heading.
5. Research sources are recognised by DOI only and stay unverified until the research milestone adds lookups.
6. Reminders appear only while the app is open.
7. Installers are not code signed, so macOS reports the app as damaged until `xattr -cr` clears the download flag.
8. Canvas shows due dates without a time, so items imported from a Modules page have no due time.

## Next steps

1. Try the Canvas Assignments and Syllabus pages and one more course with real samples, and fix what they reveal.
2. Try the real Canvas calendar feed and report anything it gets wrong.
2b. Try the AI assistant with a real local model and with Claude on real announcements, and keep the checklist ticks between visits.
3. Finish milestone 2: OCR for scanned PDFs together with screenshots (milestone 3).
4. Add the names and roles of the 12 specialised agents from the original specification to `docs/ROADMAP.md`.
5. Set up code signing for macOS and Windows installers (ad hoc signing first, Apple notarisation once there is a developer account).
