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
import { fetchAllPages } from '../../utils/pagination.js';
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
    const deviceReference = await resolveDeviceReference(hotCodePush, options);
    const fetchedDevice = await hotCodePush.apps.devices.get({
      ...deviceReference,
      relations: ['channel'],
    });
    const fetchedEvents = await fetchAllPages(page =>
      hotCodePush.apps.devices.events.list({ ...deviceReference, ...page }),
    );
    if (options.json) {
      printJson({ ...fetchedDevice, events: fetchedEvents });
      return;
    }
    printDetails([
      ['ID', fetchedDevice.deviceId],
      ['Platform', `${fetchedDevice.platform} ${fetchedDevice.osVersion}`],
      ['Binary', resolveBinaryText(fetchedDevice)],
      ['Fingerprint', fetchedDevice.fingerprint ?? 'none'],
      [
        'Channel',
        `${fetchedDevice.channel?.name ?? fetchedDevice.channelId ?? 'none'} (${fetchedDevice.channelSource})`,
      ],
      ['Release', fetchedDevice.currentReleaseId ?? 'the embedded bundle'],
      ['SDK', fetchedDevice.sdkVersion],
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
      rows: fetchedEvents.map(({ createdAt, reason, releaseId, type }) => [
        releaseId,
        type,
        reason ?? '',
        resolveDate(createdAt),
      ]),
    });
  },
});
