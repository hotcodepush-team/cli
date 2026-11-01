import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HotCodePush } from '@hotcodepush/node';
import { z } from 'zod';
import {
  detectFramework,
  readInputDirectoryPath,
} from '../frameworks/framework.js';
import { resolveFrameworkModule } from '../frameworks/index.js';
import { fetchAppId } from '../resources/apps.js';
import type { InteractivityOptions } from '../utils/environment.js';
import { SigningKeyUnavailableError } from '../utils/errors.js';
import { readPackageJson } from '../utils/package-json.js';
import { createReporter } from '../utils/progress.js';
import type { ProjectConfig } from '../utils/project-config.js';
import { locateProjectConfig } from '../utils/project-config.js';
import { promptText } from '../utils/prompts.js';
import { readFingerprint } from './fingerprint.js';
import { resolveGitProvenance } from './git-provenance.js';
import type { GitProvenanceOptions } from './git-provenance.js';
import { readSigningKeyPair } from './signing-private-key.js';
import type { Platform, UploadBundleOptions } from './upload.js';
import { PLATFORMS } from './upload.js';

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
      "The bundle's version label. Defaults to the project's package.json version.",
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
    .describe('Detect no git provenance. The typed --git-* flags still apply.'),
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
      'The private key file to sign with, as signing-key create wrote it. In CI, HOTCODEPUSH_SIGNING_KEY holds its content.',
    ),
};

// Nothing is uploaded here, so `release create` can resolve before it confirms.
// Its dry run resolves without the private key.
export async function fetchUploadBundleOptions(
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
            directoryPath: await readInputDirectoryPath(
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
