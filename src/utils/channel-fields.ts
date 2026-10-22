import type { Channel, CreateChannelOptions } from '@hotcodepush/node';
import { z } from 'zod';
import { booleanFlagSchema } from './boolean-flag.js';
import { DURATION_PATTERN, resolveDurationMilliseconds } from './duration.js';
import { InvalidParameterError } from './errors.js';
import { resolveNullableField } from './nullable-field.js';

type ChannelFields = Omit<
  CreateChannelOptions,
  'appId' | 'idempotencyKey' | 'name'
>;

interface ChannelFieldOptions extends FailurePolicyOptions {
  clearExpiresAt?: boolean;
  discoverable?: boolean;
  expiresAt?: string;
  expiresIn?: string;
  protected?: boolean;
}

type EffectiveFailurePolicy = {
  [Field in keyof FailurePolicyValues]: EffectiveFailurePolicyValue<
    FailurePolicyValues[Field]
  >;
};

interface EffectiveFailurePolicyValue<TValue> {
  level: FailurePolicyLevel;
  value: TValue;
}

type FailurePolicy = Pick<
  ChannelFields,
  'failureAction' | 'failureMinimumUpdateCount' | 'failureThresholdPercent'
>;

type FailurePolicyFields = Pick<
  Channel,
  'failureAction' | 'failureMinimumUpdateCount' | 'failureThresholdPercent'
>;

/**
 * Where an effective auto-pause value comes from: the channel's or the release's own field, the release's channel, or the default.
 */
type FailurePolicyLevel = 'channel' | 'default' | 'own';

export interface FailurePolicyOptions {
  clearFailureAction?: boolean;
  clearFailureMinimumUpdateCount?: boolean;
  clearFailureThreshold?: boolean;
  failureAction?: ChannelFields['failureAction'];
  failureMinimumUpdateCount?: number;
  failureThreshold?: number;
}

type FailurePolicyValues = {
  [Field in keyof FailurePolicyFields]: NonNullable<FailurePolicyFields[Field]>;
};

// The plan pins these defaults; the API and the console carry the same constant
export const FAILURE_POLICY_DEFAULTS: FailurePolicyValues = {
  failureAction: 'pause',
  failureMinimumUpdateCount: 50,
  failureThresholdPercent: 5,
};

/**
 * The auto-pause policy's flags, set on a channel by `channel create` and `channel update` and overridden per release by `release create` and `release update`.
 */
export const failurePolicyShape = {
  failureAction: z
    .enum(['none', 'notify', 'pause', 'revoke'])
    .optional()
    .describe(
      'What auto-pause does when a release fails too often: pause, revoke, notify or none.',
    ),
  failureMinimumUpdateCount: z.coerce
    .number()
    .int()
    .optional()
    .describe(
      'The applied updates a release needs before auto-pause judges it.',
    ),
  failureThreshold: z.coerce
    .number()
    .int()
    .optional()
    .describe('The failure percentage at which auto-pause acts.'),
};

/**
 * The writable fields `channel create` and `channel update` share, named after the API's fields.
 */
export const channelFieldsShape = {
  discoverable: booleanFlagSchema
    .optional()
    .describe(
      "Whether the app's setChannel finds the channel by its name; pass false to turn it off.",
    ),
  expiresAt: z
    .string()
    .optional()
    .describe(
      'When the preview channel expires, an ISO 8601 timestamp; not on protected or default channels.',
    ),
  expiresIn: z
    .string()
    .regex(
      DURATION_PATTERN,
      'Expected a number of days or hours such as 14d or 12h',
    )
    .optional()
    .describe('How long until the preview channel expires, 14d or 12h.'),
  ...failurePolicyShape,
  protected: booleanFlagSchema
    .optional()
    .describe(
      'Whether only Owners and Admins change what the channel serves; pass false to turn it off.',
    ),
};

/**
 * The flags `channel update` sets the channel's nullable fields back to null with.
 */
export const channelFieldsClearShape = {
  clearExpiresAt: z
    .boolean()
    .optional()
    .describe('Sets the expiry back to null: the channel never expires.'),
  ...resolveFailurePolicyClearShape('the default policy applies'),
};

/**
 * The flags `release update` sets the release's auto-pause overrides back to null with.
 */
export const releaseFailurePolicyClearShape = resolveFailurePolicyClearShape(
  "the channel's value applies",
);

/**
 * The API's body from the flags: `--expires-in` becomes the timestamp it ends at, `--failure-threshold` the percent field.
 */
export function resolveChannelFields(
  options: ChannelFieldOptions,
): ChannelFields {
  return {
    expiresAt: resolveExpiresAt(options),
    ...resolveFailurePolicy(options),
    isDiscoverable: options.discoverable,
    isProtected: options.protected,
  };
}

