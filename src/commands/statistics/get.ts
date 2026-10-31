import type {
  FleetStatistics,
  UpdateStatistics,
  UsageStatistics,
} from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson, printTable } from '../../utils/output.js';
import { resolveByteText } from '../../utils/progress.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { promptSelect } from '../../utils/prompts.js';
import {
  fetchAppId,
  fetchChannels,
  fetchResourceId,
} from '../../utils/resource-resolution.js';

type StatisticsType = 'fleet' | 'updates' | 'usage';

interface StatisticsQuery {
  appId: string;
  channelId: string | undefined;
  periodSince: string | undefined;
  periodUntil: string | undefined;
}

const STATISTICS_TYPES: StatisticsType[] = ['fleet', 'updates', 'usage'];

// Buckets of these dimensions hold only a value and its devices. Release and binary buckets carry more.
const FLEET_DIMENSIONS = [
  ['BINARY VERSION', 'binaryVersion'],
  ['SDK VERSION', 'sdkVersion'],
  ['PLATFORM', 'platform'],
  ['OS VERSION', 'osVersion'],
  ['COUNTRY', 'country'],
] as const;

export default defineCommand({
  description:
    "Print one of the app's statistics: the fleet, the devices seen in 30 days; the updates per day; or the usage the bill counts.",
  examples: [
    'hotcodepush statistics get --type fleet --channel production',
    'hotcodepush statistics get --type updates --period-since 2026-09-01 --period-until 2026-09-30 --json',
  ],
  options: defineCommandOptions({
    channel: z
      .string()
      .optional()
      .describe(
        'The channel, by id or name, to narrow the fleet or the updates to; the whole app by default.',
      ),
    periodSince: z
      .string()
      .optional()
      .describe(
        'The first UTC day of the updates or the usage, YYYY-MM-DD, inclusive; 30 days before --period-until by default.',
      ),
    periodUntil: z
      .string()
      .optional()
      .describe(
        'The last UTC day of the updates or the usage, YYYY-MM-DD, inclusive; today by default.',
      ),
    type: z
      .enum(STATISTICS_TYPES)
      .optional()
      .describe(
        'The statistics to print: fleet, the devices seen in 30 days; updates, per day; usage, the monthly active devices and the traffic.',
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const type =
      options.type ??
      (await promptSelect(
        '--type',
        'Which statistics?',
        STATISTICS_TYPES.map(value => ({ label: value, value })),
        options,
      ));
    assertFlagsOfType(type, options);
    const appId = await fetchAppId(
      hotCodePush,
      options,
      readProjectConfig(options.config),
    );
    const query: StatisticsQuery = {
      appId,
      channelId:
        options.channel === undefined
          ? undefined
          : await fetchResourceId('channel', options.channel, () =>
              fetchChannels(hotCodePush, appId),
            ),
      periodSince: options.periodSince,
      periodUntil: options.periodUntil,
    };
    switch (type) {
      case 'fleet':
        return printFleetStatistics(
          await hotCodePush.apps.statistics.fleet.get({
            appId,
            channelId: query.channelId,
          }),
          options.json,
        );
      case 'updates':
        return printUpdateStatistics(
          await hotCodePush.apps.statistics.updates.get(query),
          options.json,
        );
      case 'usage':
        return printUsageStatistics(
          await hotCodePush.apps.statistics.usage.get({
            appId,
            periodSince: query.periodSince,
            periodUntil: query.periodUntil,
          }),
          options.json,
        );
    }
  },
});

// The fleet is a snapshot without a time axis, and the usage is the whole bill.
// So each refuses the flag it has no field for.
function assertFlagsOfType(
  type: StatisticsType,
  options: { channel?: string; periodSince?: string; periodUntil?: string },
): void {
  if (
    type === 'fleet' &&
    (options.periodSince !== undefined || options.periodUntil !== undefined)
  ) {
    throw new InvalidParameterError(
      'The fleet is a snapshot of the last 30 days without a period, so --period-since and --period-until do not apply.',
    );
  }
  if (type === 'usage' && options.channel !== undefined) {
    throw new InvalidParameterError(
      'The usage counts the whole app, never one channel, so --channel does not apply.',
    );
  }
}

function printFleetStatistics(
  statistics: FleetStatistics,
  isJson: boolean | undefined,
): void {
  if (isJson) {
    printJson(statistics);
    return;
  }
  printDetails([
    ['Active devices', String(statistics.deviceCount)],
    ['Current devices', String(statistics.currentDeviceCount)],
  ]);
  printFleetTable(
    ['RELEASE', 'DEVICES'],
    statistics.release.map(({ deviceCount, number }) => [
      number === null ? 'embedded' : `#${number}`,
      String(deviceCount),
    ]),
  );
  printFleetTable(
    ['BINARY', 'VERSION', 'PLATFORM', 'DEVICES'],
    statistics.binary.map(({ deviceCount, platform, value, version }) => [
      value ?? 'none',
      version ?? 'none',
      platform ?? 'none',
      String(deviceCount),
    ]),
  );
  for (const [header, dimension] of FLEET_DIMENSIONS) {
    printFleetTable(
      [header, 'DEVICES'],
      statistics[dimension].map(({ deviceCount, value }) => [
        value ?? 'none',
        String(deviceCount),
      ]),
    );
  }
}

function printFleetTable(
  headers: [dimensionHeader: string, ...columnHeaders: string[]],
  rows: string[][],
): void {
  printTable({
    emptyText: `${headers[0]}: no device seen in the last 30 days.`,
    headers,
    nextOffset: null,
    rows,
  });
}

function printUpdateStatistics(
  statistics: UpdateStatistics,
  isJson: boolean | undefined,
): void {
  if (isJson) {
    printJson(statistics);
    return;
  }
  printTable({
    emptyText: 'No days in the period.',
    headers: ['DAY', 'CONFIRMED', 'FAILED', 'ROLLED BACK'],
    nextOffset: null,
    rows: statistics.days.map(
      ({ confirmedUpdateCount, day, failureCount, rolledBackUpdateCount }) => [
        day,
        String(confirmedUpdateCount),
        String(failureCount),
        String(rolledBackUpdateCount),
      ],
    ),
  });
  printTable({
    emptyText: 'No release went live recently.',
    headers: ['RELEASE', 'LIVE', 'CONFIRMED', '50% AT', '90% AT'],
    nextOffset: null,
    rows: statistics.releases.map(
      ({ adoption, liveAt, number, timeToAdoption }) => [
        `#${number}`,
        liveAt,
        String(adoption.at(-1)?.confirmedUpdateCount ?? 0),
        timeToAdoption.percent50At ?? 'not yet',
        timeToAdoption.percent90At ?? 'not yet',
      ],
    ),
  });
  for (const [header, reasons] of [
    ['FAILURE REASON', statistics.failureReasons],
    ['SKIP REASON', statistics.skippedReasons],
  ] as const) {
    printTable({
      emptyText: `${header}: none in the period.`,
      headers: [header, 'EVENTS'],
      nextOffset: null,
      rows: reasons.map(({ eventCount, reason }) => [
        reason,
        String(eventCount),
      ]),
    });
  }
}

function printUsageStatistics(
  statistics: UsageStatistics,
  isJson: boolean | undefined,
): void {
  if (isJson) {
    printJson(statistics);
    return;
  }
  printTable({
    emptyText: 'No months in the period.',
    headers: ['MONTH', 'MAU', 'DATA TRANSFER'],
    nextOffset: null,
    rows: statistics.months.map(
      ({ dataTransferBytes, month, monthlyActiveDeviceCount }) => [
        month.slice(0, 7),
        String(monthlyActiveDeviceCount),
        resolveByteText(dataTransferBytes),
      ],
    ),
  });
  printTable({
    emptyText: 'No days in the period.',
    headers: ['DAY', 'CHECKS', 'DATA TRANSFER', 'DEVICE DOWNLOADS'],
    nextOffset: null,
    rows: statistics.days.map(
      ({ checkCount, dataTransferBytes, day, deviceDownloadBytes }) => [
        day,
        String(checkCount),
        resolveByteText(dataTransferBytes),
        resolveByteText(deviceDownloadBytes),
      ],
    ),
  });
}
