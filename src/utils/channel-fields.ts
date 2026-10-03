import type { CreateChannelOptions } from '@hotcodepush/node';
import { z } from 'zod';
import { booleanFlagSchema } from './boolean-flag.js';
import { DURATION_PATTERN, resolveDurationMilliseconds } from './duration.js';
import { InvalidParameterError } from './errors.js';

type ChannelFields = Omit<
  CreateChannelOptions,
  'appId' | 'idempotencyKey' | 'name'
>;

interface ChannelFieldOptions extends FailurePolicyOptions {
  discoverable?: boolean;
  expiresAt?: string;
  expiresIn?: string;
  protected?: boolean;
}

type FailurePolicy = Pick<
  ChannelFields,
  'failureAction' | 'failureMinSample' | 'failureThresholdPercent'
>;

export interface FailurePolicyOptions {
  failureAction?: ChannelFields['failureAction'];
  failureMinSample?: number;
  failureThreshold?: number;
}

/**
 * The auto-pause policy's flags, set on a channel by `channel create` and `channel update` and overridden per release by `release create`.
 */
export const failurePolicyShape = {
  failureAction: z
    .enum(['notify', 'pause', 'revoke'])
    .optional()
    .describe(
      'What auto-pause does when a release fails too often: pause, revoke or notify; the default policy without it.',
    ),
  failureMinSample: z.coerce
    .number()
    .int()
    .optional()
    .describe(
      'The update attempts a release needs before auto-pause judges it.',
    ),
  failureThreshold: z.coerce
    .number()
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
      "Whether the app's setChannel finds the channel by its name; pass false to clear it.",
    ),
  expiresAt: z
    .string()
    .optional()
    .describe(
      'When the preview channel expires, an ISO 8601 timestamp; not on protected or default channels.',
    ),
  expiresIn: z
    .string()
    .regex(DURATION_PATTERN, 'a number of days or hours such as 14d or 12h')
    .optional()
    .describe('How long until the preview channel expires, 14d or 12h.'),
  ...failurePolicyShape,
  protected: booleanFlagSchema
    .optional()
    .describe(
      'Whether only Owners and Admins change what the channel serves; pass false to clear it.',
    ),
};

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
 * The auto-pause fields from their flags, `--failure-threshold` the percent field; a flag left out is a field left out.
 */
export function resolveFailurePolicy(
  options: FailurePolicyOptions,
): FailurePolicy {
  return {
    failureAction: options.failureAction,
    failureMinSample: options.failureMinSample,
    failureThresholdPercent: options.failureThreshold,
  };
}

function resolveExpiresAt({
  expiresAt,
  expiresIn,
}: ChannelFieldOptions): string | undefined {
  if (expiresIn === undefined) {
    return expiresAt;
  }
  if (expiresAt !== undefined) {
    throw new InvalidParameterError(
      '--expires-in and --expires-at: pass only one of them',
      undefined,
    );
  }
  return new Date(
    Date.now() + resolveDurationMilliseconds(expiresIn),
  ).toISOString();
}
