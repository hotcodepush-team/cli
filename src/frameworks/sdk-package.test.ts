import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as packageManagerModule from '../utils/package-manager.js';
import { runCommandLineVisibly } from '../utils/package-manager.js';
import {
  checkSdkPackage,
  installSdkPackage,
  readSdkDependencyVersion,
} from './sdk-package.js';

vi.mock('../utils/package-manager.js', async importOriginal => ({
  ...(await importOriginal<typeof packageManagerModule>()),
  runCommandLineVisibly: vi.fn(),
}));

const DEPENDENCY_PACKAGE_NAME = '@hotcodepush/example-dependency';

const PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/example-sdk/@hotcodepush/example-sdk@0123abc';

const SDK_PACKAGE_NAME = '@hotcodepush/example-sdk';

describe('sdk-package', () => {
  let directoryPath = '';

  beforeEach(() => {
    directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-sdk-'));
  });

  afterEach(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });

  describe('checkSdkPackage', () => {
    it.each([
      ['package_missing', 'is not in package.json', {}],
      [
        'package_not_installed',
        'is declared but not in node_modules',
        { [SDK_PACKAGE_NAME]: '1.0.0' },
      ],
    ])(
      'should fail the package with `%s` when it %s',
      // eslint-disable-next-line max-params -- it.each passes each row's cells as separate arguments.
      (code, _, dependencies) => {
        expect(
          checkSdkPackage(
            { directoryPath, packageJson: { dependencies } },
            SDK_PACKAGE_NAME,
          ),
        ).toMatchObject({ check: 'package', code, status: 'failed' });
      },
    );
  });

  describe('installSdkPackage', () => {
    it('should install the package from its spec with the package manager of the project and answer the sentence the step prints', () => {
      expect(
        installSdkPackage(directoryPath, {
          packageName: SDK_PACKAGE_NAME,
          packageSpec: PACKAGE_SPEC,
        }),
      ).toBe(`Installed ${SDK_PACKAGE_NAME} from ${PACKAGE_SPEC}.`);
      expect(runCommandLineVisibly).toHaveBeenCalledWith(
        { args: ['install', '--save-exact', PACKAGE_SPEC], command: 'npm' },
        directoryPath,
      );
    });
  });

  describe('readSdkDependencyVersion', () => {
    function writePackage(packagePath: string, version: string): void {
      mkdirSync(packagePath, { recursive: true });
      writeFileSync(
        join(packagePath, 'package.json'),
        JSON.stringify({ version }),
      );
    }

    it("should read the version where the sdk package resolves it when an isolated install keeps it out of the project's node_modules", () => {
      // In pnpm's layout, the project's node_modules links the SDK package into the store, beside its dependencies.
      const storePath = join(
        directoryPath,
        'node_modules',
        '.pnpm',
        'example-sdk@0.1.0',
        'node_modules',
      );
      writePackage(join(storePath, SDK_PACKAGE_NAME), '0.1.0');
      writePackage(join(storePath, DEPENDENCY_PACKAGE_NAME), '0.2.0');
      mkdirSync(join(directoryPath, 'node_modules', '@hotcodepush'));
      symlinkSync(
        join(storePath, SDK_PACKAGE_NAME),
        join(directoryPath, 'node_modules', SDK_PACKAGE_NAME),
        'junction',
      );

      expect(
        readSdkDependencyVersion(directoryPath, {
          packageName: DEPENDENCY_PACKAGE_NAME,
          sdkPackageName: SDK_PACKAGE_NAME,
        }),
      ).toBe('0.2.0');
    });

    it('should answer none when the sdk package is not installed', () => {
      expect(
        readSdkDependencyVersion(directoryPath, {
          packageName: DEPENDENCY_PACKAGE_NAME,
          sdkPackageName: SDK_PACKAGE_NAME,
        }),
      ).toBeUndefined();
    });
  });
});
