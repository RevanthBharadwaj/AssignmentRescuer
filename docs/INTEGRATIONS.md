# Open source projects and models: what the app uses and what comes next

Reviewed against the app's goals: local first, free first, light to install, private by default.

## Already in use
Crossref, OpenAlex (see below).
Tauri 2 (desktop shell), PDF.js (PDF text), SQLite (rusqlite in the app, sql.js in tests), fflate (Word and zip files), Ollama (free local models).

## Built in update 10
Crossref and OpenAlex lookups (through the desktop app, three allowed hosts, only the search words sent), DOI checking, and APA 7 references and in text citations written by `src/core/scholar.ts` (no Citation.js needed for journal articles). Saved references are the only sources the chat may cite.

## Add next, in this order
1. Semantic Scholar and Unpaywall (open access links). Books, web pages and APA edge cases in the citation formatter.
3. Zod. Checks the JSON the AI returns so a malformed answer cannot reach the database.
4. Tesseract.js. Reads text from Canvas screenshots when no vision model is installed.
5. Tiptap. A proper editor for the drafts the chat produces.
6. Promptfoo, as a development tool, to test the chat prompts for prompt injection and invented citations.
7. Transformers.js with BGE small and MiniLM. Searches your saved material by meaning; downloads on demand.

## Useful only for some courses
pandas, SciPy, Statsmodels, Pingouin, scikit-learn and JupyterLab for statistics heavy classes. They need Python, so they should be an optional add on, not part of the installer.

## Not recommended now
Docling, MarkItDown, Pandoc, Quarto and apaquarto need Python or large runtimes; the current importer already covers PDF, Word, text and screenshots. FullCalendar and React Flow duplicate or exceed what the app needs (it has its own calendar). llama.cpp overlaps with Ollama. LangGraph.js, LanguageTool, Vale and RapidFuzz add weight without a clear gain (the app already detects duplicates in TypeScript). Playwright is not needed because tauri-driver tests the real app.

## Models
Chat models offered in the app (Qwen3 4B and 8B, Llama 3.1 8B, Gemma 3 4B, Qwen2.5 VL 3B and 7B, Phi 4 mini) are in `src/core/models.ts` with size, memory, licence and a plain quality note. The BGE models, MiniLM and BART are listed as planned helpers. Licences differ (Apache 2.0, MIT, Llama and Gemma terms); read each model card before sharing weights. TrOCR and Donut need task specific adaptation and are not planned.
