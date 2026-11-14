import { apaText, apaSegments, extractDoi, inText, mergeWorks, parseCrossref, parseOpenAlex, searchWorks, verifyDoi, authorList, type Work } from '../src/core/scholar';

// Invented papers, authors and DOIs for testing only.
const crossref = JSON.stringify({ message: { items: [
  { DOI: '10.9999/EXAMPLE.101', title: ['Learning <i>Habits</i> in Online Seminars'], author: [{ family: 'Rivera', given: 'Maria Elena' }, { family: 'Osei', given: 'Kwame' }],
    issued: { 'date-parts': [[2021, 3]] }, 'container-title': ['Journal of Example Studies'], volume: '12', issue: '3', page: '45-67', type: 'journal-article', URL: 'https://doi.org/10.9999/example.101' },
  { DOI: '10.9999/example.202', title: ['A Report With No Authors'], issued: { 'date-parts': [[2019]] }, type: 'report', publisher: 'Example Press' },
] } });
const openalex = JSON.stringify({ results: [
  { title: 'Learning Habits in Online Seminars', doi: 'https://doi.org/10.9999/example.101', publication_year: 2021, authorships: [{ author: { display_name: 'Maria Rivera' } }] },
  { title: 'Peer Teaching Study', doi: null, publication_year: 2020, authorships: [{ author: { display_name: 'Ana Lima' } }], primary_location: { source: { display_name: 'Example Review' } }, biblio: { volume: '4', issue: '1', first_page: '10', last_page: '20' } },
] });

describe('scholarly lookup', () => {
  it('parses Crossref and cleans markup', () => {
    const w = parseCrossref(crossref);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ title: 'Learning Habits in Online Seminars', year: 2021, doi: '10.9999/example.101', volume: '12' });
  });

  it('formats an APA 7 journal reference with italics', () => {
    const w = parseCrossref(crossref)[0];
    expect(apaText(w)).toBe('Rivera, M. E., & Osei, K. (2021). Learning Habits in Online Seminars. Journal of Example Studies, 12(3), 45–67. https://doi.org/10.9999/example.101');
    expect(apaSegments(w).filter((s) => s.italic).map((s) => s.text)).toEqual(['Journal of Example Studies', '12']);
    expect(inText(w)).toBe('(Rivera & Osei, 2021)');
  });

  it('handles no authors and many authors without inventing anything', () => {
    const w = parseCrossref(crossref)[1];
    expect(apaText(w)).toBe('A Report With No Authors. (2019). Example Press. https://doi.org/10.9999/example.202');
    expect(inText(w)).toBe('("A Report With No," 2019)');
    const many: Work['authors'] = Array.from({ length: 22 }, (_, i) => ({ family: `Name${i + 1}`, given: 'A' }));
    expect(authorList(many).endsWith('. . . Name22, A.')).toBe(true);
    expect(authorList(many)).toContain('Name19, A., . . .');
    expect(inText({ ...w, authors: [{ family: 'A', given: '' }, { family: 'B', given: '' }, { family: 'C', given: '' }] })).toBe('(A et al., 2019)');
  });

  it('merges catalogues by DOI and keeps OpenAlex only extras', () => {
    const merged = mergeWorks(parseCrossref(crossref), parseOpenAlex(openalex));
    expect(merged.map((w) => w.title)).toEqual(['Learning Habits in Online Seminars', 'A Report With No Authors', 'Peer Teaching Study']);
    expect(apaText(merged[2])).toContain('Example Review, 4(1), 10–20.');
  });

  it('finds DOIs in pasted text', () => {
    expect(extractDoi('see https://doi.org/10.9999/EXAMPLE.101.')).toBe('10.9999/example.101');
    expect(extractDoi('no doi here')).toBeNull();
  });

  it('keeps going when one catalogue fails, and reports unknown DOIs', async () => {
    const get = async (url: string) => {
      if (url.includes('crossref') && url.includes('/works/')) throw new Error('NOT_FOUND');
      if (url.includes('crossref')) throw new Error('busy');
      return openalex;
    };
    const r = await searchWorks('learning habits', get);
    expect(r.works.length).toBe(2);
    expect(r.notes[0]).toMatch(/Crossref: busy/);
    expect(await verifyDoi('10.9999/none', get)).toBeNull();
  });
});
