# Testing

All fixtures in `tests/fixtures/` are synthetic. Never add real student documents.

## Suites

| Command | Covers |
|---|---|
| `npm test` | Vitest: dates, classifier, formats and extractors, security, extraction, pipeline, merging, repository, driver contract, reminders, onboarding, checklist, and React UI flows in jsdom against a real SQLite (sql.js) database |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust SQLite layer: atomic batches, typed results, parameter validation |
| `node e2e/desktop.e2e.mjs <binary>` | The real desktop build through WebDriver: first launch, paste import, approval including flagged items, restart, data still there, courses, assignment workspace, features. With `SCREENSHOT_DIR` set it saves the README screenshots |
| `npm run typecheck`, `npm run lint`, `npm run build` | Static checks and production bundle |

## Specification coverage (milestone 1)

| Required test | Where |
|---|---|
| Plain text import | pipeline, ui, e2e |
| Multiple simultaneous imports | pipeline (`accepts pasted text and several files`) |
| Course classification, semester, assignment, rubric extraction | classifier, extraction |
| Deadline parsing | dates, extraction |
| Duplicate detection, duplicate uploads | pipeline, repository |
| Conflicting dates and timeline merging | pipeline (`conflict`), repository (`never overwrites`), ui |
| Manual corrections | repository (`manual corrections`) |
| Provenance tracking | extraction, repository (`traces a confirmed deadline`) |
| Reminder scheduling | reminders |
| Persistence after restart | repository (sql.js export and reload), e2e (real desktop app) |
| Corrupt files, unsupported formats, missing dates, conflicting course names, malicious text, duplicate uploads, unverified research metadata | formats, pipeline, extraction, security |

Not yet covered because the features do not exist: screenshot, PDF, DOCX, CSV and XLSX import, blurry images, incorrect AI extraction, calendar generation.

## Platform verification

Verified in this build: unit, UI and Rust tests, the production bundle, and the desktop end to end test on Linux (WebKitGTK).

Not yet verified: macOS and Windows. The CI workflow in `.github/workflows/ci.yml` runs every check and builds installers on `macos-latest` and `windows-latest`. Until that workflow has passed on both, macOS and Windows support should be described as expected rather than verified. The WebDriver end to end test runs on Linux only, because Tauri's WebDriver support does not cover macOS; on Windows it needs Edge WebDriver and can be added later.
