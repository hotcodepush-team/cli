import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import {
  deviceOptionShape,
  resolveDeviceReference,
} from '../../utils/device-resolution.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import {
  printDetails,
  printJson,
  printTable,
  resolveDate,
} from '../../utils/output.js';
import { resolveBinaryText } from './list.js';

export default defineCommand({
  description:
    'Print what a device runs and reported last, with its outcome per release, newest first.',
  examples: [
    'hotcodepush device get --device 6b1e9d37-2f5c-4a80-9c46-d8e3a1f7b259',
    'hotcodepush device get --device 6b1e9d37-2f5c-4a80-9c46-d8e3a1f7b259 --json',
  ],
  options: defineCommandOptions(deviceOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedDevice = await hotCodePush.apps.devices.get({
      ...(await resolveDeviceReference(hotCodePush, options)),
      relations: ['channel'],
    });
    if (options.json) {
      printJson(fetchedDevice);
      return;
    }
    printDetails([
      ['ID', fetchedDevice.id],
      ['Platform', `${fetchedDevice.platform} ${fetchedDevice.osVersion}`],
      ['Binary', resolveBinaryText(fetchedDevice)],
      ['Fingerprint', fetchedDevice.fingerprint ?? 'none'],
      [
        'Channel',
        `${fetchedDevice.channel?.name ?? fetchedDevice.channelId ?? 'none'} (${fetchedDevice.channelSource})`,
      ],
      ['Release', fetchedDevice.currentReleaseId ?? 'the embedded bundle'],
      ['SDK', fetchedDevice.sdkVersion],
      ['Runtime', fetchedDevice.runtimeVersion ?? 'none'],
      [
        'Attributes',
        Object.entries(fetchedDevice.attributes)
          .map(([key, value]) => `${key}=${value}`)
          .join(', ') || 'none',
      ],
      ['Country', fetchedDevice.country ?? 'unknown'],
      ['Last seen', fetchedDevice.lastSeenAt],
      ['First seen', fetchedDevice.createdAt],
    ]);
    printTable({
      emptyText: 'No outcomes yet: the device has not checked a release.',
      headers: ['RELEASE', 'OUTCOME', 'REASON', 'DATE'],
      nextOffset: null,
      rows: fetchedDevice.marks.map(
        ({ createdAt, kind, reason, releaseId }) => [
          releaseId,
          kind,
          reason ?? '',
          resolveDate(createdAt),
        ],
      ),
    });
  },
});
