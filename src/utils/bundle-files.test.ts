import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectBundleFiles, isShipped } from './bundle-files.js';
import { InvalidParameterError } from './errors.js';

describe('bundle files', () => {
  let directoryPath = '';

  beforeEach(() => {
    directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-files-'));
  });

  afterEach(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });

  it('should collect every shipped file hashed and sorted by path, skipping source maps and dotfiles', async () => {
    mkdirSync(join(directoryPath, 'assets'));
    mkdirSync(join(directoryPath, '.well-known'));
    writeFileSync(join(directoryPath, 'index.html'), '<h1>v1</h1>');
    writeFileSync(join(directoryPath, 'assets', 'app.js'), 'console.log(1)');
    writeFileSync(join(directoryPath, 'assets', 'app.js.map'), '{}');
    writeFileSync(join(directoryPath, '.DS_Store'), 'x');
    writeFileSync(join(directoryPath, '.well-known', 'a.txt'), 'x');

    const collectedFiles = await collectBundleFiles(directoryPath);

    expect(
      collectedFiles.map(({ path, sha256, sizeBytes }) => ({
        path,
        sha256,
        sizeBytes,
      })),
    ).toEqual([
      {
        path: 'assets/app.js',
        sha256: createHash('sha256').update('console.log(1)').digest('hex'),
        sizeBytes: 14,
      },
      {
        path: 'index.html',
        sha256: createHash('sha256').update('<h1>v1</h1>').digest('hex'),
        sizeBytes: 11,
      },
    ]);
  });

  it('should refuse a path that is no directory', async () => {
    await expect(
      collectBundleFiles(join(directoryPath, 'missing')),
    ).rejects.toThrow(InvalidParameterError);
  });

  it('should tell a shipped path from a source map or a dotfile', () => {
    expect(isShipped('assets/index-B4x.js')).toBe(true);
    expect(isShipped('assets/index-B4x.js.map')).toBe(false);
    expect(isShipped('.htaccess')).toBe(false);
    expect(isShipped('sub/.hidden/file.js')).toBe(false);
  });
});
