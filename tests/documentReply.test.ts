import { describe, expect, it } from 'vitest';
import { isDocumentReply } from '../src/core/chat';

describe('isDocumentReply', () => {
  it('is false for a short answer', () => {
    expect(isDocumentReply('Your essay is due Friday. Two other items are due next week.')).toBe(false);
  });
  it('is true for a titled paper', () => {
    expect(isDocumentReply('# The Causes of the French Revolution\n\nIntro paragraph.')).toBe(true);
  });
  it('is true for a long write up', () => {
    expect(isDocumentReply(Array(400).fill('word').join(' '))).toBe(true);
  });
});
