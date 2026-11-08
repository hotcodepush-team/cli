import type { HotCodePush } from '@hotcodepush/node';
import { z } from 'zod';
import type { Platform } from '../upload/upload.js';
import { PLATFORMS } from '../upload/upload.js';
import type { InteractivityOptions } from '../utils/environment.js';
import { promptSelect } from '../utils/prompts.js';
import type { FrameworkModule } from './index.js';
import { isBundlePerPlatform, resolveFrameworkModule } from './index.js';

export interface PlatformOptions extends InteractivityOptions {
  platform?: Platform;
}

// One value, so a comma list is refused under the flag name.
export const platformOptionShape = {
  platform: z
    .enum(PLATFORMS)
    .optional()
    .describe(
      'The platform, ios or android. Required on React Native and Expo, where a bundle serves one platform. On Capacitor and Cordova it narrows the bundle, which serves both by default.',
    ),
};

// The app's framework decides, so a command run outside the project knows it too.
export async function fetchPlatform(
  hotCodePush: HotCodePush,
  { appId, options }: { appId: string; options: PlatformOptions },
): Promise<Platform | null> {
  const app = await hotCodePush.apps.get({ appId });
  return resolvePlatform(resolveFrameworkModule(app.framework), options);
}

// Null means every platform, which only a framework with one bundle for both allows.
export async function resolvePlatform(
  framework: FrameworkModule,
  options: PlatformOptions,
): Promise<Platform | null> {
  if (options.platform !== undefined) {
    return options.platform;
  }
  if (!isBundlePerPlatform(framework)) {
    return null;
  }
  return promptSelect(options, {
    choices: PLATFORMS.map(platform => ({ label: platform, value: platform })),
    flag: '--platform',
    message: 'Which platform?',
  });
}
