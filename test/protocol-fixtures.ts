import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { FingerprintContributors } from '@hotcodepush/protocol/fingerprint';

/**
 * A sample project of the protocol's `fingerprints.json`: its files, the native sources it declares,
 * and the contributors and fingerprint the recipe yields.
 */
export interface FingerprintFixture {
  contributors: FingerprintContributors;
  files: Record<string, string>;
  fingerprint: string;
  name: string;
  nativeSourcePaths: string[];
}

/**
 * A project of `fingerprints.json` whose fingerprint the recipe refuses.
 */
export interface RefusedFingerprintFixture {
  files: Record<string, string>;
  name: string;
  nativeSourcePaths: string[];
}

interface FingerprintFixtures {
  cases: FingerprintFixture[];
  refusedProjects: RefusedFingerprintFixture[];
}

/**
 * The fixtures `@hotcodepush/protocol` ships beside its build, the shapes every implementation is tested against.
 */
const PROTOCOL_FIXTURES_PATH = join(
  dirname(createRequire(import.meta.url).resolve('@hotcodepush/protocol')),
  '..',
  'fixtures',
);

export function readFingerprintFixtures(): FingerprintFixtures {
  return JSON.parse(
    readFileSync(join(PROTOCOL_FIXTURES_PATH, 'fingerprints.json'), 'utf8'),
  ) as FingerprintFixtures;
}
