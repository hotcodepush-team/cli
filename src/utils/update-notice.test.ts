import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isNewerVersion,
  printUpdateNotice,
  refreshLatestKnownVersion,
} from './update-notice.js';
import { readUserConfig, writeUserConfig } from './user-config.js';

const LATEST_VERSION_URL = 'https://registry.npmjs.org/hotcodepush/latest';

describe('update notice', () => {
  const fetchLatestVersion = vi.fn(async () =>
    Response.json({ name: 'hotcodepush', version: '1.2.0' }),
  );
  let temporaryDirectoryPath = '';

  beforeEach(() => {
    temporaryDirectoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-'));
    vi.stubEnv('APPDATA', temporaryDirectoryPath);
    vi.stubEnv('CI', undefined);
    vi.stubEnv('HOTCODEPUSH_NO_UPDATE_NOTIFIER', undefined);
    vi.stubEnv('XDG_CONFIG_HOME', temporaryDirectoryPath);
    vi.stubGlobal('fetch', fetchLatestVersion);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(temporaryDirectoryPath, { force: true, recursive: true });
  });

  describe('refreshLatestKnownVersion', () => {
    it('should ask the registry when the last check is a day old and keep the version beside the time', async () => {
      writeUserConfig({
        apiUrl: 'https://api.example.com',
        lastUpdateCheckAt: new Date(
          Date.now() - 25 * 60 * 60 * 1000,
        ).toISOString(),
      });

      await refreshLatestKnownVersion();

      expect(fetchLatestVersion).toHaveBeenCalledWith(
        LATEST_VERSION_URL,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(readUserConfig()).toEqual({
        apiUrl: 'https://api.example.com',
        lastUpdateCheckAt: expect.any(String),
        latestKnownVersion: '1.2.0',
      });
    });

    it('should ask nothing within a day of the last check', async () => {
      writeUserConfig({ lastUpdateCheckAt: new Date().toISOString() });

      await refreshLatestKnownVersion();

      expect(fetchLatestVersion).not.toHaveBeenCalled();
    });

    it('should remember a failed check, so the next one waits a day, and keep the version known before', async () => {
      fetchLatestVersion.mockRejectedValueOnce(new TypeError('fetch failed'));
      writeUserConfig({ latestKnownVersion: '1.1.0' });

      await refreshLatestKnownVersion();

      expect(readUserConfig()).toEqual({
        lastUpdateCheckAt: expect.any(String),
        latestKnownVersion: '1.1.0',
      });
    });

    it.each([
      ['in CI', 'CI', 'true'],
      [
        'under HOTCODEPUSH_NO_UPDATE_NOTIFIER=1',
        'HOTCODEPUSH_NO_UPDATE_NOTIFIER',
        '1',
      ],
    ])('should ask nothing %s', async (_, variableName, value) => {
      vi.stubEnv(variableName, value);

      await refreshLatestKnownVersion();

      expect(fetchLatestVersion).not.toHaveBeenCalled();
    });
  });

  describe('printUpdateNotice', () => {
    it('should print one line on stderr when a newer version is known', () => {
      const stderrWrite = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
      writeUserConfig({ latestKnownVersion: '1.2.0' });

      printUpdateNotice();

      expect(stderrWrite.mock.calls).toEqual([
        ['HotCodePush CLI 1.2.0 is available; you run 0.0.0.\n'],
      ]);
    });

    it('should print nothing when the version known is the one running', () => {
      const stderrWrite = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
      writeUserConfig({ latestKnownVersion: '0.0.0' });

      printUpdateNotice();

      expect(stderrWrite).not.toHaveBeenCalled();
    });

    it('should print nothing in CI', () => {
      vi.stubEnv('CI', 'true');
      const stderrWrite = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
      writeUserConfig({ latestKnownVersion: '1.2.0' });

      printUpdateNotice();

      expect(stderrWrite).not.toHaveBeenCalled();
    });
  });

  describe('isNewerVersion', () => {
    it.each([
      ['1.10.0', '1.9.0', true],
      ['2.0.0', '10.0.0', false],
      ['1.2.3', '1.2.3', false],
      ['1.2.4-rc.1', '1.2.3', true],
      ['latest', '1.2.3', false],
    ])(
      'should answer whether %s is newer than %s: %s',
      (candidate, current, isNewer) => {
        expect(isNewerVersion(candidate, current)).toBe(isNewer);
      },
    );
  });
});
