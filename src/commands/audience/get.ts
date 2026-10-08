import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { resolveAudienceText } from '../../utils/audience.js';
import { hasLockfile, readFingerprint } from '../../utils/fingerprint.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, printWarnings } from '../../utils/output.js';
import { locateProjectConfig } from '../../utils/project-config.js';
import {
  buildAudienceQuery,
  conditionOptionShape,
} from '../../utils/release-conditions.js';
import {
  channelOptionShape,
  fetchChannel,
} from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    "Preview the devices a release's conditions would reach in a channel, before it exists, the project's fingerprint among them; what release create --dry-run prints.",
  examples: [
    'hotcodepush audience get --binary ">=2.3.0" --rollout-percentage 10',
    'hotcodepush audience get --channel production --attribute tier=beta --device 6b1e9d37-2f5c-4a80-9c46-d8e3a1f7b259 --json',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    ...conditionOptionShape,
    rolloutPercentage: z.coerce
      .number()
      .int()
      .min(0)
      .max(100)
      .optional()
      .describe(
        'The rollout percentage to estimate, 0 to 100; 100 by default.',
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const channel = await fetchChannel(hotCodePush, options);
    const rolloutPercentage = options.rolloutPercentage ?? 100;
    const audience = await hotCodePush.apps.channels.audience.get({
      ...buildAudienceQuery(
        options,
        await readProjectFingerprint(options.config),
        rolloutPercentage,
      ),
      appId: channel.appId,
      channelId: channel.id,
    });
    printWarnings(audience.warnings);
    if (options.json) {
      printJson(audience);
      return;
    }
    const audienceText = resolveAudienceText(
      audience,
      channel.name,
      rolloutPercentage,
    );
    console.log(
      `${audienceText.charAt(0).toUpperCase()}${audienceText.slice(1)}.`,
    );
    if (audience.reached === 0) {
      return;
    }
    for (const [header, deviceCounts] of [
      ['PLATFORM', audience.byPlatform],
      ['BINARY VERSION', audience.byBinaryVersion],
    ] as const) {
      printTable({
        emptyText: '',
        headers: [header, 'DEVICES'],
        nextOffset: null,
        rows: deviceCounts.map(({ count, value }) => [
          value ?? 'none',
          String(count),
        ]),
      });
    }
  },
});

/**
 * The fingerprint a release of the project's build carries as a condition, where the project has a lockfile to compute
 * it from, so the preview counts what `release create` reaches; none outside a project.
 */
async function readProjectFingerprint(
  configPath: string | undefined,
): Promise<string | null> {
  const { directoryPath, projectConfig } = locateProjectConfig(configPath);
  return hasLockfile(directoryPath)
    ? readFingerprint(directoryPath, projectConfig?.extraFingerprintPaths ?? [])
    : null;
}
