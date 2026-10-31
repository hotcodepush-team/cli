import { existsSync } from 'node:fs';
import { readdir, readFile, realpath } from 'node:fs/promises';
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

// Errors for a path that holds nothing of the kind asked for.
const ABSENT_ERROR_CODES = new Set(['EISDIR', 'ENOENT', 'ENOTDIR']);

// The extra fingerprint paths are relative to the project root and may reach a sibling workspace through `..`.
export async function readFingerprint(
  projectDirectoryPath: string,
  extraFingerprintPaths: readonly string[],
): Promise<string> {
  return computeFingerprint(
    await readProjectFingerprintContributors(
      projectDirectoryPath,
      extraFingerprintPaths,
    ),
  );
}

export function hasLockfile(projectDirectoryPath: string): boolean {
  return findLockfileDirectoryPath(projectDirectoryPath) !== undefined;
}

// The recipe reads from the nearest lockfile directory, which is the monorepo root where the workspace installs.
// It resolves the extra paths against the project and refuses any outside that directory.
export async function readProjectFingerprintContributors(
  projectDirectoryPath: string,
  extraFingerprintPaths: readonly string[],
): Promise<FingerprintContributors> {
  const lockfileDirectoryPath =
    findLockfileDirectoryPath(projectDirectoryPath) ?? projectDirectoryPath;
  const projectPath = relative(lockfileDirectoryPath, projectDirectoryPath)
    .split(sep)
    .join('/');
  try {
    return await readFingerprintContributors({
      extraFingerprintPaths,
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
    readRealPath: path =>
      readAbsentAsNull(async () => {
        const [rootRealPath, targetRealPath] = await Promise.all([
          realpath(rootDirectoryPath),
          realpath(join(rootDirectoryPath, path)),
        ]);
        // A link out of the root yields a path starting with `..`, which the recipe refuses.
        return relative(rootRealPath, targetRealPath).split(sep).join('/');
      }),
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