/**
 * The auto-pause policy that applies to a channel, or to a release with its channel: per field the own value,
 * else the channel's, else the default, each with the level it comes from.
 */
export function resolveEffectiveFailurePolicy(
  ownFields: FailurePolicyFields,
  channelFields?: FailurePolicyFields,
): EffectiveFailurePolicy {
  return {
    failureAction: resolveEffectiveFailurePolicyValue(
      ownFields.failureAction,
      channelFields?.failureAction,
      FAILURE_POLICY_DEFAULTS.failureAction,
    ),
    failureMinimumUpdateCount: resolveEffectiveFailurePolicyValue(
      ownFields.failureMinimumUpdateCount,
      channelFields?.failureMinimumUpdateCount,
      FAILURE_POLICY_DEFAULTS.failureMinimumUpdateCount,
    ),
    failureThresholdPercent: resolveEffectiveFailurePolicyValue(
      ownFields.failureThresholdPercent,
      channelFields?.failureThresholdPercent,
      FAILURE_POLICY_DEFAULTS.failureThresholdPercent,
    ),
  };
}

/**
 * The auto-pause fields from their flags, `--failure-threshold` the percent field; a `--clear-` flag sends null,
 * and a flag left out is a field left out.
 */
export function resolveFailurePolicy(
  options: FailurePolicyOptions,
): FailurePolicy {
  return {
    failureAction: resolveNullableField(
      options.failureAction,
      options.clearFailureAction,
      'failure-action',
    ),
    failureMinimumUpdateCount: resolveNullableField(
      options.failureMinimumUpdateCount,
      options.clearFailureMinimumUpdateCount,
      'failure-minimum-update-count',
    ),
    failureThresholdPercent: resolveNullableField(
      options.failureThreshold,
      options.clearFailureThreshold,
      'failure-threshold',
    ),
  };
}

/**
 * The effective auto-pause policy as `channel get` and `release get` print it: an own value plain,
 * an inherited one with its level, `5% (channel)`, `pause (default)`.
 */
export function resolveFailurePolicyDetails({
  failureAction,
  failureMinimumUpdateCount,
  failureThresholdPercent,
}: EffectiveFailurePolicy): [label: string, value: string][] {
  return [
    [
      'Failure threshold',
      resolveEffectiveFailurePolicyText(
        `${failureThresholdPercent.value}%`,
        failureThresholdPercent.level,
      ),
    ],
    [
      'Failure minimum update count',
      resolveEffectiveFailurePolicyText(
        String(failureMinimumUpdateCount.value),
        failureMinimumUpdateCount.level,
      ),
    ],
    [
      'Failure action',
      resolveEffectiveFailurePolicyText(
        failureAction.value,
        failureAction.level,
      ),
    ],
  ];
}

function resolveEffectiveFailurePolicyText(
  valueText: string,
  level: FailurePolicyLevel,
): string {
  return level === 'own' ? valueText : `${valueText} (${level})`;
}

function resolveEffectiveFailurePolicyValue<TValue>(
  ownValue: TValue | null,
  channelValue: TValue | null | undefined,
  defaultValue: TValue,
): EffectiveFailurePolicyValue<TValue> {
  if (ownValue !== null) {
    return { level: 'own', value: ownValue };
  }
  if (channelValue !== null && channelValue !== undefined) {
    return { level: 'channel', value: channelValue };
  }
  return { level: 'default', value: defaultValue };
}

function resolveExpiresAt({
  clearExpiresAt,
  expiresAt,
  expiresIn,
}: ChannelFieldOptions): string | null | undefined {
  if (expiresIn === undefined) {
    return resolveNullableField(expiresAt, clearExpiresAt, 'expires-at');
  }
  if (expiresAt !== undefined) {
    throw new InvalidParameterError(
      'The flags --expires-in and --expires-at were passed together.',
      'Pass only one of them.',
    );
  }
  return resolveNullableField(
    new Date(Date.now() + resolveDurationMilliseconds(expiresIn)).toISOString(),
    clearExpiresAt,
    'expires-in',
    'clear-expires-at',
  );
}

function resolveFailurePolicyClearShape(nullMeaning: string) {
  return {
    clearFailureAction: z
      .boolean()
      .optional()
      .describe(`Sets the action back to null: ${nullMeaning}.`),
    clearFailureMinimumUpdateCount: z
      .boolean()
      .optional()
      .describe(`Sets the minimum update count back to null: ${nullMeaning}.`),
    clearFailureThreshold: z
      .boolean()
      .optional()
      .describe(`Sets the threshold back to null: ${nullMeaning}.`),
  };
}
