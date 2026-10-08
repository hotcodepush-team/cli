import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HotCodePush } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { resolveBundleLabel } from '../../utils/bundle-resolution.js';
import { withTemporaryDirectory } from '../../utils/compressed-files.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { SigningKeyUnavailableError } from '../../utils/errors.js';
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
import { readPackageJson } from '../../utils/package-json.js';
import { createReporter, resolveByteText } from '../../utils/progress.js';
import type { ProjectConfig } from '../../utils/project-config.js';
import { locateProjectConfig } from '../../utils/project-config.js';
import { promptText } from '../../utils/prompts.js';
import { fetchAppId } from '../../utils/resource-resolution.js';
import { readSigningKeyPair } from '../../utils/signing-private-key.js';
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
  privateKeyPath?: string;
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
      "The web build to upload, hotcodepush.json's dir or the framework's output by default; on React Native and Expo one platform's prepared bundle.",
    ),
  platform: platformListSchema
    .optional()
    .describe('The platforms the bundle serves, ios,android by default.'),
  privateKeyPath: z
    .string()
    .optional()
    .describe(
      'The private key file to sign with, as signing-key create wrote it; HOTCODEPUSH_SIGNING_KEY holds its content in CI.',
    ),
};

export default defineCommand({
  description:
    'Upload a build as a bundle, signed where a key is configured: only the files the app lacks move, then the packs; nothing is released.',
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
 * A line per bundle, or under `--json` always an array, one bundle or one per platform, as `release create` prints its releases.
 */
function printUploadedBundles(
  uploadedBundles: UploadedBundle[],
  isJson: boolean | undefined,
): void {
  for (const { warnings } of uploadedBundles) {
    printWarnings(warnings);
  }
  if (isJson) {
    printJson(uploadedBundles.map(resolveUploadedBundleJson));
  } else {
    uploadedBundles.forEach(printUploadedBundle);
  }
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
 * uploads only once confirmed, and its dry run, which uploads nothing, resolves them without the private key.
 */
export async function resolveUploadBundleOptions(
  hotCodePush: HotCodePush,
  options: BundleUploadOptions,
  packagingDirectoryPath: string,
  { isDryRun = false }: { isDryRun?: boolean } = {},
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
    signingPrivateKey: await readSigningPrivateKey(
      appId,
      projectConfig,
      options.privateKeyPath,
      isDryRun,
    ),
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
 * or it names another app than the one `--app` meant, whose keys it does not hold. A dry run signs nothing, so a key
 * given is checked against the listed ones and none is required.
 */
async function readSigningPrivateKey(
  appId: string,
  projectConfig: ProjectConfig | undefined,
  privateKeyPath: string | undefined,
  isDryRun: boolean,
): Promise<string | null> {
  const publicKeys =
    projectConfig?.appId === appId ? (projectConfig.publicKeys ?? []) : [];
  try {
    return (
      (await readSigningKeyPair(publicKeys, privateKeyPath))?.privateKey ?? null
    );
  } catch (error) {
    if (isDryRun && error instanceof SigningKeyUnavailableError) {
      return null;
    }
    throw error;
  }
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
  if (existsSync(join(directoryPath, 'package.json'))) {
    const { version } = readPackageJson(directoryPath);
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
