import { describe, expect, it } from 'vitest';
import {
  createTextMeasurer,
  ellipsize,
  estimateTextSize,
  LINE_HEIGHT,
  wrapText,
  type TextStyle,
} from './text.js';

const style: TextStyle = { fontFamily: 'sans-serif', fontSize: 10 };

describe('text measurement (node environment — SSR path, R10)', () => {
  it('imports and measures without a DOM', () => {
    // This file runs in the default node environment: no document.
    expect(typeof document).toBe('undefined');
    const measure = createTextMeasurer();
    const size = measure('Hello', style);
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBe(LINE_HEIGHT * 10);
  });

  it('estimates wider text as wider, and scales with font size', () => {
    expect(estimateTextSize('MMMM', style).width).toBeGreaterThan(
      estimateTextSize('iiii', style).width,
    );
    expect(estimateTextSize('abc', { ...style, fontSize: 20 }).width).toBe(
      estimateTextSize('abc', style).width * 2,
    );
    expect(estimateTextSize('', style)).toEqual({ width: 0, height: LINE_HEIGHT * 10 });
  });

  it('caches by font + text (font change re-measures)', () => {
    const measure = createTextMeasurer();
    const a = measure('cache me', style);
    expect(measure('cache me', style)).toBe(a); // same object → cache hit
    const b = measure('cache me', { ...style, fontSize: 20 });
    expect(b.width).toBeGreaterThan(a.width); // different font key → fresh measure
  });
});

describe('wrapText', () => {
  it('wraps at word boundaries within maxWidth', () => {
    const lines = wrapText('one two three four', 40, style);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(estimateTextSize(line, style).width).toBeLessThanOrEqual(40);
    }
    expect(lines.join(' ')).toBe('one two three four');
  });

  it('keeps short text on one line and honors explicit newlines', () => {
    expect(wrapText('hi', 100, style)).toEqual(['hi']);
    expect(wrapText('a\nb', 100, style)).toEqual(['a', 'b']);
  });

  it('breaks a single over-long word by character', () => {
    const lines = wrapText('Superlongunbreakableword', 30, style);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('Superlongunbreakableword');
  });
});

describe('ellipsize', () => {
  it('returns fitting text unchanged', () => {
    expect(ellipsize('short', 1000, style)).toBe('short');
  });

  it('truncates with an ellipsis to fit', () => {
    const result = ellipsize('a very long label that cannot fit', 50, style);
    expect(result.endsWith('…')).toBe(true);
    expect(estimateTextSize(result, style).width).toBeLessThanOrEqual(50);
  });

  it('degrades to a bare ellipsis at tiny widths', () => {
    expect(ellipsize('word', 1, style)).toBe('…');
  });
});
