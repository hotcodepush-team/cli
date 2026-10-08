import { readFile } from 'node:fs/promises';
import type {
  ExtraFingerprintFile,
  FingerprintContributors,
  LockedPackage,
} from '@hotcodepush/protocol/fingerprint';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { InvalidParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable } from '../../utils/output.js';
import { promptText } from '../../utils/prompts.js';

/**
 * A file under the extra fingerprint paths as each side hashed it, null on the side without it.
 */
interface ExtraFingerprintPathChange {
  after: string | null;
  before: string | null;
  path: string;
}

/**
 * What moved between two fingerprints: each package version and extra fingerprint path one side has and the other lacks.
 */
interface FingerprintDiff {
  extraFingerprintPaths: ExtraFingerprintPathChange[];
  packages: PackageChange[];
}

/**
 * A package's version and integrity as one side installs it.
 */
type InstalledVersion = Omit<LockedPackage, 'name'>;

/**
 * A package version one side installs, paired with one the other side installs instead, null where it installs none.
 */
interface PackageChange {
  after: InstalledVersion | null;
  before: InstalledVersion | null;
  name: string;
}

const FINGERPRINT_FILE_FIX =
  'write each file with "hotcodepush fingerprint --json > <file>", the earlier one at the commit of the store build.';

/**
 * What `hotcodepush fingerprint --json` writes: the hash and the contributors behind it.
 */
const FingerprintFileSchema = z.object({
  fingerprint: z.string(),
  extraFingerprintPaths: z.array(
    z.object({ path: z.string(), sha256: z.string() }),
  ),
  packages: z.array(
    z.object({
      integrity: z.string().nullable(),
      name: z.string(),
      version: z.string(),
    }),
  ),
});

type FingerprintFile = z.infer<typeof FingerprintFileSchema>;

export default defineCommand({
  description:
    'Print the packages and extra fingerprint paths added, removed or moved between <file-a> and <file-b>, two files written by fingerprint --json, the earlier first; local, no login.',
  examples: [
    'hotcodepush fingerprint diff store-build.json current.json',
    'hotcodepush fingerprint diff store-build.json current.json --json',
  ],
  args: z.array(z.string()),
  options: defineCommandOptions({}),
  action: async (options, args) => {
    if (args.length > 2) {
      throw new InvalidParameterError(
        `${args.slice(2).join(' ')}: fingerprint diff compares two files, <file-a> and <file-b>`,
        undefined,
      );
    }
    const beforeFile = await readFingerprintFile(
      '<file-a>',
      args[0] ??
        (await promptText(
          '<file-a>',
          "Which file holds the earlier fingerprint, the store build's?",
          options,
        )),
    );
    const afterFile = await readFingerprintFile(
      '<file-b>',
      args[1] ??
        (await promptText(
          '<file-b>',
          'Which file holds the later fingerprint?',
          options,
        )),
    );
    const diff = resolveFingerprintDiff(beforeFile, afterFile);
    if (options.json) {
      printJson(diff);
      return;
    }
    if (diff.packages.length === 0 && diff.extraFingerprintPaths.length === 0) {
      console.log(`Nothing moved: both files hold ${beforeFile.fingerprint}.`);
      return;
    }
    printTable({
      emptyText: 'No package moved.',
      headers: ['PACKAGE', 'BEFORE', 'AFTER'],
      nextOffset: null,
      rows: diff.packages.map(({ after, before, name }) => [
        name,
        resolveInstalledVersionText(before, after),
        resolveInstalledVersionText(after, before),
      ]),
    });
    if (diff.extraFingerprintPaths.length > 0) {
      printTable({
        emptyText: '',
        headers: ['EXTRA FINGERPRINT PATH', 'BEFORE', 'AFTER'],
        nextOffset: null,
        rows: diff.extraFingerprintPaths.map(({ after, before, path }) => [
          path,
          before ?? 'none',
          after ?? 'none',
        ]),
      });
    }
  },
});

async function readFingerprintFile(
  argumentName: string,
  filePath: string,
): Promise<FingerprintFile> {
  const text = await readFile(filePath, 'utf8').catch((error: unknown) => {
    throw new InvalidParameterError(
      `${argumentName}: cannot read ${filePath}`,
      error,
      FINGERPRINT_FILE_FIX,
    );
  });
  const parsedFile = FingerprintFileSchema.safeParse(parseJson(text));
  if (!parsedFile.success) {
    throw new InvalidParameterError(
      `${argumentName}: ${filePath} is not a fingerprint written by fingerprint --json`,
      parsedFile.error,
      FINGERPRINT_FILE_FIX,
    );
  }
  return parsedFile.data;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function resolveFingerprintDiff(
  before: FingerprintContributors,
  after: FingerprintContributors,
): FingerprintDiff {
  return {
    extraFingerprintPaths: resolveExtraFingerprintPathChanges(
      before.extraFingerprintPaths,
      after.extraFingerprintPaths,
    ),
    packages: resolvePackageChanges(before.packages, after.packages),
  };
}

/**
 * Per package name, the versions only one side installs, paired in their order: a pair moved, the rest was added or removed.
 */
function resolvePackageChanges(
  before: LockedPackage[],
  after: LockedPackage[],
): PackageChange[] {
  const names = [...new Set([...before, ...after].map(({ name }) => name))];
  return names.sort().flatMap(name => {
    const beforeVersions = resolveVersionsOnlyIn(before, after, name);
    const afterVersions = resolveVersionsOnlyIn(after, before, name);
    return Array.from(
      { length: Math.max(beforeVersions.length, afterVersions.length) },
      (_, index) => ({
        after: afterVersions[index] ?? null,
        before: beforeVersions[index] ?? null,
        name,
      }),
    );
  });
}

function resolveVersionsOnlyIn(
  packages: LockedPackage[],
  otherPackages: LockedPackage[],
  name: string,
): InstalledVersion[] {
  return packages
    .filter(
      locked =>
        locked.name === name &&
        !otherPackages.some(
          other =>
            other.name === name &&
            other.version === locked.version &&
            other.integrity === locked.integrity,
        ),
    )
    .map(({ integrity, version }) => ({ integrity, version }));
}

function resolveExtraFingerprintPathChanges(
  before: ExtraFingerprintFile[],
  after: ExtraFingerprintFile[],
): ExtraFingerprintPathChange[] {
  const beforeHashes = new Map(
    before.map(({ path, sha256 }) => [path, sha256]),
  );
  const afterHashes = new Map(after.map(({ path, sha256 }) => [path, sha256]));
  const paths = [...new Set([...beforeHashes.keys(), ...afterHashes.keys()])];
  return paths
    .sort()
    .map(path => ({
      after: afterHashes.get(path) ?? null,
      before: beforeHashes.get(path) ?? null,
      path,
    }))
    .filter(({ after, before }) => after !== before);
}

/**
 * A side's version as the table prints it: the integrity where the version did not move, so a rebuild under it shows.
 */
function resolveInstalledVersionText(
  installedVersion: InstalledVersion | null,
  otherInstalledVersion: InstalledVersion | null,
): string {
  if (installedVersion === null) {
    return 'none';
  }
  return installedVersion.version === otherInstalledVersion?.version
    ? (installedVersion.integrity ?? 'no integrity')
    : installedVersion.version;
}
