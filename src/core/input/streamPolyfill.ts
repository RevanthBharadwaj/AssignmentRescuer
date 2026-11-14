/**
 * Safari's engine (used by the macOS app) cannot loop over a ReadableStream
 * with `for await`, which PDF.js uses to read a page's text. Without this,
 * PDF import on a Mac fails with "undefined is not a function". This adds
 * the standard async iterator where it is missing; it does nothing elsewhere.
 */
type IterableStream = ReadableStream & { [Symbol.asyncIterator]?: unknown; values?: unknown };

export function installStreamIteration(): void {
  if (typeof ReadableStream === 'undefined') return;
  const proto = ReadableStream.prototype as IterableStream;
  if (typeof proto[Symbol.asyncIterator] === 'function') return;
  async function* values(this: ReadableStream, options?: { preventCancel?: boolean }) {
    const reader = this.getReader();
    let finished = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { finished = true; return; }
        yield value;
      }
    } finally {
      // Stopping early (break or an error) cancels the stream, as the standard says.
      if (!finished && !options?.preventCancel) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  Object.defineProperty(proto, 'values', { value: values, writable: true, configurable: true });
  Object.defineProperty(proto, Symbol.asyncIterator, { value: values, writable: true, configurable: true });
}

installStreamIteration();
