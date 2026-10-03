import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HotCodePush } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { resolveBundleLabel } from '../../utils/bundle-resolution.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { readFingerprint } from '../../utils/fingerprint.js';
import {
  detectFramework,
  resolveInputDirectoryPath,
} from '../../utils/framework.js';
import type { GitProvenanceOptions } from '../../utils/git-provenance.js';
import { resolveGitProvenance } from '../../utils/git-provenance.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { createReporter, resolveByteText } from '../../utils/progress.js';
import { locateProjectConfig } from '../../utils/project-config.js';
import { promptText } from '../../utils/prompts.js';
import { fetchAppId } from '../../utils/resource-resolution.js';
import type {
  Platform,
  UploadBundleOptions,
  UploadedBundle,
} from '../../utils/upload.js';
import { uploadBundle } from '../../utils/upload.js';

export interface BundleUploadOptions
  extends GitProvenanceOptions, InteractivityOptions {
  app?: string;
  bundleVersion?: string;
  config?: string;
  organization?: string;
  path?: string;
  platform?: Platform[];
}

const PLATFORMS: Platform[] = ['android', 'ios'];

// `ios,android` as typed, validated in the schema so a wrong platform is answered under the flag's name
const platformListSchema = z
  .string()
  .transform(value => value.split(',').map(platform => platform.trim()))
  .pipe(z.array(z.enum(PLATFORMS)).min(1));

/**
 * The flags `bundle upload` takes, shared with `release create --path`, which uploads first.
 */
export const bundleUploadOptionShape = {
  bundleVersion: z
    .string()
    .optional()
    .describe(
      "The bundle's version label; the project's package.json version by default.",
    ),
  gitMessage: z
    .string()
    .optional()
    .describe('The commit message subject to record, over the detected one.'),
  gitRef: z
    .string()
    .optional()
    .describe('The branch or tag to record, over the detected one.'),
  gitSha: z
    .string()
    .optional()
    .describe('The commit to record, over the detected one.'),
  noGit: z
    .boolean()
    .optional()
    .describe('Detect no git provenance; the typed --git-* flags still apply.'),
  path: z
    .string()
    .optional()
    .describe(
      "The web build to upload; hotcodepush.json's dir, otherwise Capacitor's webDir, by default.",
    ),
  platform: platformListSchema
    .optional()
    .describe('The platforms the bundle serves, ios,android by default.'),
};

export default defineCommand({
  description:
    'Upload a web build as a bundle: only the files the app lacks move, then the packs; nothing is released.',
  examples: [
    'hotcodepush bundle upload',
    'hotcodepush bundle upload --path dist --bundle-version 1.4.2 --platform ios --json',
  ],
  options: defineCommandOptions(bundleUploadOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const uploadedBundle = await uploadBundle(
      hotCodePush,
      await resolveUploadBundleOptions(hotCodePush, options),
    );
    printUploadedBundle(uploadedBundle, options.json);
  },
});

export function printUploadedBundle(
  {
    bundle,
    deltaBaseBundleId,
    uploadedBytes,
    uploadedFileCount,
  }: UploadedBundle,
  isJson: boolean | undefined,
): void {
  if (isJson) {
    printJson({
      ...bundle,
      upload: { deltaBaseBundleId, uploadedBytes, uploadedFileCount },
    });
    return;
  }
  const deltaText =
    deltaBaseBundleId === null
      ? ''
      : ', with a delta pack against the previous bundle';
  console.log(
    `Uploaded bundle ${resolveBundleLabel(bundle)} (${bundle.id}): ${uploadedFileCount} files moved, ${resolveByteText(uploadedBytes)}${deltaText}.`,
  );
}

/**
 * What the upload needs, from the project's configuration and the flags, asked for where missing; nothing moves yet,
 * so `release create --path` resolves it before it confirms and uploads only once confirmed.
 */
export async function resolveUploadBundleOptions(
  hotCodePush: HotCodePush,
  options: BundleUploadOptions,
): Promise<UploadBundleOptions> {
  const { directoryPath, projectConfig } = locateProjectConfig(options.config);
  detectFramework(directoryPath);
  const appId = await fetchAppId(hotCodePush, options, projectConfig);
  const inputDirectoryPath = await resolveInputDirectoryPath(
    options,
    projectConfig,
    directoryPath,
  );
  return {
    appId,
    bundleVersion: await resolveBundleVersion(options, directoryPath),
    directoryPath: inputDirectoryPath,
    fingerprint: await readFingerprint(
      directoryPath,
      projectConfig?.nativeSources ?? [],
    ),
    gitProvenance: await resolveGitProvenance(directoryPath, options),
    platforms: options.platform ?? PLATFORMS,
    reporter: createReporter(options),
  };
}

/**
 * `--bundle-version`, otherwise the project's package.json version, the label a team already keeps; neither is asked for.
 */
async function resolveBundleVersion(
  options: BundleUploadOptions,
  directoryPath: string,
): Promise<string> {
  if (options.bundleVersion !== undefined) {
    return options.bundleVersion;
  }
  const packageJsonPath = join(directoryPath, 'package.json');
  if (existsSync(packageJsonPath)) {
    const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version?: string;
    };
    if (version) {
      return version;
    }
  }
  return promptText(
    '--bundle-version',
    'Which version label does the bundle carry?',
    options,
  );
}
