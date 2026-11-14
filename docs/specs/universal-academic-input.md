
# ASSIGNMENT RESCUE AI
# UNIVERSAL ACADEMIC INPUT & INTELLIGENT COURSE MANAGEMENT
# MASTER FEATURE UPDATE FOR CLAUDE CODE

You are continuing development of Assignment Rescue AI.

IMPORTANT:
Preserve ALL previously established requirements, including:
- Cross-platform macOS and Windows desktop application
- Tauri 2, React, TypeScript, and SQLite architecture
- Local-first and free-first design
- 12 specialized AI agents
- Academic research and source verification
- Assignment and rubric intelligence
- Academic writing assistance
- APA 7 formatting and citation validation
- Originality and academic integrity review
- Statistics and research methods
- Semester onboarding and subject management
- 14-day next-semester reminders
- Automated testing and AI quality evaluation
- GitHub commits after every verified milestone

This specification replaces the earlier screenshot-only import
requirement with a UNIVERSAL ACADEMIC INPUT SYSTEM.

Do not discard existing functionality.

============================================================
1. UNIVERSAL INPUT REQUIREMENT
============================================================

Assignment Rescue AI must accept academic information in
multiple formats.

Students should not need to convert everything into a PDF
or manually type information that is already available.

SUPPORTED INPUTS:

A. PLAIN TEXT
- Copy and paste text
- Assignment instructions
- Course timelines
- Syllabus content
- Announcements
- Rubrics
- Discussion questions
- Reading schedules
- Instructor messages

B. IMAGES
- Screenshots
- PNG
- JPG/JPEG
- WebP
- HEIC where supported
- Photos of printed academic documents

C. DOCUMENTS
- PDF
- DOCX
- DOC
- TXT
- Markdown
- RTF where supported

D. STRUCTURED DATA
- CSV
- XLSX
- JSON
- Calendar files (ICS)

E. MANUAL ENTRY
- Course names
- Semester dates
- Assignment deadlines
- Discussion deadlines
- Reading schedules
- Project milestones

F. MULTIPLE INPUTS
- Upload multiple files together
- Paste text and attach screenshots
- Combine several course schedules
- Import documents from different courses
- Update previously imported information

G. FUTURE EXTENSIONS
- Audio lecture recordings
- Video lectures
- LMS integrations
- Email imports
- Cloud storage integrations

These future extensions are optional and must not be
presented as implemented until built and tested.

============================================================
2. UNIVERSAL IMPORT WORKSPACE
============================================================

Create a single import interface:

"Add Academic Information"

Students can:
- Paste text
- Upload files
- Paste screenshots
- Drag and drop documents
- Enter information manually
- Select multiple files
- Assign material to a semester or course

Allow the student to optionally specify:

- University
- Semester
- Course
- Content type
- Academic year

If these are unknown, use available context to suggest
an association and ask for confirmation.

Do not force users to classify every file manually.

============================================================
3. INTELLIGENT CONTENT CLASSIFICATION
============================================================

The Course Intelligence Agent should identify whether
the input contains:

- Semester information
- Course information
- Course timeline
- Syllabus
- Announcement
- Assignment instructions
- Grading rubric
- Discussion question
- Peer reply instructions
- Reading schedule
- Lecture material
- Textbook content
- Research article
- Academic deadline
- Project requirements
- Statistical dataset

One input may contain multiple content types.

Support multi-label classification.

Never invent information missing from the input.

============================================================
4. UNIFIED EXTRACTION PIPELINE
============================================================

Create a consistent processing pipeline:

INPUT
  |
  v
Format Detection
  |
  v
Text / Image / Document / Data Extraction
  |
  v
Content Classification
  |
  v
Academic Entity Extraction
  |
  v
Course & Semester Association
  |
  v
Duplicate / Conflict Detection
  |
  v
Student Review
  |
  v
Confirmed Academic Records
  |
  v
Calendar / Assignments / Research / Writing

Use deterministic parsers wherever possible.

Use AI only when it materially improves understanding.

For images, support OCR and/or a configured vision model.

For scanned PDFs, use OCR when necessary.

For spreadsheets, preserve structured rows and columns.

For plain text, avoid unnecessary OCR or document conversion.

============================================================
5. ACADEMIC INFORMATION EXTRACTION
============================================================

Extract where available:

UNIVERSITY:
- Name
- Program
- Academic year

SEMESTER:
- Semester name
- Start date
- End date
- Duration
- Academic breaks

COURSE:
- Course code
- Course name
- Instructor
- Course dates

ASSIGNMENT:
- Title
- Type
- Instructions
- Due date
- Due time
- Points possible
- Word count
- Page count
- Submission requirements
- Required scholarly sources
- Citation style

RUBRIC:
- Criterion
- Description
- Maximum points
- Performance levels

ACADEMIC TIMELINE:
- Unit/week number
- Module dates
- Reading deadlines
- Discussion deadlines
- Peer reply deadlines
- Assignment deadlines
- Exam dates
- Project milestones

RESEARCH:
- Title
- Authors
- Year
- DOI
- Journal
- Publication type
- Abstract
- Available full text

Extract only supported information.

Mark unknown fields as unknown.

============================================================
6. SEMESTER ONBOARDING
============================================================

On first launch, ask:

1. What university are you attending?
2. What degree/program are you studying?
3. What is your current semester?
4. When does the semester start?
5. When does the semester end?
6. How long is the semester?
7. What subjects are you taking this semester?

