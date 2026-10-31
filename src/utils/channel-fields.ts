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

// The plan pins these defaults. The API and the console carry the same constant.
export const FAILURE_POLICY_DEFAULTS: FailurePolicyValues = {
  failureAction: 'pause',
  failureMinimumUpdateCount: 50,
  failureThresholdPercent: 5,
};

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

export const channelFieldsClearShape = {
  clearExpiresAt: z
    .boolean()
    .optional()
    .describe('Sets the expiry back to null: the channel never expires.'),
  ...resolveFailurePolicyClearShape('the default policy applies'),
};

export const releaseFailurePolicyClearShape = resolveFailurePolicyClearShape(
  "the channel's value applies",
);

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

// Each field falls back from its own value to the channel, then to the default.
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

// An inherited value names its level, such as `5% (channel)` or `pause (default)`.
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
