import type {
  CreateReleaseOptions,
  GetAudienceOptions,
} from '@hotcodepush/node';
import {
  hashAttribute,
  hashDeviceId,
  isValidAttributeKey,
  isValidAttributeValue,
} from '@hotcodepush/protocol';
import { z } from 'zod';
import { InvalidParameterError } from './errors.js';

export interface ConditionOptions {
  attribute?: string[];
  binaryVersion?: string;
  device?: string[];
  osVersion?: string;
}

type AudienceQuery = Omit<GetAudienceOptions, 'appId' | 'channelId'>;

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
  fingerprint: string | null,
  rolloutPercentage: number,
): AudienceQuery {
  return {
    attribute: resolveAttributePairs(options.attribute).map(
      ({ key, value }) => `${key}=${value}`,
    ),
    binary: resolveList(options.binaryVersion),
    device: options.device ?? [],
    fingerprint: resolveList(fingerprint ?? undefined),
    os: resolveList(options.osVersion),
    rolloutPercentage,
  };
}

// Matches the index: attribute values and device ids are hashed, and all device ids share one condition.
export function buildReleaseConditions(
  options: ConditionOptions,
  fingerprint: string | null,
): ReleaseCondition[] {
  const deviceIds = options.device ?? [];
  return [
    ...resolveAttributePairs(options.attribute).map(
      ({ key, value }): ReleaseCondition => ({
        key,
        type: 'attribute',
        valueSha256: hashAttribute(key, value),
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
            hashedIds: deviceIds.map(hashDeviceId),
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
  return (attributes ?? []).map(pair => {
    const separatorIndex = pair.indexOf('=');
    const key = pair.slice(0, separatorIndex);
    const value = pair.slice(separatorIndex + 1);
    if (
      separatorIndex === -1 ||
      !isValidAttributeKey(key) ||
      !isValidAttributeValue(value)
    ) {
      throw new InvalidParameterError(
        `The value "${pair}" of --attribute is not a key=value pair.`,
        'Pass key=value. The key takes letters, digits, _, - and . up to 64 characters, the value printable characters up to 256.',
      );
    }
    return { key, value };
  });
}

function resolveList(value: string | undefined): string[] {
  return value === undefined ? [] : [value];
}
