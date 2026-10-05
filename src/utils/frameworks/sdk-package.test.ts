import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as packageManagerModule from '../package-manager.js';
import { runCommandLineVisibly } from '../package-manager.js';
import { installSdkPackage } from './sdk-package.js';

vi.mock('../package-manager.js', async importOriginal => ({
  ...(await importOriginal<typeof packageManagerModule>()),
  runCommandLineVisibly: vi.fn(),
}));

const PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/example-sdk/@hotcodepush/example-sdk@0123abc';

describe('sdk-package', () => {
  let directoryPath = '';

  beforeEach(() => {
    directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-sdk-'));
  });

  afterEach(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });

  describe('installSdkPackage', () => {
    it('should install the package from its spec with the package manager of the project and answer the sentence the step prints', () => {
      expect(
        installSdkPackage(
          directoryPath,
          '@hotcodepush/example-sdk',
          PACKAGE_SPEC,
        ),
      ).toBe(`installed @hotcodepush/example-sdk from ${PACKAGE_SPEC}`);
      expect(runCommandLineVisibly).toHaveBeenCalledWith(
        { args: ['install', '--save-exact', PACKAGE_SPEC], command: 'npm' },
        directoryPath,
      );
    });
  });
});
