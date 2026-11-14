import { parseCourseList, hyphenCode } from '../src/core/extract/courseList';

const CANVAS = `[All Courses](https://school.instructure.com/courses)

* [2026FA Applied Research Methods (DSC-701A-SY01)](https://school.instructure.com/courses/11111)
2026FA Applied Research Methods (DSC-701A-SY01)
Term: 2026 Fall
* [2026FA Data Ethics (DSC-640-7AB12)](https://school.instructure.com/courses/22222)
2026FA Data Ethics (DSC-640-7AB12)
Term: 2026 Fall
* [2026FA Graduate Orientation (GEN-500A-7YZ01)](https://school.instructure.com/courses/33333)
2026FA Graduate Orientation (GEN-500A-7YZ01)
Term: 2026 Fall`;

describe('course list import', () => {
  it('reads a Canvas All Courses list once per course', () => {
    expect(parseCourseList(CANVAS)).toEqual([
      { code: 'DSC 701A', name: 'Applied Research Methods', section: 'SY01', term: 'Fall 2026', url: 'https://school.instructure.com/courses/11111' },
      { code: 'DSC 640', name: 'Data Ethics', section: '7AB12', term: 'Fall 2026', url: 'https://school.instructure.com/courses/22222' },
      { code: 'GEN 500A', name: 'Graduate Orientation', section: '7YZ01', term: 'Fall 2026', url: 'https://school.instructure.com/courses/33333' },
    ]);
  });

  it('reads plain lists typed by hand', () => {
    expect(parseCourseList('BUS 610 Strategic Management\nACC-620: Managerial Accounting\n- MKT 630 Marketing Analytics').map((c) => [c.code, c.name])).toEqual([
      ['BUS 610', 'Strategic Management'],
      ['ACC 620', 'Managerial Accounting'],
      ['MKT 630', 'Marketing Analytics'],
    ]);
  });

  it('ignores lines that are not courses', () => {
    expect(parseCourseList('All Courses\nTerm: 2026 Fall\nPublished\nhello world')).toEqual([]);
  });

  it('drops the star button label Canvas copies in front of some courses', () => {
    const [c] = parseCourseList('Click to add 2026FA Applied Practicum (BUS-799-SX1Y2)');
    expect(c).toMatchObject({ code: 'BUS 799', name: 'Applied Practicum', term: 'Fall 2026', section: 'SX1Y2' });
  });

  it('formats codes the way a title page shows them', () => {
    expect(hyphenCode('DSC 701A')).toBe('DSC-701A');
  });
});
