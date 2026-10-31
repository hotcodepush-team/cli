import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { createReadStream } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { InvalidParameterError } from './errors.js';

export interface BundleFile {
  filePath: string;
  path: string;
  sha256: string;
  sizeBytes: number;
}

const DEAD_LINK_ERROR_CODES = new Set(['ELOOP', 'ENOENT']);

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

// The manifest names files by this hash, and the upload path uses it too.
export async function computeFileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

// Source maps belong in the error tracker and dotfiles are tooling, so neither ships to devices.
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
      `The directory ${directoryPath} from --path does not exist.`,
    );
  }
}

// Follows links like a web server, so the bundle carries what the native build copies through a link.
// A link back into a directory the walk is inside ends there instead of looping.
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

// A link that points nowhere or to itself has no content to serve.
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
