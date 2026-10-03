import type { Device } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { resolveTimeBound } from '../../utils/duration.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { readProjectConfig } from '../../utils/project-config.js';
import {
  fetchAppId,
  fetchChannels,
  fetchResourceId,
} from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    "List the app's devices, the newest report first, filtered by what they reported; support and QA, never a pipeline.",
  examples: [
    'hotcodepush device list --attribute userId=42',
    'hotcodepush device list --platform ios --binary-version 2.4.1 --last-seen-since 2026-09-01T00:00:00Z --json',
  ],
  options: defineCommandOptions({
    ...paginationShape,
    attribute: z
      .string()
      .optional()
      .describe('An attribute the app set, key=value, such as userId=42.'),
    binaryBuild: z
      .string()
      .optional()
      .describe('The build number the devices run.'),
    binaryVersion: z
      .string()
      .optional()
      .describe('The app version the devices run.'),
    channel: z
      .string()
      .optional()
      .describe('The channel the devices follow, by id or name.'),
    fingerprint: z
      .string()
      .optional()
      .describe('The native fingerprint the devices report.'),
    lastSeenSince: z
      .string()
      .optional()
      .describe(
        'The earliest last report, inclusive: an ISO 8601 timestamp or a duration ago such as 2h or 7d.',
      ),
    lastSeenUntil: z
      .string()
      .optional()
      .describe(
        'The latest last report, inclusive: an ISO 8601 timestamp or a duration ago such as 2h or 7d.',
      ),
    platform: z
      .enum(['android', 'ios'])
      .optional()
      .describe('The platform, ios or android.'),
    runtimeVersion: z
      .string()
      .optional()
      .describe('The runtime version a bridge reports.'),
    sdkVersion: z
      .string()
      .optional()
      .describe('The SDK version the devices run.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const appId = await fetchAppId(
      hotCodePush,
      options,
      readProjectConfig(options.config),
    );
    const listedDevices = await hotCodePush.apps.devices.list({
      appId,
      attribute: options.attribute,
      binaryBuild: options.binaryBuild,
      binaryVersion: options.binaryVersion,
      channelId:
        options.channel === undefined
          ? undefined
          : await fetchResourceId('channel', options.channel, () =>
              fetchChannels(hotCodePush, appId),
            ),
      fingerprint: options.fingerprint,
      lastSeenSince: resolveTimeBound(options.lastSeenSince),
      lastSeenUntil: resolveTimeBound(options.lastSeenUntil),
      limit: options.limit,
      offset: options.offset,
      platform: options.platform,
      relations: ['channel'],
      runtimeVersion: options.runtimeVersion,
      sdkVersion: options.sdkVersion,
    });
    const nextOffset = resolveNextOffset(listedDevices.length, options);
    if (options.json) {
      printJson({ devices: listedDevices, nextOffset });
      return;
    }
    printTable({
      emptyText: 'No devices match; a device appears with its first check.',
      headers: ['ID', 'PLATFORM', 'BINARY', 'CHANNEL', 'SDK', 'LAST SEEN'],
      nextOffset,
      rows: listedDevices.map(device => [
        device.id,
        device.platform,
        resolveBinaryText(device),
        device.channel?.name ?? device.channelId ?? 'none',
        device.sdkVersion,
        resolveDate(device.lastSeenAt),
      ]),
    });
  },
});

/**
 * The store build a device runs as a person names it, `2.4.1 (57)`.
 */
export function resolveBinaryText({
  binaryBuild,
  binaryVersion,
}: Pick<Device, 'binaryBuild' | 'binaryVersion'>): string {
  return `${binaryVersion} (${binaryBuild})`;
}
