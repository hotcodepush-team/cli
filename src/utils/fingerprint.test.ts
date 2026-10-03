import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
