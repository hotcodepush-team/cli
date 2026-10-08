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
import { printJson, printTable } from '../../utils/output.js';
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

const FLEET_DIMENSIONS = [
  ['RELEASE', 'release'],
  ['BINARY VERSION', 'binaryVersion'],
  ['SDK VERSION', 'sdkVersion'],
  ['PLATFORM', 'platform'],
  ['OS VERSION', 'osVersion'],
  ['COUNTRY', 'country'],
] as const;

export default defineCommand({
  description:
    "Print one of the app's read models: the fleet the registry counts, the updates per day, or the usage the bill counts.",
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
        'The first UTC day of the updates or the usage, YYYY-MM-DD, inclusive; thirty days before --period-until by default.',
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
        'The read model: fleet, the devices seen in thirty days; updates, per day; usage, the monthly active devices and the traffic.',
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

/**
 * The fleet is a snapshot without a time axis and the usage is the app's whole bill, so each refuses the flag it has no field for.
 */
function assertFlagsOfType(
  type: StatisticsType,
  options: { channel?: string; periodSince?: string; periodUntil?: string },
): void {
  if (
    type === 'fleet' &&
    (options.periodSince !== undefined || options.periodUntil !== undefined)
  ) {
    throw new InvalidParameterError(
      '--period-since and --period-until: the fleet is a snapshot of the last thirty days without a period',
      undefined,
    );
  }
  if (type === 'usage' && options.channel !== undefined) {
    throw new InvalidParameterError(
      '--channel: the usage counts the whole app, never one channel',
      undefined,
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
  for (const [header, dimension] of FLEET_DIMENSIONS) {
    printTable({
      emptyText: `${header}: no device seen in the last thirty days.`,
      headers: [header, 'DEVICES'],
      nextOffset: null,
      rows: statistics[dimension].map(({ count, value }) => [
        value ?? (dimension === 'release' ? 'embedded' : 'none'),
        String(count),
      ]),
    });
  }
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
    headers: ['DAY', 'APPLIED', 'FAILED', 'ROLLED BACK'],
    nextOffset: null,
    rows: statistics.days.map(({ applied, day, failed, rolledBack }) => [
      day,
      String(applied),
      String(failed),
      String(rolledBack),
    ]),
  });
  printTable({
    emptyText: 'No release went live recently.',
    headers: ['RELEASE', 'LIVE', 'APPLIED', '50% AT', '90% AT'],
    nextOffset: null,
    rows: statistics.releases.map(
      ({ adoption, liveAt, number, timeToAdoption }) => [
        `#${number}`,
        liveAt,
        String(adoption.at(-1)?.applied ?? 0),
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
      headers: [header, 'COUNT'],
      nextOffset: null,
      rows: reasons.map(({ count, reason }) => [reason, String(count)]),
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
    headers: ['MONTH', 'MAU', 'BYTES'],
    nextOffset: null,
    rows: statistics.months.map(({ bytes, mau, month }) => [
      month.slice(0, 7),
      String(mau),
      resolveByteText(bytes),
    ]),
  });
  printTable({
    emptyText: 'No days in the period.',
    headers: ['DAY', 'CHECKS', 'BYTES', 'DOWNLOADED'],
    nextOffset: null,
    rows: statistics.days.map(({ bytes, checks, day, downloadedBytes }) => [
      day,
      String(checks),
      resolveByteText(bytes),
      resolveByteText(downloadedBytes),
    ]),
  });
}
