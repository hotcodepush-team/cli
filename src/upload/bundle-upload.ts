import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HotCodePush } from '@hotcodepush/node';
import { z } from 'zod';
import {
  detectFramework,
  readInputDirectoryPath,
} from '../frameworks/framework.js';
import type { FrameworkModule } from '../frameworks/index.js';
import { resolveFrameworkModule } from '../frameworks/index.js';
import type { PlatformOptions } from '../frameworks/platform.js';
import {
  platformOptionShape,
  resolvePlatform,
} from '../frameworks/platform.js';
import { fetchAppId } from '../resources/apps.js';
import { SigningKeyUnavailableError } from '../utils/errors.js';
import { readPackageJson } from '../utils/package-json.js';
import { createReporter } from '../utils/progress.js';
import type {
  ProjectConfig,
  ProjectConfigLocation,
} from '../utils/project-config.js';
import { locateProjectConfig } from '../utils/project-config.js';
import { promptText } from '../utils/prompts.js';
import { readFingerprint } from './fingerprint.js';
import { resolveGitProvenance } from './git-provenance.js';
import type { GitProvenanceOptions } from './git-provenance.js';
import { readSigningKeyPair } from './signing-private-key.js';
import type { Platform, UploadBundleOptions } from './upload.js';
import { PLATFORMS } from './upload.js';

export interface BundleUploadOptions
  extends GitProvenanceOptions, PlatformOptions {
  app?: string;
  bundleVersion?: string;
  config?: string;
  organization?: string;
  path?: string;
  privateKeyPath?: string;
}

export const bundleUploadOptionShape = {
  ...platformOptionShape,
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
  privateKeyPath: z
    .string()
    .optional()
    .describe(
      'The private key file to sign with, as signing-key create wrote it. In CI, HOTCODEPUSH_SIGNING_KEY holds its content.',
    ),
};

// Nothing is uploaded yet, so `release create` can resolve before it confirms.
// Its dry run resolves without the private key.
export async function buildBundleUpload(
  hotCodePush: HotCodePush,
  {
    isDryRun = false,
    options,
    packagingDirectoryPath,
  }: {
    isDryRun?: boolean;
    options: BundleUploadOptions;
    packagingDirectoryPath: string;
  },
): Promise<UploadBundleOptions> {
  const project = locateProjectConfig(options.config);
  const framework = resolveFrameworkModule(
    detectFramework(project.directoryPath),
  );
  const appId = await fetchAppId(hotCodePush, {
    options,
    projectConfig: project.projectConfig,
  });
  const platform = await resolvePlatform(framework, options);
  const sharedUploadOptions = await readSharedUploadOptions(project, {
    appId,
    framework,
    isDryRun,
    options,
  });
  return {
    ...sharedUploadOptions,
    directoryPath: await packageBundle(framework, {
      options,
      packagingDirectoryPath,
      platform,
      projectDirectoryPath: project.directoryPath,
    }),
    platforms: platform === null ? PLATFORMS : [platform],
  };
}

// A framework without its own packaging uploads its build output for every platform at once.
// The platform is null only on such a framework, since `resolvePlatform` asks for it everywhere else.
async function packageBundle(
  framework: FrameworkModule,
  {
    options,
    packagingDirectoryPath,
    platform,
    projectDirectoryPath,
  }: {
    options: BundleUploadOptions;
    packagingDirectoryPath: string;
    platform: Platform | null;
    projectDirectoryPath: string;
  },
): Promise<string> {
  if (framework.packageBundle !== undefined && platform !== null) {
    return framework.packageBundle({
      packagingDirectoryPath,
      path: options.path,
      platform,
      projectDirectoryPath,
    });
  }
  return readInputDirectoryPath(options, {
    framework,
    pathFlag: '--path',
    projectDirectoryPath,
  });
}

async function readSharedUploadOptions(
  { directoryPath, projectConfig }: ProjectConfigLocation,
  {
    appId,
    framework,
    isDryRun,
    options,
  }: {
    appId: string;
    framework: FrameworkModule;
    isDryRun: boolean;
    options: BundleUploadOptions;
  },
): Promise<Omit<UploadBundleOptions, 'directoryPath' | 'platforms'>> {
  return {
    appId,
    bundleVersion: await resolveBundleVersion(options, directoryPath),
    fingerprint: await readFingerprint(
      directoryPath,
      projectConfig?.extraFingerprintPaths ?? [],
    ),
    gitProvenance: await resolveGitProvenance(directoryPath, options),
    nativeGluePaths: framework.nativeGluePaths,
    reporter: createReporter(options),
    signingPrivateKey: await readSigningPrivateKey(projectConfig, {
      appId,
      isDryRun,
      privateKeyPath: options.privateKeyPath,
    }),
  };
}

// Signing is off when `hotcodepush.json` lists no public key or names another app than `--app` meant.
// A dry run signs nothing, so a given key is checked but none is required.
async function readSigningPrivateKey(
  projectConfig: ProjectConfig | undefined,
  {
    appId,
    isDryRun,
    privateKeyPath,
  }: { appId: string; isDryRun: boolean; privateKeyPath: string | undefined },
): Promise<string | null> {
  const publicKeys =
    projectConfig?.appId === appId ? (projectConfig.publicKeys ?? []) : [];
  try {
    return (
      (await readSigningKeyPair(publicKeys, { privateKeyPath }))?.privateKey ??
      null
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
  return promptText(options, {
    flag: '--bundle-version',
    message: 'Which version label does the bundle carry?',
  });
}
