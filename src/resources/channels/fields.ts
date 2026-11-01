import type { Channel, CreateChannelOptions } from '@hotcodepush/node';
import { z } from 'zod';
import { booleanFlagSchema } from '../../utils/boolean-flag.js';
import {
  DURATION_PATTERN,
  resolveDurationMilliseconds,
} from '../../utils/duration.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { resolveNullableField } from '../../utils/nullable-field.js';

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
  clearFailureThresholdPercent?: boolean;
  failureAction?: ChannelFields['failureAction'];
  failureMinimumUpdateCount?: number;
  failureThresholdPercent?: number;
}

type FailurePolicyValues = {
  [Field in keyof FailurePolicyFields]: NonNullable<FailurePolicyFields[Field]>;
};

// The plan pins these defaults. The API and the console carry the same constant.
const FAILURE_POLICY_DEFAULTS: FailurePolicyValues = {
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
  failureThresholdPercent: z.coerce
    .number()
    .int()
    .optional()
    .describe('The failure percentage at which auto-pause acts.'),
};

export const channelFieldsShape = {
  discoverable: booleanFlagSchema
    .optional()
    .describe(
      "Whether the app's setChannel finds the channel by its name. Pass false to turn it off.",
    ),
  expiresAt: z
    .string()
    .optional()
    .describe(
      'When the preview channel expires, an ISO 8601 timestamp. Protected and default channels have none.',
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
      'Whether only Owners and Admins change what the channel serves. Pass false to turn it off.',
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
    failureAction: resolveEffectiveFailurePolicyValue({
      channelValue: channelFields?.failureAction,
      defaultValue: FAILURE_POLICY_DEFAULTS.failureAction,
      ownValue: ownFields.failureAction,
    }),
    failureMinimumUpdateCount: resolveEffectiveFailurePolicyValue({
      channelValue: channelFields?.failureMinimumUpdateCount,
      defaultValue: FAILURE_POLICY_DEFAULTS.failureMinimumUpdateCount,
      ownValue: ownFields.failureMinimumUpdateCount,
    }),
    failureThresholdPercent: resolveEffectiveFailurePolicyValue({
      channelValue: channelFields?.failureThresholdPercent,
      defaultValue: FAILURE_POLICY_DEFAULTS.failureThresholdPercent,
      ownValue: ownFields.failureThresholdPercent,
    }),
  };
}

export function resolveFailurePolicy(
  options: FailurePolicyOptions,
): FailurePolicy {
  return {
    failureAction: resolveNullableField(options.failureAction, {
      flagName: 'failure-action',
      isCleared: options.clearFailureAction,
    }),
    failureMinimumUpdateCount: resolveNullableField(
      options.failureMinimumUpdateCount,
      {
        flagName: 'failure-minimum-update-count',
        isCleared: options.clearFailureMinimumUpdateCount,
      },
    ),
    failureThresholdPercent: resolveNullableField(
      options.failureThresholdPercent,
      {
        flagName: 'failure-threshold-percent',
        isCleared: options.clearFailureThresholdPercent,
      },
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

function resolveEffectiveFailurePolicyValue<TValue>({
  channelValue,
  defaultValue,
  ownValue,
}: {
  channelValue: TValue | null | undefined;
  defaultValue: TValue;
  ownValue: TValue | null;
}): EffectiveFailurePolicyValue<TValue> {
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
    return resolveNullableField(expiresAt, {
      flagName: 'expires-at',
      isCleared: clearExpiresAt,
    });
  }
  if (expiresAt !== undefined) {
    throw new InvalidParameterError(
      'The flags --expires-in and --expires-at were passed together.',
      { fix: 'Pass only one of them.' },
    );
  }
  return resolveNullableField(
    new Date(Date.now() + resolveDurationMilliseconds(expiresIn)).toISOString(),
    {
      clearFlagName: 'clear-expires-at',
      flagName: 'expires-in',
      isCleared: clearExpiresAt,
    },
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
    clearFailureThresholdPercent: z
      .boolean()
      .optional()
      .describe(`Sets the threshold back to null: ${nullMeaning}.`),
  };
}
