import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { ChannelIndex, DeviceInfo } from '@hotcodepush/protocol';
import type { FingerprintContributors } from '@hotcodepush/protocol/fingerprint';

// The project directory is relative to the lockfile directory, and empty when they are the same.
export interface FingerprintFixture {
  contributors: FingerprintContributors;
  extraFingerprintPaths: string[];
  files: Record<string, string>;
  fingerprint: string;
  name: string;
  projectPath: string;
}

export interface EvaluationFixture {
  device: DeviceInfo;
  expected: {
    condition?: string;
    isMandatory?: boolean;
    reason?: string;
    releaseId: string | null;
    status: 'available' | 'skipped' | 'up_to_date';
  };
  index: ChannelIndex;
  name: string;
}

export interface RefusedFingerprintFixture {
  extraFingerprintPaths: string[];
  files: Record<string, string>;
  name: string;
  projectPath: string;
}

interface FingerprintFixtures {
  cases: FingerprintFixture[];
  refusedProjects: RefusedFingerprintFixture[];
}

// Every implementation is tested against these shared fixtures.
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

export function readEvaluationFixtures(rule: string): EvaluationFixture[] {
  return (
    JSON.parse(
      readFileSync(
        join(PROTOCOL_FIXTURES_PATH, 'evaluation', `${rule}.json`),
        'utf8',
      ),
    ) as { cases: EvaluationFixture[] }
  ).cases;
}
