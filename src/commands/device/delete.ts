import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import {
  deviceOptionShape,
  resolveDeviceReference,
} from '../../utils/device-resolution.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';

export default defineCommand({
  description:
    "Delete a device's registry row, an erasure request; the device reports again with its next check.",
  examples: [
    'hotcodepush device delete --device 6b1e9d37-2f5c-4a80-9c46-d8e3a1f7b259',
    'hotcodepush device delete --device 6b1e9d37-2f5c-4a80-9c46-d8e3a1f7b259 --yes --json',
  ],
  options: defineCommandOptions(deviceOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const { appId, deviceId } = await resolveDeviceReference(
      hotCodePush,
      options,
    );
    const isConfirmed = await confirmConsequence(
      `deletes device ${deviceId}'s registry row for good, the erasure request; the device reports again with its next check`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    await hotCodePush.apps.devices.delete({ appId, deviceId });
    if (options.json) {
      printJson({ id: deviceId, name: null });
    } else {
      console.log(`Deleted device ${deviceId}.`);
    }
  },
});
