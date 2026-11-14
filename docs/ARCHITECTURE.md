# Architecture

## Principles

1. Local first. All data lives in one SQLite file on the student's machine.
2. Deterministic first. Parsers and rules handle everything they can; AI is added later only where it clearly improves understanding, and only with consent before any content leaves the machine.
3. Nothing is invented. A value the source does not state is `null` and listed in `unknownFields`. A date without a year keeps `year: null` unless the semester window settles it.
4. Nothing is saved silently. Extraction produces proposals; the student approves, rejects, or picks old or new values per field.
5. Everything is traceable. Every confirmed record keeps all of its evidence: source id, type, file name or text label, import time, page, image region, line, character span, excerpt, extraction method, verification status and confirmation status.
6. Honest capability. `src/core/features.ts` is the single registry of implemented, experimental and unavailable features. Extractors refuse formats not marked implemented.

## Import pipeline

```
input (text | file | manual)
  → format detection (magic bytes, then extension)
  → text extraction (per format extractor; unsupported formats throw)
  → sanitising (control and zero width characters, size cap, injection scan)
  → duplicate upload check (SHA-256 of the raw bytes)
  → classification (multi label)
  → semester window discovery across the whole batch
  → entity extraction with shared date context
  → rubric to assignment linking
  → grouping of matching records across sources in the batch
  → comparison with confirmed records → proposals (create, update, duplicate, conflict)
  → student review
  → confirmed records + evidence + change log
```

`runImport` in `src/core/pipeline.ts` is pure: it reads nothing and writes nothing. `AcademicService` wires it to the repository.

## Data model

Generic tables keep the schema stable while entity types grow:

| Table | Purpose |
|---|---|
| `sources` | Every imported input with full text, hash, hints, security flags and classifications |
| `records` | Confirmed records, unique on `(entity_type, record_key)`, fields as JSON |
| `evidence` | One row per provenance entry supporting a record |
| `proposals` | Pending, confirmed and rejected proposals |
| `change_log` | Old and new values for every approved update or manual correction |
| `settings` | Onboarding, reminder and next semester state |

Migrations in `src/db/schema.ts` are append only and tracked with `PRAGMA user_version`.

## Storage drivers

The repository talks to a small `SqlDriver` interface with one transaction contract: writes inside `transaction()` are queued and applied atomically at the end; reads inside the callback see the state from before it.

The desktop driver calls two Rust commands, `db_batch` and `db_select` (`src-tauri/src/db.rs`), backed by a single rusqlite connection behind a mutex. An earlier version used `tauri-plugin-sql`; its connection pool ran `BEGIN` and `COMMIT` on different connections and locked the database, which the desktop end to end test caught. Tests and the browser preview use sql.js, which is real SQLite compiled to WebAssembly, behind the same contract.

## Matching and conflicts

Records match on exact key first (for example `CIS 6930|homework 1`). Assignments and timeline items also match fuzzily: same course and title token similarity of at least 0.75, or at least 0.5 with the same date. A date with no year matches the same month and day with any year, so a screenshot that omits the year does not raise a false conflict. Unknown values never erase known ones.

## Course content

`src/core/courseContent.ts` decides what each source is (`sourceKind`: the student's choice, else inferred from the text), which sources belong to a course, how a document splits into sections, which sections state rules (`policySections`, tagged by topic), and what context an assignment gets (`buildAssignmentContext`). Context is ranked by the topics that matter for the kind of work, with topics named in a section heading counting more than ones mentioned in passing. Announcements are linked to an assignment by its title, or by the same numbers in the same order together with the same kind of work in one sentence.

## Announcements and the AI assistant

`src/core/announcements.ts` keeps only the dated assignment items in an announcement that match work the student already has (or that other material in the same import adds), rewritten with the existing key so a different date shows as a change. Everything else in an announcement is context, not new records.

`src/core/ai.ts` builds prompts (course material wrapped by `wrapAsUntrustedData`, the list of saved assignment titles) and checks answers with `parseBriefing`: JSON only, lengths capped, and assignment titles resolved to existing keys or dropped. The service saves the result as an `ai_note` record through `saveGenerated` (no review, since it is not a fact from the material; same key replaces the note) with `extractionMethod: 'ai_model'` and `verificationStatus: 'unverified'`. The model is called through the `ai_complete` Rust command (`src-tauri/src/ai.rs`): Anthropic's Messages API with the key from the system keychain (`ai_set_key`, `ai_has_key`), or Ollama's `/api/chat` restricted to localhost. The completer is injected, so tests use a stand-in.

## Reminders

Both schedulers are pure functions of stored state and today's date, so they need no background process and survive restarts. The next semester prompt first appears 14 days before the current semester ends, moves out of in-semester breaks, then repeats 14 days after each prompt until subjects are confirmed, the student skips the semester, or reminders are turned off. A new current semester starts a new cycle. Deadline reminders are computed for due dates and exams only, never availability dates, and on the due day never after the deadline time.

## Security

Imported text is data. `sanitiseImportedText` strips control and zero width characters, caps size, and flags lines that look like prompt injection; flagged records carry `possible_prompt_injection` and the UI warns the student. `wrapAsUntrustedData` exists for future AI calls and uses a per call boundary token. The Tauri capability grants only `core:default` plus the app's own database commands; no HTTP, shell or filesystem plugins are enabled. The CSP allows only local resources.
