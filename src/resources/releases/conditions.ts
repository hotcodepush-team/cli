import type {
  CreateReleaseOptions,
  GetAudienceOptions,
} from '@hotcodepush/node';
import {
  isValidAttributeKey,
  isValidAttributeValue,
} from '@hotcodepush/protocol';
import { z } from 'zod';
import { InvalidParameterError } from '../../utils/errors.js';
import { resolveNameValuePairs } from '../../utils/name-value-pairs.js';

export interface ConditionOptions {
  attribute?: string[];
  binaryVersion?: string;
  device?: string[];
  osVersion?: string;
}

export type AudienceQuery = Omit<GetAudienceOptions, 'appId' | 'channelId'>;

type ReleaseCondition = NonNullable<CreateReleaseOptions['conditions']>[number];

export const conditionOptionShape = {
  attribute: z
    .array(z.string())
    .optional()
    .describe(
      'An attribute the app sets that the device must carry, key=value, repeatable.',
    ),
  binaryVersion: z
    .string()
    .optional()
    .describe(
      'The app versions served, a semver range such as ">=2.3.0 <3.0.0".',
    ),
  device: z
    .array(z.string())
    .optional()
    .describe('A device the release is limited to, by id, repeatable.'),
  osVersion: z
    .string()
    .optional()
    .describe('The OS versions served, a range such as ">=17".'),
};

// A release of a bundle carries its fingerprint beside the conditions.
export function buildAudienceQuery(
  options: ConditionOptions,
  {
    fingerprint,
    rolloutPercent,
  }: { fingerprint: string | null; rolloutPercent: number },
): AudienceQuery {
  return {
    attribute: resolveAttributePairs(options.attribute).map(
      ({ key, value }) => `${key}=${value}`,
    ),
    binary: resolveList(options.binaryVersion),
    device: options.device ?? [],
    fingerprint: resolveList(fingerprint ?? undefined),
    os: resolveList(options.osVersion),
    rolloutPercent,
  };
}

export function buildReleaseConditions(
  options: ConditionOptions,
  { fingerprint }: { fingerprint: string | null },
): ReleaseCondition[] {
  const deviceIds = options.device ?? [];
  return [
    ...resolveAttributePairs(options.attribute).map(
      ({ key, value }): ReleaseCondition => ({
        key,
        type: 'attribute',
        value,
      }),
    ),
    ...resolveList(options.binaryVersion).map((range): ReleaseCondition => ({
      range,
      type: 'binary',
    })),
    ...(deviceIds.length === 0
      ? []
      : [
          {
            ids: deviceIds,
            type: 'device',
          } satisfies ReleaseCondition,
        ]),
    ...resolveList(fingerprint ?? undefined).map(
      (fingerprint): ReleaseCondition => ({
        fingerprint,
        type: 'fingerprint',
      }),
    ),
    ...resolveList(options.osVersion).map((range): ReleaseCondition => ({
      range,
      type: 'os',
    })),
  ];
}

// The API requires the key to be an identifier and the value to be printable.
export function resolveAttributePairs(
  attributes: string[] | undefined,
): { key: string; value: string }[] {
  return resolveNameValuePairs(attributes, { flag: '--attribute' }).map(
    ({ name: key, value }) => {
      if (!isValidAttributeKey(key) || !isValidAttributeValue(value)) {
        throw new InvalidParameterError(
          `The value "${key}=${value}" of --attribute is not a key=value pair.`,
          {
            fix: 'Pass key=value. The key takes letters, digits, _, - and . up to 64 characters, the value printable characters up to 256.',
          },
        );
      }
      return { key, value };
    },
  );
}

function resolveList(value: string | undefined): string[] {
  return value === undefined ? [] : [value];
}