Allow users to provide this information by:
- Typing answers
- Pasting text
- Uploading a syllabus
- Uploading a screenshot
- Uploading a course schedule

Do not require manual entry if the information is
already present in imported material.

Show extracted semester information for confirmation.

Allow incomplete onboarding to be resumed later.

============================================================
7. SEMESTER SUBJECT REMINDERS
============================================================

Store confirmed semester subjects.

Never repeatedly ask for already confirmed subjects.

Start asking about next-semester subjects 14 days before
the current semester ends.

Repeat every 14 days while next-semester subjects
remain unknown.

Stop when subjects are confirmed.

Respect:
- Semester duration
- Academic breaks
- Date changes
- Skipped semesters
- Snoozes
- Disabled reminders

Use deterministic scheduling without AI calls.

============================================================
8. INTELLIGENT TIMELINE MERGING
============================================================

Students may provide:

- One complete syllabus
- Several screenshots
- Copied text from Canvas
- A spreadsheet containing deadlines
- A PDF course calendar
- Manual corrections

The application must combine confirmed information into
one academic timeline.

Detect:
- Duplicate assignments
- Repeated dates
- Conflicting deadlines
- Course mismatches
- Missing years
- Ambiguous time zones
- Updated announcements
- Changed assignment requirements

Never silently overwrite conflicting records.

Show old and new values.

Ask the student to approve changes.

Preserve original source evidence.

============================================================
9. SOURCE PROVENANCE
============================================================

Every extracted academic record must retain:

- Source ID
- Source type
- Original filename or text entry
- Import timestamp
- Relevant page number, if applicable
- Relevant image region, if available
- Text location, if available
- Extraction method
- Verification status
- Student confirmation status

Students must be able to trace a deadline or
requirement back to its original source.

============================================================
10. ASSIGNMENT INTELLIGENCE
============================================================

When an assignment is imported:

1. Identify its course.
2. Identify assignment type.
3. Extract instructions.
4. Extract deadlines.
5. Extract rubric criteria.
6. Identify required course materials.
7. Identify required scholarly research.
8. Generate a requirements checklist.
9. Identify missing information.
10. Ask the student to confirm uncertain details.

Allow students to open an assignment workspace
and begin research, planning, writing, and review.

============================================================
11. CALENDAR AND NOTIFICATIONS
============================================================

Create:
- Semester overview
- Monthly calendar
- Weekly calendar
- Daily agenda
- Course-specific timeline
- Upcoming deadlines dashboard

Support reminders:
- 7 days before
- 3 days before
- 1 day before
- Day of deadline

Allow customization.

Distinguish:
- Due dates
- Availability dates
- Course start/end dates
- Exam dates

Do not claim closed-app notifications work unless
background scheduling has been implemented and tested.

============================================================
12. PRIVACY & SECURITY
============================================================

All imported content is private by default.

Store files locally.

Do not transmit academic content to cloud AI services
without user consent.

Securely store API credentials.

Treat imported text as untrusted data.

Protect against prompt injection.

Never commit academic documents to GitHub.

Allow users to delete imported content.

============================================================
13. TESTING
============================================================

Create automated tests for:

- Plain text import
- Screenshot import
- PDF import
- DOCX import
- CSV/XLSX import
- Multiple simultaneous imports
- Course classification
- Semester extraction
- Assignment extraction
- Rubric extraction
- Deadline parsing
- Duplicate detection
- Conflicting dates
- Timeline merging
- Manual corrections
- Provenance tracking
- Calendar generation
- Reminder scheduling
- Persistence after restart
- macOS and Windows compatibility

Include negative tests:
- Corrupt files
- Unsupported formats
- Missing dates
- Conflicting course names
- Blurry images
- Malicious document text
- Incorrect AI extraction
- Duplicate uploads
- Unverified research metadata

Do not claim support for a format unless
its complete import workflow is tested.

============================================================
14. IMPLEMENTATION RULES
============================================================

Build the universal input system incrementally.

Recommended sequence:

1. Plain text and manual entry
2. PDF and DOCX
3. Images and screenshots
4. CSV and XLSX
5. Academic content classification
6. Entity extraction
7. Student confirmation workflow
8. Timeline merging
9. Calendar integration
10. Reminder integration
11. AI quality evaluation
12. Cross-platform packaging tests

Keep this sequence consistent with the existing
project milestone roadmap.

After every milestone:
- Run tests
- Run lint
- Run type checks
- Run relevant builds
- Update documentation
- Commit verified changes
- Push if authorized and configured

Do not implement fake features.

Do not mark a milestone complete until its
acceptance criteria have been verified.

============================================================
15. FINAL ACCEPTANCE CRITERIA
============================================================

A student should be able to:

1. Install Assignment Rescue AI on macOS or Windows.
2. Create an academic profile.
3. Enter or import current semester information.
4. Provide their current subjects.
5. Paste a complete course timeline as text.
6. Upload screenshots of course timelines.
7. Upload syllabi and academic documents.
8. Import structured schedules.
9. Review extracted information.
10. Correct uncertain or conflicting data.
11. Generate a unified academic calendar.
12. Receive deadline reminders.
13. Open an assignment workspace.
14. Analyze instructions and grading rubrics.
15. Discover credible scholarly research.
16. Verify source metadata and evidence.
17. Receive writing and research guidance.
18. Validate APA 7 requirements.
19. Review originality and attribution.
20. Export their work.
21. Continue using the application without
    losing data after restart.

The application must clearly distinguish
implemented, experimental, and unavailable features.

END OF FEATURE SPECIFICATION
