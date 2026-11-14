import { parseSyllabus, unitText, unitItems, matchUnitItem, unitReadingLines, gradeRowFor } from '../src/core/syllabus';
import { fixture } from './helpers';

const text = fixture('syllabus-units.txt');

describe('syllabus facts', () => {
  const f = parseSyllabus(text);

  it('reads how the grade is made up', () => {
    expect(f.totalPoints).toBe(400);
    expect(f.grading.map((g) => [g.label, g.points, g.percent, g.count, g.each])).toEqual([
      ['Discussions', 80, 20, 4, 20],
      ['Project 1 – Change at a Small Firm', 120, 30, null, null],
      ['Major Project – Comparing Leadership Styles', 200, 50, null, null],
    ]);
    expect(gradeRowFor('Unit 3: Discussion Question 2', f)?.label).toBe('Discussions');
    expect(gradeRowFor('Unit 7: Final Research Paper', f)?.label).toMatch(/^Major Project/);
  });

  it('reads the course texts and the articles for each unit', () => {
    expect(f.texts).toEqual(['Marsh (2010), Leading through change: Practical cases for managers', 'Okafor (2018), Reading organizations (3rd ed.)']);
    expect(f.articles[1]).toHaveLength(1);
    expect(f.articles[1][0].citation).toMatch(/^Lindqvist, A\. & Reyes, P\. \(2006\)/);
    expect(f.articles[1][0].url).toBe('http://example.org/working-definition.pdf');
    expect(f.articles[2].map((a) => a.citation.split(' ')[0])).toEqual(['Hartley,', 'Nakamura,']);
  });

  it('reads the posting rules', () => {
    expect(f.rules).toMatchObject({
      dueDay: 'Saturday', dueTime: '11:59 PM', timeZone: 'CT', initialPostDay: 'Wednesday', initialPostTime: '11:59 PM',
      wordMin: 250, wordMax: 500, replies: 2, referencesRequired: true, apa: true,
    });
  });

  it('finds the prompt and requirements of each item in a unit', () => {
    const u1 = unitItems(unitText(text, 1)!);
    expect(u1.map((i) => [i.kind, i.name])).toEqual([['discussion', 'Discussion Question 1'], ['discussion', 'Discussion Question 2']]);
    expect(u1[0].prompt).toBe('Describe a leader you have observed and explain which leadership definition from the reading fits that person best.');
    expect(u1[1].requirements).toBe('Type: Threaded format');
    const u2 = unitItems(unitText(text, 2)!);
    expect(u2.map((i) => i.name)).toEqual(['Discussion Question', 'Project 1: Change at a Small Firm']);
    expect(u2[1].prompt).toMatch(/^In APA 7 format, present a 1500-2000-word document/);
    expect(u2[1].requirements).toMatch(/APA7 format, 1500-2000 words/);
    expect(unitText(text, 2)).not.toMatch(/APPENDIX/);
  });

  it('matches an assignment title to the right item', () => {
    const u1 = unitItems(unitText(text, 1)!);
    expect(matchUnitItem('Unit 1: Discussion Question 2', u1)?.prompt).toMatch(/learned or inherited/);
    const u2 = unitItems(unitText(text, 2)!);
    expect(matchUnitItem('Unit 2: Discussion Question', u2)?.prompt).toMatch(/power and when/);
    expect(matchUnitItem('Unit 2: Writing Assignment', u2)?.name).toMatch(/^Project 1/);
    expect(matchUnitItem('Unit 1: Writing Assignment', u1)).toBeNull();
  });

  it('lists the readings the unit names', () => {
    expect(unitReadingLines(unitText(text, 1)!)).toEqual(['Text: Leading Through Change; Chapters 1, 2.', 'Article: A working definition of leadership.']);
  });
});
