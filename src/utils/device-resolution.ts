import type { HotCodePush } from '@hotcodepush/node';
import { z } from 'zod';
import type { InteractivityOptions } from './environment.js';
import { readProjectConfig } from './project-config.js';
import { promptText } from './prompts.js';
import { fetchAppId } from './resource-resolution.js';

export interface DeviceOptions extends InteractivityOptions {
  app?: string;
  config?: string;
  device?: string;
  organization?: string;
}

export const deviceOptionShape = {
  device: z
    .string()
    .optional()
    .describe(
      'The device, by the id it generated, as the debug screen and device list show it.',
    ),
};

/**
 * The app and the device `--device` names; a device has no name to pick from, so a missing one is asked for as text.
 */
export async function resolveDeviceReference(
  hotCodePush: HotCodePush,
  options: DeviceOptions,
): Promise<{ appId: string; deviceId: string }> {
  const appId = await fetchAppId(
    hotCodePush,
    options,
    readProjectConfig(options.config),
  );
  const deviceId =
    options.device ??
    (await promptText('--device', 'Which device id?', options));
  return { appId, deviceId };
}
