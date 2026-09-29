import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { InvalidParameterError } from './errors.js';

/**
 * One file of a web build as the manifest lists it, plus where it lies on disk.
 */
export interface BundleFile {
  filePath: string;
  path: string;
  sha256: string;
  sizeBytes: number;
}

/**
 * Every file under the input except source maps and dotfiles — neither ships to devices — hashed and sorted by path.
 */
export async function collectBundleFiles(
  directoryPath: string,
): Promise<BundleFile[]> {
  await assertDirectory(directoryPath);
  const entries = await readdir(directoryPath, {
    recursive: true,
    withFileTypes: true,
  });
  const collectedFiles = await Promise.all(
    entries
      .filter(entry => entry.isFile())
      .map(entry => ({
        filePath: join(entry.parentPath, entry.name),
        path: relative(directoryPath, join(entry.parentPath, entry.name))
          .split(sep)
          .join('/'),
      }))
      .filter(({ path }) => isShipped(path))
      .map(async ({ filePath, path }) => ({
        filePath,
        path,
        sha256: await computeFileSha256(filePath),
        sizeBytes: (await stat(filePath)).size,
      })),
  );
  return collectedFiles.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The SHA-256 of a file's raw content, streamed: the hash the manifest names and the path of its upload.
 */
export async function computeFileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

/**
 * Source maps belong in the error tracker and dotfiles are tooling; neither ships to devices.
 */
export function isShipped(path: string): boolean {
  return (
    !path.endsWith('.map') &&
    !path.split('/').some(segment => segment.startsWith('.'))
  );
}

async function assertDirectory(directoryPath: string): Promise<void> {
  const isDirectory = await stat(directoryPath)
    .then(stats => stats.isDirectory())
    .catch(() => false);
  if (!isDirectory) {
    throw new InvalidParameterError(
      `--path: there is no directory at ${directoryPath}`,
      undefined,
    );
  }
}
