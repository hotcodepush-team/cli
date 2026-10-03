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

/**
 * The condition flags as typed: `release create` and `audience get` take the same ones.
 */
export interface ConditionOptions {
  attribute?: string[];
  binary?: string;
  device?: string[];
  os?: string;
  runtime?: string;
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
  binary: z
    .string()
    .optional()
    .describe(
      'The app versions served, a semver range such as ">=2.3.0 <3.0.0".',
    ),
  device: z
    .array(z.string())
    .optional()
    .describe('A device the release is limited to, by id, repeatable.'),
  os: z
    .string()
    .optional()
    .describe('The OS versions served, a range such as ">=17".'),
  runtime: z
    .string()
    .optional()
    .describe(
      "The Expo runtime version served, for the Expo Updates bridge's clients.",
    ),
};

/**
 * The audience preview's query for the flags: each condition as typed, the fingerprint a release of a bundle carries beside them.
 */
export function buildAudienceQuery(
  options: ConditionOptions,
  fingerprint: string | null,
  rolloutPercentage: number,
): AudienceQuery {
  return {
    attribute: resolveAttributePairs(options.attribute).map(
      ({ key, value }) => `${key}=${value}`,
    ),
    binary: resolveList(options.binary),
    device: options.device ?? [],
    fingerprint: resolveList(fingerprint ?? undefined),
    os: resolveList(options.os),
    rollout: rolloutPercentage,
    runtime: resolveList(options.runtime),
  };
}

/**
 * The conditions a release carries for the flags, as the index holds them: the attribute values and device ids hashed,
 * every device id in one condition, and the bundle's fingerprint, always, when the bundle has one.
 */
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
    ...resolveList(options.binary).map((range): ReleaseCondition => ({
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
    ...resolveList(fingerprint ?? undefined).map((hash): ReleaseCondition => ({
      hash,
      type: 'fingerprint',
    })),
    ...resolveList(options.os).map((range): ReleaseCondition => ({
      range,
      type: 'os',
    })),
    ...resolveList(options.runtime).map((version): ReleaseCondition => ({
      type: 'runtime',
      version,
    })),
  ];
}

/**
 * Every `--attribute` split at its first `=`, the key an identifier and the value printable, as the API checks them.
 */
function resolveAttributePairs(
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
        `--attribute: "${pair}" is no key=value pair`,
        undefined,
        'pass key=value, the key letters, digits, _, - and . up to 64 characters, the value printable up to 256.',
      );
    }
    return { key, value };
  });
}

function resolveList(value: string | undefined): string[] {
  return value === undefined ? [] : [value];
}
