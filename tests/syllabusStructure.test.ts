import { structureSyllabus } from '../src/core/syllabusStructure';

// A made up syllabus laid out like a real PDF export.
const text = `
 TOPICS IN LEADERSHIP
           MGT6200
Online Studies Student Syllabus

       © Example University | Updated: June 30, 2026
Course Description
This course gives an overview of leadership theories and how they apply to current practice. Students compare approaches, discuss cases and write about their own development as leaders in organizations.

Student Competencies

   •   Analyze leadership situations using theory.
   •   Apply leadership approaches to management problems.

                                  2
Assessment Criteria
                    Assignment                          Points         Online
 Discussions (11 @ 20 points each)                       220            22%
 Project 2 – Personal Learning Strategy                  150            15%
 Across Cultures and Countries
 Major Project – Presenting Leadership Theories           330            33%
 Total                                                   1000           100%

       Grading Scale:
       A     93-100%
       A-    90-92%

Resource Inventory

Thomas, R. J. (2008). Crucibles of leadership. Example Press.
     ISBN: 978-0000000001

The Holy Bible

UNIT 1 ARTICLE:

Winston, B. (2006) An integrative definition of leadership. Journal of Examples. Vol. 1, Issue 2.

                                  3
UNIT 3 ARTICLE:

Shannon, M. (2020), Trigger events and crucibles. Journal of Examples, Vol. 39.

Late Work Policy
Late work loses ten percent per day unless an extension was agreed with the instructor before the due date, and nothing is accepted after seven days.
`;

describe('syllabus structure', () => {
  const r = structureSyllabus(text);
  const by = (id: string) => r.groups.find((g) => g.id === id);

  it('groups sections instead of splitting on every short line', () => {
    expect(r.groups.map((g) => g.id)).toEqual(['overview', 'grading', 'materials', 'schedule' as never, 'policies'].filter((x) => x !== 'schedule'));
    const headings = r.groups.flatMap((g) => g.sections.map((s) => s.heading));
    expect(headings).not.toContain('2');
    expect(headings).not.toContain('3');
    expect(headings).not.toContain('Across Cultures and Countries');
    expect(headings).not.toContain('The Holy Bible');
  });

  it('keeps the table, the scale and the wrapped row together under Grading', () => {
    const g = by('grading')!;
    expect(g.sections).toHaveLength(1);
    expect(g.sections[0].body).toContain('Across Cultures and Countries');
    expect(g.sections[0].body).toContain('A     93-100%');
  });

  it('keeps books and unit articles under materials and marks policies', () => {
    const m = by('materials')!;
    expect(m.sections.map((s) => s.heading)).toEqual(['Resource Inventory', 'UNIT 1 ARTICLE', 'UNIT 3 ARTICLE']);
    expect(m.sections[0].body).toContain('The Holy Bible');
    expect(by('policies')!.sections[0].policy).toBe(true);
    expect(r.title).toContain('TOPICS IN LEADERSHIP');
    expect(by('overview')!.sections.map((s) => s.heading)).toEqual(['Course information', 'Course Description', 'Student Competencies']);
  });
});
