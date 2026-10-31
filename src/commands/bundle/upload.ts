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
import { printJson } from '../../utils/output.js';
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

const FINGERPRINT_UNKNOWN_TEXT =
  'No binary of the app carries this fingerprint.';

const PLATFORMS: Platform[] = ['android', 'ios'];

// Validated in the schema, so a wrong platform is reported under the flag name.
const platformListSchema = z
  .string()
  .transform(value => value.split(',').map(platform => platform.trim()))
  .pipe(z.array(z.enum(PLATFORMS)).min(1));

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
      "The build to upload, the framework's build output by default: on React Native and Expo one platform's prepared bundle, Capacitor's webDir or Cordova's www.",
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
    'Upload a build as a bundle, signed where a key is configured: only the files the app lacks move, then the full pack; nothing is released.',
  examples: [
    'hotcodepush bundle upload',
    'hotcodepush bundle upload --path dist --bundle-version 1.4.2 --platform ios --json',
  ],
  options: defineCommandOptions(bundleUploadOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const uploadedBundles = await withTemporaryDirectory(
      async packagingDirectoryPath => {
        const { bundleUploads } = await resolveUploadBundleOptions(
          hotCodePush,
          options,
          packagingDirectoryPath,
        );
        const bundles: UploadedBundle[] = [];
        for (const uploadBundleOptions of bundleUploads) {
          bundles.push(await uploadBundle(hotCodePush, uploadBundleOptions));
        }
        // All platform bundles share the project fingerprint, so one check covers them.
        const [sharedOptions] = bundleUploads;
        if (
          sharedOptions !== undefined &&
          (await fetchIsFingerprintUnknown(hotCodePush, sharedOptions))
        ) {
          process.stderr.write(`Warning: ${FINGERPRINT_UNKNOWN_TEXT}\n`);
        }
        return bundles;
      },
    );
    printUploadedBundles(uploadedBundles, options.json);
  },
});

// An app without any binary stays silent, since its first store build is still to come.
async function fetchIsFingerprintUnknown(
  hotCodePush: HotCodePush,
  { appId, fingerprint }: Pick<UploadBundleOptions, 'appId' | 'fingerprint'>,
): Promise<boolean> {
  const { count: fingerprintBinaryCount } =
    await hotCodePush.apps.binaries.count({ appId, fingerprint });
  if (fingerprintBinaryCount > 0) {
    return false;
  }
  const { count: binaryCount } = await hotCodePush.apps.binaries.count({
    appId,
  });
  return binaryCount > 0;
}

// `--json` always prints an array, as `release create` prints its releases.
function printUploadedBundles(
  uploadedBundles: UploadedBundle[],
  isJson: boolean | undefined,
): void {
  if (isJson) {
    printJson(uploadedBundles.map(resolveUploadedBundleJson));
  } else {
    uploadedBundles.forEach(printUploadedBundle);
  }
}

function resolveUploadedBundleJson({ bundle, upload }: UploadedBundle): object {
  return { ...bundle, upload };
}

function printUploadedBundle({ bundle, upload }: UploadedBundle): void {
  console.log(
    `Uploaded bundle ${resolveBundleLabel(bundle)} (${bundle.id}): ${upload.fileCount} files moved, ${resolveByteText(upload.sizeBytes)}.`,
  );
}

// Nothing is uploaded here, so `release create` can resolve before it confirms.
// Its dry run resolves without the private key.
export async function resolveUploadBundleOptions(
  hotCodePush: HotCodePush,
  options: BundleUploadOptions,
  packagingDirectoryPath: string,
  { isDryRun = false }: { isDryRun?: boolean } = {},
): Promise<{ appId: string; bundleUploads: UploadBundleOptions[] }> {
  const { directoryPath, projectConfig } = locateProjectConfig(options.config);
  const framework = resolveFrameworkModule(detectFramework(directoryPath));
  const appId = await fetchAppId(hotCodePush, options, projectConfig);
  const sharedOptions = {
    appId,
    bundleVersion: await resolveBundleVersion(options, directoryPath),
    fingerprint: await readFingerprint(
      directoryPath,
      projectConfig?.extraFingerprintPaths ?? [],
    ),
    gitProvenance: await resolveGitProvenance(directoryPath, options),
    nativeGluePaths: framework.nativeGluePaths,
    reporter: createReporter(options),
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
              '--path',
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
  return {
    appId,
    bundleUploads: packagedBundles.map(packagedBundle => ({
      ...sharedOptions,
      ...packagedBundle,
    })),
  };
}

// Signing is off when `hotcodepush.json` lists no public key or names another app than `--app` meant.
// A dry run signs nothing, so a given key is checked but none is required.
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

// The package.json version is the label a team already keeps.
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
