import type { Device } from '@hotcodepush/node';
import { z } from 'zod';
import { fetchAppId } from '../../resources/apps.js';
import { fetchChannelFilterId } from '../../resources/channels/fetch.js';
import { resolveBinaryText } from '../../resources/devices.js';
import { PLATFORMS } from '../../upload/upload.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { resolveTimeBound } from '../../utils/duration.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { readProjectConfig } from '../../utils/project-config.js';

export default defineCommand({
  description:
    "List the app's devices, the newest report first, filtered by what they reported. It is for support and QA, never for a pipeline.",
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
      .enum(PLATFORMS)
      .optional()
      .describe('The platform, ios or android.'),
    sdkVersion: z
      .string()
      .optional()
      .describe('The SDK version the devices run.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const appId = await fetchAppId(hotCodePush, {
      options,
      projectConfig: readProjectConfig(options.config),
    });
    const listedDevices = await hotCodePush.apps.devices.list({
      appId,
      attribute: options.attribute,
      binaryBuild: options.binaryBuild,
      binaryVersion: options.binaryVersion,
      channelId: await fetchChannelFilterId(hotCodePush, {
        appId,
        channel: options.channel,
      }),
      fingerprint: options.fingerprint,
      lastSeenSince: resolveTimeBound(options.lastSeenSince),
      lastSeenUntil: resolveTimeBound(options.lastSeenUntil),
      limit: options.limit,
      offset: options.offset,
      platform: options.platform,
      relations: ['channel'],
      sdkVersion: options.sdkVersion,
    });
    const nextOffset = resolveNextOffset(listedDevices.length, options);
    if (options.json) {
      printJson({ devices: listedDevices, nextOffset });
      return;
    }
    printDeviceTable(listedDevices, { nextOffset });
  },
});

function printDeviceTable(
  listedDevices: Device[],
  { nextOffset }: { nextOffset: number | null },
): void {
  printTable({
    emptyText: 'No devices match. A device appears with its first check.',
    headers: ['ID', 'PLATFORM', 'BINARY', 'CHANNEL', 'SDK', 'LAST SEEN'],
    nextOffset,
    rows: listedDevices.map(device => [
      device.deviceId,
      device.platform,
      resolveBinaryText(device),
      device.channel?.name ?? device.channelId ?? 'none',
      device.sdkVersion,
      resolveDate(device.lastSeenAt),
    ]),
  });
}
