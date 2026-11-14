import { findTerms, sameTerm, termMismatch, termOrder } from '../src/core/term';

describe('terms in pasted text', () => {
  it('finds terms written three ways and puts the most mentioned first', () => {
    expect(findTerms('Term: 2026 Fall\n2026FA Strategy (BUS-610)\nSee Fall 2026 policies\n2027SP Ethics')).toEqual(['Fall 2026', 'Spring 2027']);
    expect(findTerms('nothing here, and 2026 is just a year')).toEqual([]);
  });

  it('orders terms in time', () => {
    expect(termOrder('Spring 2027')).toBeGreaterThan(termOrder('Fall 2026'));
    expect(termOrder('Fall 2026')).toBeGreaterThan(termOrder('Summer 2026'));
  });

  it('asks only when the text names terms and none is the saved semester', () => {
    expect(termMismatch('Syllabus for Spring 2027', 'Fall 2026')).toEqual({ found: ['Spring 2027'], semester: 'Fall 2026' });
    expect(termMismatch('Syllabus for Fall 2026 and Spring 2027', 'Fall 2026')).toBeNull();
    expect(termMismatch('Syllabus with no term', 'Fall 2026')).toBeNull();
    expect(termMismatch('Syllabus for Spring 2027', null)).toBeNull();
    expect(sameTerm('fall 2026', 'Fall 2026')).toBe(true);
  });
});
