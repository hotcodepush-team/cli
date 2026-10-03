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
  readFingerprintContributors,
} from '@hotcodepush/protocol/fingerprint';
import { FingerprintUnavailableError } from './errors.js';

/** What the file system answers for a path that holds nothing of the kind asked for. */
const ABSENT_ERROR_CODES = new Set(['EISDIR', 'ENOENT', 'ENOTDIR']);

/** The lockfiles the recipe reads, which mark the directory it reads from; the recipe does not export its list. */
const LOCKFILE_NAMES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];

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
 * What the project's fingerprint hashes: the native packages with their versions and the declared native sources.
 * The recipe reads from the nearest directory with a lockfile walking up from the project root, a monorepo's root
 * where the workspace installs, and the native sources are given to it relative to that directory.
 */
export async function readProjectFingerprintContributors(
  projectDirectoryPath: string,
  nativeSourcePaths: readonly string[],
): Promise<FingerprintContributors> {
  const lockfileDirectoryPath =
    findLockfileDirectoryPath(projectDirectoryPath) ?? projectDirectoryPath;
  const projectPathFromLockfileDirectory = relative(
    lockfileDirectoryPath,
    projectDirectoryPath,
  )
    .split(sep)
    .join('/');
  try {
    return await readFingerprintContributors({
      // joined as text, never normalized, so the recipe still refuses a `..` segment the file declares
      nativeSourcePaths: nativeSourcePaths.map(path =>
        projectPathFromLockfileDirectory === ''
          ? path
          : `${projectPathFromLockfileDirectory}/${path}`,
      ),
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
