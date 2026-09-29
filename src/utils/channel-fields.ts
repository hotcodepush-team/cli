import type { CreateChannelOptions } from '@hotcodepush/node';
import { z } from 'zod';
import { InvalidParameterError } from './errors.js';

type ChannelFields = Omit<
  CreateChannelOptions,
  'appId' | 'idempotencyKey' | 'name'
>;

interface ChannelFieldOptions {
  discoverable?: boolean;
  expiresAt?: string;
  expiresIn?: string;
  failureAction?: ChannelFields['failureAction'];
  failureMinSample?: number;
  failureThreshold?: number;
  protected?: boolean;
}

const DURATION_PATTERN = /^\d+[dh]$/;

const MILLISECONDS_PER_DURATION_UNIT = {
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
} as const;

// A flag without a value arrives as true and `--protected false` as a string, so both forms set the field
const booleanFieldSchema = z.union([z.boolean(), z.stringbool()]);

/**
 * The writable fields `channel create` and `channel update` share, named after the API's fields.
 */
export const channelFieldsShape = {
  discoverable: booleanFieldSchema
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
  protected: booleanFieldSchema
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
    failureAction: options.failureAction,
    failureMinSample: options.failureMinSample,
    failureThresholdPercent: options.failureThreshold,
    isDiscoverable: options.discoverable,
    isProtected: options.protected,
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

/**
 * A duration the schema checked, 14d or 12h, in milliseconds.
 */
function resolveDurationMilliseconds(duration: string): number {
  const unit = duration.slice(
    -1,
  ) as keyof typeof MILLISECONDS_PER_DURATION_UNIT;
  return Number(duration.slice(0, -1)) * MILLISECONDS_PER_DURATION_UNIT[unit];
}
