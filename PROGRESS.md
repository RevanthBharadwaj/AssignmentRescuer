# Progress

Last updated: November 14, 2026

## Summary

Milestone 1 of 12 is complete and verified on Linux. The app imports plain text, TXT and Markdown files and manual entries, extracts academic information, asks the student to confirm it, and keeps a traceable timeline. The interface was redesigned in a dark studio style. macOS and Windows builds are set up in CI but have not been confirmed yet.

```
Milestones   [##----------]  1 of 12 complete, 2 partly done
Spec input formats   plain text ✅  TXT ✅  Markdown ✅  manual ✅  PDF ⏳  DOCX ⏳  images ⏳  CSV ⏳  XLSX ⏳  ICS ⏳
```

## Milestones

| # | Milestone | Status | Notes |
|---|---|---|---|
| 1 | Plain text and manual entry | ✅ Done | Pipeline, provenance, review, merging, onboarding, reminders |
| 2 | PDF and DOCX | ⏳ Next | Includes DOC and RTF where supported, OCR for scanned PDFs |
| 3 | Images and screenshots | ⏳ Not started | PNG, JPEG, WebP, HEIC; OCR and an optional vision model with consent |
| 4 | CSV and XLSX | ⏳ Not started | Also JSON and ICS calendar files |
| 5 | Content classification | 🟡 Partly | Rule based classifier works; needs an evaluation set and accuracy targets |
| 6 | Entity extraction | 🟡 Partly | Deterministic extractor works; needs an evaluation set and an AI fallback |
| 7 | Student confirmation workflow | ✅ Done | Delivered with milestone 1 |
| 8 | Timeline merging | 🟡 Partly | Record level merging done; unified timeline view not started |
| 9 | Calendar integration | ⏳ Not started | Semester, monthly, weekly, daily and course views |
| 10 | Reminder integration | 🟡 Partly | Scheduling done; notifications while the app is closed not started |
| 11 | AI quality evaluation and agents | ⏳ Not started | The 12 specialised agents come in here |
| 12 | Cross platform packaging | 🟡 Partly | CI builds .dmg and .msi; code signing not set up |

## Done so far

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
| Type check, lint | ✅ | runs in CI | runs in CI |
| 82 Vitest tests | ✅ | runs in CI | runs in CI |
| 3 Rust tests | ✅ | runs in CI | runs in CI |
| Production frontend build | ✅ | runs in CI | runs in CI |
| Desktop app compiles and launches | ✅ | runs in CI | runs in CI |
| End to end: import, approve, restart, data kept | ✅ | not supported by tauri-driver | not set up yet |
| Installer build | not targeted | runs in CI (.dmg) | runs in CI (.msi, .exe) |

"Runs in CI" means the workflow is written but has not reported a result yet. macOS and Windows support should be called verified only after the Actions run on GitHub passes.

## Known limitations

1. Extraction is rule based. Common syllabus, Canvas and assignment layouts work; unusual layouts can miss items, which can be added by hand.
2. A date without a year resolves only once a semester is known.
3. Numeric dates are read as month/day (US order).
4. Week context carries forward until the next week heading.
5. Research sources are recognised by DOI only and stay unverified until the research milestone adds lookups.
6. Reminders appear only while the app is open.
7. Installers are not code signed.

## Next steps

1. Confirm the CI run passes on macOS and Windows.
2. Milestone 2: PDF and DOCX import, with page level provenance and OCR for scanned PDFs.
3. Add the names and roles of the 12 specialised agents from the original specification to `docs/ROADMAP.md`.
4. Set up code signing for macOS and Windows installers.
