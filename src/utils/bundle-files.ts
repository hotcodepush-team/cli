import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { createReadStream } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
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

const DEAD_LINK_ERROR_CODES = new Set(['ELOOP', 'ENOENT']);

/**
 * Every file under the input except source maps and dotfiles — neither ships to devices — hashed and sorted by path.
 */
export async function collectBundleFiles(
  directoryPath: string,
): Promise<BundleFile[]> {
  await assertDirectory(directoryPath);
  const filePaths = await collectFilePaths(directoryPath, new Set());
  const collectedFiles = await Promise.all(
    filePaths
      .map(filePath => ({
        filePath,
        path: relative(directoryPath, filePath).split(sep).join('/'),
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

/**
 * The files under a directory as a web server serves them: a link counts as what it points to, and a linked directory
 * is walked like any other, so the bundle carries what the native build copies through the link.
 * A link back into a directory the walk is inside ends there instead of looping.
 */
async function collectFilePaths(
  directoryPath: string,
  ancestorRealPaths: ReadonlySet<string>,
): Promise<string[]> {
  const realDirectoryPath = await realpath(directoryPath);
  if (ancestorRealPaths.has(realDirectoryPath)) {
    return [];
  }
  const walkedRealPaths = new Set([...ancestorRealPaths, realDirectoryPath]);
  const entryNames = await readdir(directoryPath);
  const collectedFilePaths = await Promise.all(
    entryNames.map(async entryName => {
      const entryPath = join(directoryPath, entryName);
      const stats = await readEntryStats(entryPath);
      if (stats?.isDirectory()) {
        return collectFilePaths(entryPath, walkedRealPaths);
      }
      return stats?.isFile() ? [entryPath] : [];
    }),
  );
  return collectedFilePaths.flat();
}

function isDeadLinkError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    DEAD_LINK_ERROR_CODES.has(error.code)
  );
}

/**
 * The stats of what an entry is or links to; none for a link that points nowhere or to itself, which has no content to serve.
 */
async function readEntryStats(entryPath: string): Promise<Stats | undefined> {
  try {
    return await stat(entryPath);
  } catch (error) {
    if (isDeadLinkError(error)) {
      return undefined;
    }
    throw error;
  }
}
