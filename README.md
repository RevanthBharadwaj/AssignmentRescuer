# Assignment Rescue AI

A local first desktop app for students on macOS and Windows. It takes academic information in whatever form the student already has it, turns it into a confirmed academic timeline with every item traceable to its source, and builds toward research, writing and APA support on top of that.

Built with Tauri 2, React, TypeScript and SQLite. Everything is stored on the student's computer. This build makes no network calls and no AI calls.

## Status

This is milestone 1 of the universal academic input system: plain text and manual entry, end to end. The in-app Features page shows exactly what is implemented, experimental and unavailable, and it reads from the same registry (`src/core/features.ts`) that the tests check.

| Area | Status |
|---|---|
| Paste text, TXT and Markdown files, manual entry, multiple inputs per import | Implemented |
| Format detection by file signature, with honest errors for unsupported, corrupt and empty inputs | Implemented |
| Content classification (16 labels, multi label) | Experimental, rule based |
| Extraction of university, program, semester, breaks, courses, instructors, assignments, discussion and peer reply deadlines, readings, exams, milestones, modules, rubric criteria and DOIs | Experimental, deterministic |
| Source provenance on every record (source, line, character span, excerpt, method, verification and confirmation status) | Implemented |
| Duplicate and conflict detection, student review, old and new values side by side, nothing saved without approval | Implemented |
| Semester onboarding (resumable, answered from imports or typing) | Implemented |
| Next semester subject reminders (14 days before end, repeats every 14 days, breaks, snoozes, skips, date changes) | Implemented |
| Deadline reminder schedule (7, 3, 1, 0 days, customizable) | Experimental, shown in app while open |
| Assignment workspace with requirements checklist and missing information | Implemented (deterministic part) |
| PDF, DOCX, DOC, RTF, images and OCR, CSV, XLSX, JSON, ICS | Not available yet (milestones 2 to 4) |
| Calendar views, closed app notifications, AI agents, research, writing, APA, originality, statistics | Not available yet |

## Getting started

Requirements: Node 20 or newer, Rust stable, and the Tauri prerequisites for your OS (https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev        # desktop app with hot reload
npm run dev              # browser preview at http://localhost:1420 (sql.js, data kept in this browser)
npm run tauri build      # installers: .dmg/.app on macOS, .msi/.exe on Windows
```

## Checks

```bash
npm run check            # typecheck, lint, unit and UI tests, production build
cargo test --manifest-path src-tauri/Cargo.toml
```

Desktop end to end (Linux, needs `tauri-driver`, `webkit2gtk-driver`, `xvfb`):

```bash
npx tauri build --debug --no-bundle
tauri-driver & xvfb-run -a node e2e/desktop.e2e.mjs src-tauri/target/debug/assignment-rescue-ai
```

See `docs/TESTING.md` for what each suite covers and what has not been verified yet.

## Project layout

```
src/core/            domain logic, no UI and no I/O (fully unit tested)
  input/             format detection and text extractors
  classify/          content classifier
  extract/           date parsing and entity extraction
  merge/             duplicate and conflict detection, applying approvals
  reminders/         next semester and deadline reminder scheduling
  assignments/       requirements checklist
  security/          untrusted input handling
  pipeline.ts        the unified import pipeline
  service.ts         application service used by the UI
src/db/              SQLite schema, repository and drivers
src/ui/              React screens
src-tauri/           desktop shell and the Rust SQLite layer
tests/               Vitest unit, integration and UI tests with synthetic fixtures
e2e/                 WebDriver test of the real desktop build
docs/                architecture, roadmap, testing, GitHub setup
```

## Privacy

Imported material stays in a SQLite file in the user's app data folder. Imported text is treated as untrusted data: it is sanitised, scanned for prompt injection patterns, and never interpreted as instructions. Students can delete any imported source, which also removes records that came only from it. The `.gitignore` blocks databases and academic document formats so student material cannot be committed by accident; the only documents in this repository are synthetic test fixtures.
