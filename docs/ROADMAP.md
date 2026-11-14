# Roadmap

The universal input system follows the sequence from the feature specification. A milestone is complete only when its acceptance criteria are verified by automated tests, lint, type checks and builds.

| # | Milestone | Status |
|---|---|---|
| 1 | Plain text and manual entry (with pipeline, provenance, classification, extraction, review, merging, onboarding, reminder scheduling) | Done, verified on Linux; macOS and Windows pending CI |
| 2 | PDF and DOCX (DOC and RTF where supported; OCR for scanned PDFs) | Not started |
| 3 | Images and screenshots (PNG, JPEG, WebP, HEIC; OCR and optional vision model with consent) | Not started |
| 4 | CSV and XLSX (JSON and ICS) keeping rows and columns | Not started |
| 5 | Academic content classification: evaluation set and accuracy targets | Rule based classifier in place |
| 6 | Entity extraction: evaluation set, AI fallback for low confidence cases | Deterministic extractor in place |
| 7 | Student confirmation workflow | Done in milestone 1 |
| 8 | Timeline merging: unified timeline view | Record level merging done; view not started |
| 9 | Calendar integration: semester, monthly, weekly, daily, course views | Not started |
| 10 | Reminder integration: OS notifications, including when the app is closed | Scheduling done; delivery while closed not started |
| 11 | AI quality evaluation and the specialised agents | Not started |
| 12 | Cross platform packaging tests (signed installers) | CI workflow builds installers; signing not set up |

## Earlier requirements carried forward

These come from the earlier project specification and are not built yet: the 12 specialised AI agents, academic research and source verification, academic writing assistance, APA 7 formatting and citation validation, originality and integrity review, statistics and research methods. The names and responsibilities of the 12 agents should be copied here from the original specification when it is available, so this file stays the single source of truth.

## Known limitations in milestone 1

1. The classifier and extractor are rule based. They handle common syllabus, Canvas and assignment layouts; unusual layouts will miss items, which the student can add manually.
2. A date written without a year is resolved only when a semester window is known; otherwise it stays unknown and is flagged.
3. US month/day order is assumed for numeric dates like 3/4/2027.
4. Week or unit context carries forward until the next heading, so an item listed after the schedule may be tagged with the last week.
5. Research sources are recognised only by DOI and stay unverified; metadata lookup needs network access and is planned with the research milestone.
