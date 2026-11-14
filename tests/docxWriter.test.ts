import { unzipSync, strFromU8 } from 'fflate';
import { buildDocx, docFileName, inlineRuns, parseBlocks } from '../src/core/docxWriter';
import { extractDocx } from '../src/core/input/docx';

const md = `# Leadership and Trust

First paragraph with **bold** and *italic* words.
Same paragraph continues.

## Method
- one point
- two point

1. numbered

# References
Rivera, M. (2021). Learning habits. *Journal of Example Studies*, 12(3), 45–67. https://doi.org/10.9999/example.101`;

describe('docx writer', () => {
  it('splits markdown into blocks and runs', () => {
    const b = parseBlocks(md);
    expect(b.map((x) => x.kind)).toEqual(['heading', 'para', 'heading', 'bullet', 'bullet', 'number', 'heading', 'para']);
    expect(inlineRuns('a **b** *c*')).toEqual([{ text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', italic: true }]);
  });

  it('builds a real Word file that this app can read back', () => {
    const bytes = buildDocx(md, { titlePage: [{ text: 'Leadership and Trust', bold: true }, { text: 'Alex Student' }] });
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/header1.xml', 'word/styles.xml']);
    const xml = strFromU8(files['word/document.xml']);
    expect(xml).toContain('w:pStyle w:val="Reference"');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('w:type="page"');
    const text = extractDocx(bytes).text;
    expect(text).toContain('Alex Student');
    expect(text).toContain('Same paragraph continues.');
    expect(text).toContain('Journal of Example Studies');
  });

  it('escapes markup and names the file safely', () => {
    const xml = strFromU8(unzipSync(buildDocx('Use <b> & "quotes"'))['word/document.xml']);
    expect(xml).toContain('Use &lt;b&gt; &amp; &quot;quotes&quot;');
    expect(docFileName('Week 2: Draft / v1?')).toBe('Week 2 Draft v1.docx');
  });
});
