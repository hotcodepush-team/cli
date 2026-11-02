import type {
  FleetStatistics,
  HotCodePush,
  UpdateStatistics,
  UsageStatistics,
} from '@hotcodepush/node';
import { z } from 'zod';
import { fetchAppId } from '../../resources/apps.js';
import type { ChannelOptions } from '../../resources/channels/fetch.js';
import { fetchChannelFilterId } from '../../resources/channels/fetch.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import {
  printDetails,
  printJson,
  printTable,
  resolveByteText,
} from '../../utils/output.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { promptSelect } from '../../utils/prompts.js';

type StatisticsType = 'fleet' | 'updates' | 'usage';

interface StatisticsOptions extends ChannelOptions {
  periodSince?: string;
  periodUntil?: string;
}

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
    "Print one of the app's statistics: the fleet of devices seen in 30 days, the updates per day, or the usage the bill counts.",
  examples: [
    'hotcodepush statistics get --type fleet --channel production',
    'hotcodepush statistics get --type updates --period-since 2026-09-01 --period-until 2026-09-30 --json',
  ],
  options: defineCommandOptions({
    channel: z
      .string()
      .optional()
      .describe(
        'The channel, by id or name, to narrow the fleet or the updates to. Defaults to the whole app.',
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
        'The last UTC day of the updates or the usage, YYYY-MM-DD, inclusive. Defaults to today.',
      ),
    type: z
      .enum(STATISTICS_TYPES)
      .optional()
      .describe(
        'The statistics to print. fleet is the devices seen in 30 days, updates is the updates per day, and usage is the monthly active devices and the traffic.',
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const type = options.type ?? (await promptStatisticsType(options));
    assertFlagsOfType(type, options);
    const query = await fetchStatisticsQuery(hotCodePush, options);
    const { appId } = query;
    switch (type) {
      case 'fleet':
        return printFleetStatistics(
          await hotCodePush.apps.statistics.fleet.get({
            appId,
            channelId: query.channelId,
          }),
          options,
        );
      case 'updates':
        return printUpdateStatistics(
          await hotCodePush.apps.statistics.updates.get(query),
          options,
        );
      case 'usage':
        return printUsageStatistics(
          await hotCodePush.apps.statistics.usage.get({
            appId,
            periodSince: query.periodSince,
            periodUntil: query.periodUntil,
          }),
          options,
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

async function fetchStatisticsQuery(
  hotCodePush: HotCodePush,
  options: StatisticsOptions,
): Promise<StatisticsQuery> {
  const appId = await fetchAppId(hotCodePush, {
    options,
    projectConfig: readProjectConfig(options.config),
  });
  return {
    appId,
    channelId: await fetchChannelFilterId(hotCodePush, {
      appId,
      channel: options.channel,
    }),
    periodSince: options.periodSince,
    periodUntil: options.periodUntil,
  };
}

function printEventReasons(statistics: UpdateStatistics): void {
  for (const [header, reasons] of [
    ['FAILURE REASON', statistics.failureReasons],
    ['SKIP REASON', statistics.skippedReasons],
  ] as const) {
    console.log('');
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

function printFleetStatistics(
  statistics: FleetStatistics,
  { json }: InteractivityOptions,
): void {
  if (json) {
    printJson(statistics);
    return;
  }
  printDetails([
    ['Active devices', String(statistics.deviceCount)],
    ['Current devices', String(statistics.currentDeviceCount)],
  ]);
  printFleetTables(statistics);
}

function printFleetTables(statistics: FleetStatistics): void {
  console.log('');
  printFleetTable(
    ['RELEASE', 'DEVICES'],
    statistics.release.map(({ deviceCount, number }) => [
      number === null ? 'embedded' : `#${number}`,
      String(deviceCount),
    ]),
  );
  console.log('');
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
    console.log('');
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

function printReleaseAdoption(statistics: UpdateStatistics): void {
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
}

function printUpdateDays(statistics: UpdateStatistics): void {
  printTable({
    emptyText: 'No days in the period.',
    headers: ['DAY', 'CONFIRMED', 'FAILED', 'ROLLED BACK'],
    nextOffset: null,
    rows: statistics.days.map(
      ({
        confirmedUpdateCount,
        day,
        failedUpdateCount,
        rolledBackUpdateCount,
      }) => [
        day,
        String(confirmedUpdateCount),
        String(failedUpdateCount),
        String(rolledBackUpdateCount),
      ],
    ),
  });
}

function printUpdateStatistics(
  statistics: UpdateStatistics,
  { json }: InteractivityOptions,
): void {
  if (json) {
    printJson(statistics);
    return;
  }
  printUpdateDays(statistics);
  console.log('');
  printReleaseAdoption(statistics);
  printEventReasons(statistics);
}

function printUsageStatistics(
  statistics: UsageStatistics,
  { json }: InteractivityOptions,
): void {
  if (json) {
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
  console.log('');
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

function promptStatisticsType(
  options: InteractivityOptions,
): Promise<StatisticsType> {
  return promptSelect(options, {
    choices: STATISTICS_TYPES.map(value => ({ label: value, value })),
    flag: '--type',
    message: 'Which statistics?',
  });
}
