import { describe, expect, it } from 'vitest';
import { quotePosixWord } from './posix-quote.js';

describe('quotePosixWord', () => {
  it('should wrap the text in single quotes', () => {
    expect(quotePosixWord('app create')).toBe("'app create'");
  });

  it('should close, escape and reopen the quote around a single quote', () => {
    expect(quotePosixWord("the app's name")).toBe("'the app'\\''s name'");
  });
});
