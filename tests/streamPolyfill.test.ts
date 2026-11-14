import { fixtureBytes } from './helpers';

// The macOS app runs on Safari's engine, which has no async iteration of
// ReadableStream. Remove it here to reproduce that, then import a PDF.
describe('PDF import without ReadableStream async iteration (Safari)', () => {
  const proto = ReadableStream.prototype as unknown as Record<PropertyKey, unknown>;
  const saved = { it: proto[Symbol.asyncIterator], values: proto.values };
  beforeEach(() => {
    delete proto[Symbol.asyncIterator];
    delete proto.values;
  });
  afterEach(() => {
    proto[Symbol.asyncIterator] = saved.it;
    proto.values = saved.values;
  });

  it('fails the way the Mac app did without the fix', async () => {
    const s = new ReadableStream({ start(c) { c.enqueue(1); c.close(); } });
    await expect((async () => { for await (const x of s as unknown as AsyncIterable<number>) void x; })()).rejects.toThrow(TypeError);
  });

  it('reads a PDF once the fix is installed', async () => {
    const { installStreamIteration } = await import('../src/core/input/streamPolyfill');
    installStreamIteration();
    const { extractPdf } = await import('../src/core/input/pdf');
    const r = await extractPdf(fixtureBytes('syllabus.pdf'));
    expect(r.text).toMatch(/\w/);
    expect(r.pageOffsets?.length).toBeGreaterThan(0);
  });

  it('stops and cancels the stream when the loop ends early', async () => {
    const { installStreamIteration } = await import('../src/core/input/streamPolyfill');
    installStreamIteration();
    let cancelled = false;
    const s = new ReadableStream({ pull(c) { c.enqueue(1); }, cancel() { cancelled = true; } });
    for await (const x of s as unknown as AsyncIterable<number>) { void x; break; }
    expect(cancelled).toBe(true);
  });
});
