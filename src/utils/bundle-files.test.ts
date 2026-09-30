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

  describe('when the build holds links', () => {
    let inputPath = '';

    beforeEach(() => {
      inputPath = join(directoryPath, 'dist');
      mkdirSync(inputPath);
      writeFileSync(join(inputPath, 'index.html'), '<h1>v1</h1>');
    });

    async function collectPaths(): Promise<string[]> {
      return (await collectBundleFiles(inputPath)).map(({ path }) => path);
    }

    it("should collect a linked file and every linked directory's files under the link's path", async () => {
      mkdirSync(join(directoryPath, 'shared'));
      writeFileSync(join(directoryPath, 'shared', 'logo.svg'), '<svg/>');
      writeFileSync(join(directoryPath, 'asset.js'), 'console.log(1)');
      symlinkSync(join(directoryPath, 'asset.js'), join(inputPath, 'asset.js'));
      symlinkSync(join(directoryPath, 'shared'), join(inputPath, 'images'));
      symlinkSync(join(directoryPath, 'shared'), join(inputPath, 'icons'));

      const collectedFiles = await collectBundleFiles(inputPath);

      expect(
        collectedFiles.map(({ path, sizeBytes }) => ({ path, sizeBytes })),
      ).toEqual([
        { path: 'asset.js', sizeBytes: 14 },
        { path: 'icons/logo.svg', sizeBytes: 6 },
        { path: 'images/logo.svg', sizeBytes: 6 },
        { path: 'index.html', sizeBytes: 11 },
      ]);
    });

    it('should end a link back into a directory it walks instead of looping', async () => {
      mkdirSync(join(inputPath, 'assets'));
      writeFileSync(join(inputPath, 'assets', 'app.js'), 'console.log(1)');
      symlinkSync(inputPath, join(inputPath, 'assets', 'root'));

      expect(await collectPaths()).toEqual(['assets/app.js', 'index.html']);
    });

    it('should skip a link that points nowhere', async () => {
      symlinkSync(join(directoryPath, 'missing.js'), join(inputPath, 'app.js'));

      expect(await collectPaths()).toEqual(['index.html']);
    });
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
