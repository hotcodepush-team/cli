import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeFingerprint } from '@hotcodepush/protocol/fingerprint';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CAPACITOR_FINGERPRINT,
  CAPACITOR_LOCKED_PACKAGES,
  writeFingerprintInputs,
} from '../../test/capacitor-project.js';
import { readFingerprint } from './fingerprint.js';

describe('fingerprint', () => {
  let projectDirectoryPath = '';

  beforeEach(() => {
    projectDirectoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-fp-'));
  });

  afterEach(() => {
    rmSync(projectDirectoryPath, { force: true, recursive: true });
  });

  /**
   * A workspace at `apps/mobile` under the lockfile's directory, declaring the native package the root installs; its path.
   */
  function writeWorkspaceProject(): string {
    const appDirectoryPath = join(projectDirectoryPath, 'apps', 'mobile');
    mkdirSync(appDirectoryPath, { recursive: true });
    writeFileSync(
      join(appDirectoryPath, 'package.json'),
      JSON.stringify({ dependencies: { '@capacitor/core': '8.0.0' } }),
    );
    return appDirectoryPath;
  }

  it('should hash the native packages the lockfile installs, and nothing else', async () => {
    writeFingerprintInputs(projectDirectoryPath);

    expect(await readFingerprint(projectDirectoryPath, [])).toBe(
      CAPACITOR_FINGERPRINT,
    );
  });

  it('should hash the native sources hotcodepush.json declares beside the packages', async () => {
    writeFingerprintInputs(projectDirectoryPath);
    mkdirSync(join(projectDirectoryPath, 'native', 'plugin'), {
      recursive: true,
    });
    writeFileSync(
      join(projectDirectoryPath, 'native', 'plugin', 'Plugin.swift'),
      'import Capacitor\n',
    );

    expect(await readFingerprint(projectDirectoryPath, ['native'])).toBe(
      computeFingerprint({
        nativeSources: [
          {
            path: 'native/plugin/Plugin.swift',
            sha256: createHash('sha256')
              .update('import Capacitor\n')
              .digest('hex'),
          },
        ],
        packages: CAPACITOR_LOCKED_PACKAGES,
      }),
    );
  });

  it("should read the workspace root's lockfile above a project directory without one, the native sources relative to the project", async () => {
    writeFingerprintInputs(projectDirectoryPath);
    const appDirectoryPath = writeWorkspaceProject();
    mkdirSync(join(appDirectoryPath, 'native'));
    writeFileSync(
      join(appDirectoryPath, 'native', 'Plugin.swift'),
      'import Capacitor\n',
    );

    expect(await readFingerprint(appDirectoryPath, ['native'])).toBe(
      computeFingerprint({
        nativeSources: [
          {
            path: 'apps/mobile/native/Plugin.swift',
            sha256: createHash('sha256')
              .update('import Capacitor\n')
              .digest('hex'),
          },
        ],
        packages: CAPACITOR_LOCKED_PACKAGES,
      }),
    );
  });

  it("should hash a sibling workspace's native source named through ..", async () => {
    writeFingerprintInputs(projectDirectoryPath);
    const appDirectoryPath = writeWorkspaceProject();
    mkdirSync(join(projectDirectoryPath, 'apps', 'shared'));
    writeFileSync(
      join(projectDirectoryPath, 'apps', 'shared', 'Bridge.swift'),
      'import Capacitor\n',
    );

    expect(await readFingerprint(appDirectoryPath, ['../shared'])).toBe(
      computeFingerprint({
        nativeSources: [
          {
            path: 'apps/shared/Bridge.swift',
            sha256: createHash('sha256')
              .update('import Capacitor\n')
              .digest('hex'),
          },
        ],
        packages: CAPACITOR_LOCKED_PACKAGES,
      }),
    );
  });

  it('should hash a native source under the path its symbolic link resolves to', async () => {
    writeFingerprintInputs(projectDirectoryPath);
    const appDirectoryPath = writeWorkspaceProject();
    const targetDirectoryPath = join(
      projectDirectoryPath,
      'packages',
      'scanner',
    );
    mkdirSync(targetDirectoryPath, { recursive: true });
    writeFileSync(
      join(targetDirectoryPath, 'Bridge.swift'),
      'import Capacitor\n',
    );
    symlinkSync(
      targetDirectoryPath,
      join(appDirectoryPath, 'native'),
      'junction',
    );

    expect(await readFingerprint(appDirectoryPath, ['native'])).toBe(
      computeFingerprint({
        nativeSources: [
          {
            path: 'packages/scanner/Bridge.swift',
            sha256: createHash('sha256')
              .update('import Capacitor\n')
              .digest('hex'),
          },
        ],
        packages: CAPACITOR_LOCKED_PACKAGES,
      }),
    );
  });

  it("should refuse a native source when its symbolic link leads out of the lockfile's directory", async () => {
    writeFingerprintInputs(projectDirectoryPath);
    const outsideDirectoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-fp-'));
    symlinkSync(
      outsideDirectoryPath,
      join(projectDirectoryPath, 'native'),
      'junction',
    );

    try {
      await expect(
        readFingerprint(projectDirectoryPath, ['native']),
      ).rejects.toMatchObject({
        code: 'E_FINGERPRINT_UNAVAILABLE',
        message:
          "the fingerprint cannot be computed: the native source native is not inside the lockfile's directory",
      });
    } finally {
      rmSync(outsideDirectoryPath, { force: true, recursive: true });
    }
  });

  it('should refuse a native source when nothing is at its path', async () => {
    writeFingerprintInputs(projectDirectoryPath);

    await expect(
      readFingerprint(projectDirectoryPath, ['native']),
    ).rejects.toMatchObject({
      code: 'E_FINGERPRINT_UNAVAILABLE',
      message:
        'the fingerprint cannot be computed: the native source native does not exist',
    });
  });

  it('should throw E_FINGERPRINT_UNAVAILABLE when the project has no lockfile', async () => {
    await expect(
      readFingerprint(projectDirectoryPath, []),
    ).rejects.toMatchObject({
      code: 'E_FINGERPRINT_UNAVAILABLE',
      message:
        'the fingerprint cannot be computed: the project has no lockfile; commit one of package-lock.json, pnpm-lock.yaml, yarn.lock',
    });
  });
});
