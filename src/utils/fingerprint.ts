import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type {
  FingerprintContributors,
  ProjectReader,
} from '@hotcodepush/protocol/fingerprint';
import {
  computeFingerprint,
  FingerprintError,
  LOCKFILE_NAMES,
  readFingerprintContributors,
} from '@hotcodepush/protocol/fingerprint';
import { FingerprintUnavailableError } from './errors.js';

/** What the file system answers for a path that holds nothing of the kind asked for. */
const ABSENT_ERROR_CODES = new Set(['EISDIR', 'ENOENT', 'ENOTDIR']);

/**
 * The project's `fp1` fingerprint, the native contract's hash, from its committed lockfile, its installed packages
 * and the custom native sources hotcodepush.json declares, relative to the project root.
 */
export async function readFingerprint(
  projectDirectoryPath: string,
  nativeSourcePaths: readonly string[],
): Promise<string> {
  return computeFingerprint(
    await readProjectFingerprintContributors(
      projectDirectoryPath,
      nativeSourcePaths,
    ),
  );
}

/**
 * Whether a lockfile lies in the project root or a directory above it, the one the fingerprint is computed from.
 */
export function hasLockfile(projectDirectoryPath: string): boolean {
  return findLockfileDirectoryPath(projectDirectoryPath) !== undefined;
}

/**
 * What the project's fingerprint hashes: the native packages with their versions and the declared native sources.
 * The recipe reads from the nearest directory with a lockfile walking up from the project root, a monorepo's root
 * where the workspace installs, and is given the project's path and its native sources relative to that directory.
 */
export async function readProjectFingerprintContributors(
  projectDirectoryPath: string,
  nativeSourcePaths: readonly string[],
): Promise<FingerprintContributors> {
  const lockfileDirectoryPath =
    findLockfileDirectoryPath(projectDirectoryPath) ?? projectDirectoryPath;
  const projectPath = relative(lockfileDirectoryPath, projectDirectoryPath)
    .split(sep)
    .join('/');
  try {
    return await readFingerprintContributors({
      // joined as text, never normalized, so the recipe still refuses a `..` segment the file declares
      nativeSourcePaths: nativeSourcePaths.map(path =>
        projectPath === '' ? path : `${projectPath}/${path}`,
      ),
      projectPath,
      reader: createProjectReader(lockfileDirectoryPath),
    });
  } catch (error) {
    if (error instanceof FingerprintError) {
      throw new FingerprintUnavailableError(error);
    }
    throw error;
  }
}

/**
 * The nearest directory holding a lockfile walking up from the given one, the way `hotcodepush.json` is found.
 */
function findLockfileDirectoryPath(directoryPath: string): string | undefined {
  if (
    LOCKFILE_NAMES.some(fileName => existsSync(join(directoryPath, fileName)))
  ) {
    return directoryPath;
  }
  const parentDirectoryPath = dirname(directoryPath);
  return parentDirectoryPath === directoryPath
    ? undefined
    : findLockfileDirectoryPath(parentDirectoryPath);
}

function createProjectReader(rootDirectoryPath: string): ProjectReader {
  return {
    readDirectory: path =>
      readAbsentAsNull(async () =>
        (
          await readdir(join(rootDirectoryPath, path), {
            withFileTypes: true,
          })
        ).map(entry => ({
          isDirectory: entry.isDirectory(),
          name: entry.name,
        })),
      ),
    readFile: path =>
      readAbsentAsNull(() => readFile(join(rootDirectoryPath, path))),
  };
}

async function readAbsentAsNull<TValue>(
  read: () => Promise<TValue>,
): Promise<TValue | null> {
  try {
    return await read();
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      ABSENT_ERROR_CODES.has(String(error.code))
    ) {
      return null;
    }
    throw error;
  }
}
