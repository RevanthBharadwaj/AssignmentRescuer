import { classify, hasLabel } from '../src/core/classify/classifier';
import { fixture } from './helpers';

describe('content classification', () => {
  it('assigns several labels to a syllabus', () => {
    const c = classify(fixture('syllabus.txt'));
    for (const l of ['syllabus', 'course_timeline', 'semester_information', 'academic_deadline', 'course_information'] as const) {
      expect(hasLabel(c, l)).toBe(true);
    }
  });

  it('identifies assignment instructions and rubrics', () => {
    expect(classify(fixture('assignment.txt'))[0].label).toBe('assignment_instructions');
    expect(hasLabel(classify(fixture('rubric.txt')), 'grading_rubric')).toBe(true);
  });

  it('identifies discussion and peer reply instructions', () => {
    const c = classify('Discussion Board: make your initial post by Wednesday, then reply to at least two classmates.');
    expect(hasLabel(c, 'discussion_question')).toBe(true);
    expect(hasLabel(c, 'peer_reply_instructions')).toBe(true);
  });

  it('identifies research articles and datasets', () => {
    expect(hasLabel(classify('Abstract. We study X. Journal of Learning Analytics. https://doi.org/10.1234/abc.567 Methodology and results.'), 'research_article')).toBe(true);
    expect(hasLabel(classify('id,age,score,group\n1,22,88,A\n2,25,91,B\nmean score and standard deviation'), 'statistical_dataset')).toBe(true);
  });

  it('returns no labels for unrelated text rather than guessing', () => {
    expect(classify('Remember to buy groceries and call mom.')).toEqual([]);
  });
});
