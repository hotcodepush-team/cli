import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HotCodePush } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { resolveBundleLabel } from '../../utils/bundle-resolution.js';
import { withTemporaryDirectory } from '../../utils/compressed-files.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { readFingerprint } from '../../utils/fingerprint.js';
import {
  detectFramework,
  resolveInputDirectoryPath,
} from '../../utils/framework.js';
import { resolveFrameworkModule } from '../../utils/frameworks/index.js';
import type { GitProvenanceOptions } from '../../utils/git-provenance.js';
import { resolveGitProvenance } from '../../utils/git-provenance.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import {
  printJson,
  printWarnings,
  resolveQuantityText,
} from '../../utils/output.js';
import { createReporter, resolveByteText } from '../../utils/progress.js';
import type { ProjectConfig } from '../../utils/project-config.js';
import { locateProjectConfig } from '../../utils/project-config.js';
import { promptText } from '../../utils/prompts.js';
import { fetchAppId } from '../../utils/resource-resolution.js';
import { resolveSigningKeyPair } from '../../utils/signing-key-store.js';
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
    'Upload a web build as a bundle, signed where a key is configured: only the files the app lacks move, then the packs; nothing is released.',
  examples: [
    'hotcodepush bundle upload',
    'hotcodepush bundle upload --path dist --bundle-version 1.4.2 --platform ios --json',
  ],
  options: defineCommandOptions(bundleUploadOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const uploadedBundles = await withTemporaryDirectory(
      async packagingDirectoryPath => {
        const bundles: UploadedBundle[] = [];
        for (const uploadBundleOptions of await resolveUploadBundleOptions(
          hotCodePush,
          options,
          packagingDirectoryPath,
        )) {
          bundles.push(await uploadBundle(hotCodePush, uploadBundleOptions));
        }
        return bundles;
      },
    );
    printUploadedBundles(uploadedBundles, options.json);
  },
});

/**
 * One bundle prints as itself, the shape a web build always had; a framework with a bundle per platform prints the list.
 */
function printUploadedBundles(
  uploadedBundles: UploadedBundle[],
  isJson: boolean | undefined,
): void {
  for (const { warnings } of uploadedBundles) {
    printWarnings(warnings);
  }
  if (!isJson) {
    uploadedBundles.forEach(printUploadedBundle);
    return;
  }
  const [onlyBundle] = uploadedBundles;
  printJson(
    onlyBundle !== undefined && uploadedBundles.length === 1
      ? resolveUploadedBundleJson(onlyBundle)
      : uploadedBundles.map(resolveUploadedBundleJson),
  );
}

function resolveUploadedBundleJson({
  bundle,
  deltaBaseBundleIds,
  patchCount,
  uploadedBytes,
  uploadedFileCount,
}: UploadedBundle): object {
  return {
    ...bundle,
    upload: {
      deltaBaseBundleIds,
      patchCount,
      uploadedBytes,
      uploadedFileCount,
    },
  };
}

function printUploadedBundle({
  bundle,
  deltaBaseBundleIds,
  patchCount,
  uploadedBytes,
  uploadedFileCount,
}: UploadedBundle): void {
  const deltaPackText = [
    ...(deltaBaseBundleIds.length === 0
      ? []
      : [resolveQuantityText(deltaBaseBundleIds.length, 'delta pack')]),
    ...(patchCount === 0 ? [] : [resolvePatchCountText(patchCount)]),
  ].join(' and ');
  console.log(
    `Uploaded bundle ${resolveBundleLabel(bundle)} (${bundle.id}): ${uploadedFileCount} files moved, ${resolveByteText(uploadedBytes)}${deltaPackText === '' ? '' : `, with ${deltaPackText}`}.`,
  );
}

function resolvePatchCountText(patchCount: number): string {
  return patchCount === 1 ? '1 patch' : `${patchCount} patches`;
}

/**
 * What each upload of the command needs, from the project's configuration and the flags, asked for where missing: one
 * bundle for a build the project holds, one per platform where the framework packages inside the upload, which it does
 * here, into the packaging directory. Nothing moves yet, so `release create` resolves them before it confirms and
 * uploads only once confirmed.
 */
export async function resolveUploadBundleOptions(
  hotCodePush: HotCodePush,
  options: BundleUploadOptions,
  packagingDirectoryPath: string,
): Promise<UploadBundleOptions[]> {
  const { directoryPath, projectConfig } = locateProjectConfig(options.config);
  const framework = resolveFrameworkModule(detectFramework(directoryPath));
  const appId = await fetchAppId(hotCodePush, options, projectConfig);
  const sharedOptions = {
    appId,
    bundleVersion: await resolveBundleVersion(options, directoryPath),
    fingerprint: await readFingerprint(
      directoryPath,
      projectConfig?.nativeSources ?? [],
    ),
    gitProvenance: await resolveGitProvenance(directoryPath, options),
    reporter: createReporter(options),
    resolveMainBundlePath: framework.resolveMainBundlePath,
    signingPrivateKey: await resolveSigningPrivateKey(appId, projectConfig),
  };
  const packagedBundles =
    framework.packageBundles === undefined
      ? [
          {
            directoryPath: await resolveInputDirectoryPath(
              options,
              projectConfig,
              directoryPath,
              framework,
            ),
            platforms: options.platform ?? PLATFORMS,
          },
        ]
      : await framework.packageBundles({
          packagingDirectoryPath,
          path: options.path,
          platforms: options.platform,
          projectDirectoryPath: directoryPath,
        });
  return packagedBundles.map(packagedBundle => ({
    ...sharedOptions,
    ...packagedBundle,
  }));
}

/**
 * The private key the manifest is signed with, null where signing is off: `hotcodepush.json` lists no public key,
 * or it names another app than the one `--app` meant, whose keys it does not hold.
 */
async function resolveSigningPrivateKey(
  appId: string,
  projectConfig: ProjectConfig | undefined,
): Promise<string | null> {
  const publicKeys =
    projectConfig?.appId === appId ? (projectConfig.publicKeys ?? []) : [];
  if (publicKeys.length === 0) {
    return null;
  }
  return (await resolveSigningKeyPair(appId, publicKeys)).privateKey;
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
