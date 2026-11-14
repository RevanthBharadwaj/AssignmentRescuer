import { parseOverview } from '../src/core/ai';
import { fixture, makeService, approveAll } from './helpers';

describe('syllabus organizer', () => {
  it('reads the model answer and drops what is not in the expected shape', () => {
    const o = parseOverview('Here you go: {"summary":"A course about leadership.","facts":[{"label":"Instructor","value":"Dr. Rivera"},{"label":"","value":"x"},{"label":"Late work","value":"10 percent per day"}],"cautions":["Posts are due Wednesday"]} thanks');
    expect(o.facts).toEqual([{ label: 'Instructor', value: 'Dr. Rivera' }, { label: 'Late work', value: '10 percent per day' }]);
    expect(() => parseOverview('no json here')).toThrow(/expected form/);
    expect(() => parseOverview('{"summary":"","facts":[]}')).toThrow(/nothing useful/);
  });

  it('saves a syllabus overview note with the model that wrote it', async () => {
    const { service } = await makeService();
    await service.saveProfile('Example University', 'MS');
    await service.addCourse({ code: 'mgt6200', name: 'Topics in Leadership', instructor: null });
    await service.saveAiSettings({ provider: 'ollama', model: 'qwen3:4b', ollamaUrl: 'http://localhost:11434', cloudConsent: false });
    const r = await service.importForCourse('MGT 6200', [{ kind: 'text', text: fixture('syllabus-units.txt'), hints: { material: 'syllabus' } }]);
    await approveAll(service);
    const sourceId = r.sources[0].source.id;
    const seen: { model: string; prompt: string }[] = [];
    const note = await service.organizeSyllabus(sourceId, async (req) => {
      seen.push({ model: req.model, prompt: req.prompt });
      return '{"summary":"Leadership theories, assessed by posts and projects.","facts":[{"label":"Grading","value":"Posts 220 of 1000 points"}],"cautions":["Initial post is due Wednesday"]}';
    });
    expect(seen[0].model).toBe('qwen3:4b');
    expect(seen[0].prompt).toContain('untrusted syllabus');
    expect(note.fields.kind).toBe('syllabus');
    expect(String(note.fields.summary)).toContain('Leadership theories');
    expect((note.fields.actions as string[])[0]).toContain('Grading: Posts 220 of 1000 points');
  });
});
