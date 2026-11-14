import { detectFormat } from '../src/core/input/formatDetection';
import { extractText, UnsupportedFormatError, CorruptFileError } from '../src/core/input/extractors';
import { FEATURES, isFormatImplemented } from '../src/core/features';
import { fixtureBytes } from './helpers';

describe('format detection', () => {
  it('detects by magic bytes before extension', () => {
    expect(detectFormat('renamed.txt', fixtureBytes('fake.pdf'))).toBe('pdf');
    expect(detectFormat('shot.png', fixtureBytes('screenshot.png'))).toBe('png');
    expect(detectFormat('photo.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
  });

  it('detects text formats by extension', () => {
    expect(detectFormat('notes.md', fixtureBytes('canvas-copy.md'))).toBe('markdown');
    expect(detectFormat('syllabus.txt', fixtureBytes('syllabus.txt'))).toBe('txt');
    expect(detectFormat('cal.ics', new TextEncoder().encode('BEGIN:VCALENDAR\nEND:VCALENDAR'))).toBe('ics');
  });

  it('reports zip containers it cannot identify as unknown', () => {
    expect(detectFormat('mystery.zip', fixtureBytes('mystery.zip'))).toBe('unknown');
  });
});

describe('extractors', () => {
  it('extracts plain text and strips markdown markup', () => {
    expect(extractText('txt', new TextEncoder().encode('﻿hello')).text).toBe('hello');
    const md = extractText('markdown', fixtureBytes('canvas-copy.md')).text;
    expect(md).toContain('Homework 1 due Sep 6');
    expect(md).not.toContain('**');
    expect(md).not.toContain('https://');
  });

  it('refuses formats that are not implemented instead of faking support', () => {
    expect(() => extractText('pdf', fixtureBytes('fake.pdf'))).toThrow(UnsupportedFormatError);
    expect(() => extractText('png', fixtureBytes('screenshot.png'))).toThrow(UnsupportedFormatError);
    expect(() => extractText('xlsx', new Uint8Array([1]))).toThrow(UnsupportedFormatError);
  });

  it('reports invalid UTF-8 text as corrupt', () => {
    expect(() => extractText('txt', fixtureBytes('corrupt.txt'))).toThrow(CorruptFileError);
  });

  it('keeps the feature registry honest', () => {
    const implementedInputs = FEATURES.filter((f) => f.id.startsWith('input.') && f.status === 'implemented').map((f) => f.id);
    expect(implementedInputs.sort()).toEqual(['input.lms_modules', 'input.manual', 'input.markdown', 'input.multiple', 'input.plain_text', 'input.txt']);
    for (const f of ['pdf', 'docx', 'png', 'jpeg', 'csv', 'xlsx', 'ics', 'json'] as const) expect(isFormatImplemented(f)).toBe(false);
    expect(FEATURES.find((f) => f.id === 'notifications.closed_app')?.status).toBe('unavailable');
  });
});
