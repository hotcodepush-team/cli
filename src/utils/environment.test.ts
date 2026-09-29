import { afterEach, describe, expect, it, vi } from 'vitest';
import { isColorEnabled, isInteractive } from './environment.js';

const originalStdinIsTty = process.stdin.isTTY;
const originalStdoutIsTty = process.stdout.isTTY;

function stubIsTty(isTty: boolean): void {
  process.stdin.isTTY = isTty;
  process.stdout.isTTY = isTty;
}

describe('environment', () => {
  afterEach(() => {
    process.stdin.isTTY = originalStdinIsTty;
    process.stdout.isTTY = originalStdoutIsTty;
  });

  describe('isInteractive', () => {
    it('should be interactive when on a TTY outside CI', () => {
      stubIsTty(true);
      vi.stubEnv('CI', undefined);

      expect(isInteractive({})).toBe(true);
    });

    it('should not be interactive when there is no TTY', () => {
      stubIsTty(false);
      vi.stubEnv('CI', undefined);

      expect(isInteractive({})).toBe(false);
    });

    it('should not be interactive when CI is set, even on a TTY', () => {
      stubIsTty(true);
      vi.stubEnv('CI', 'true');

      expect(isInteractive({})).toBe(false);
    });

    it('should not be interactive when --json is passed', () => {
      stubIsTty(true);
      vi.stubEnv('CI', undefined);

      expect(isInteractive({ json: true })).toBe(false);
    });

    it('should not be interactive when --yes is passed', () => {
      stubIsTty(true);
      vi.stubEnv('CI', undefined);

      expect(isInteractive({ yes: true })).toBe(false);
    });
  });

  describe('isColorEnabled', () => {
    it('should enable colour when the stream is a TTY', () => {
      stubIsTty(true);
      vi.stubEnv('NO_COLOR', undefined);
      vi.stubEnv('TERM', 'xterm-256color');

      expect(isColorEnabled(process.stdout)).toBe(true);
    });

    it('should disable colour when the stream is not a TTY', () => {
      stubIsTty(false);
      vi.stubEnv('NO_COLOR', undefined);
      vi.stubEnv('TERM', 'xterm-256color');

      expect(isColorEnabled(process.stdout)).toBe(false);
    });

    it('should disable colour when NO_COLOR is set', () => {
      stubIsTty(true);
      vi.stubEnv('NO_COLOR', '1');
      vi.stubEnv('TERM', 'xterm-256color');

      expect(isColorEnabled(process.stdout)).toBe(false);
    });

    it('should enable colour when NO_COLOR is empty', () => {
      stubIsTty(true);
      vi.stubEnv('NO_COLOR', '');
      vi.stubEnv('TERM', 'xterm-256color');

      expect(isColorEnabled(process.stdout)).toBe(true);
    });

    it('should disable colour when TERM is dumb', () => {
      stubIsTty(true);
      vi.stubEnv('NO_COLOR', undefined);
      vi.stubEnv('TERM', 'dumb');

      expect(isColorEnabled(process.stdout)).toBe(false);
    });
  });
});
