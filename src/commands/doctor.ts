import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { App } from '@hotcodepush/node';
import {
  ConfigurationSchema,
  ProjectConfigurationSchema,
  resolveSigningKeyFingerprint,
} from '@hotcodepush/protocol';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { PACKAGE_JSON, PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';
import { createApiClient } from '../utils/api-client.js';
import type { PackageJson } from '../utils/binary-create-hook.js';
import { readPackageJson } from '../utils/binary-create-hook.js';
import {
  fetchCurrentUser,
  isUnauthenticatedError,
  resolveCredentialText,
} from '../utils/credential.js';
import {
  CliError,
  InvalidParameterError,
  NotLoggedInError,
  ReportedFailureError,
  SigningKeyUnavailableError,
  UnknownFrameworkError,
  UnsupportedFrameworkError,
} from '../utils/errors.js';
import { detectFramework } from '../utils/framework.js';
import type {
  FrameworkCheck,
  FrameworkModule,
} from '../utils/frameworks/index.js';
import { resolveFrameworkModule } from '../utils/frameworks/index.js';
import { readInstalledPackageVersion } from '../utils/frameworks/sdk-package.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { resolveFilesBaseUrl, resolveUpdatesBaseUrl } from '../utils/hosts.js';
import { printOutcomeRows } from '../utils/outcome.js';
import { printJson } from '../utils/output.js';
import type { ProjectConfig } from '../utils/project-config.js';
import {
  locateProjectConfig,
  resolveProjectChannel,
} from '../utils/project-config.js';
import {
  fetchChannels,
  fetchResourceId,
} from '../utils/resource-resolution.js';
import { resolveSigningKeyPair } from '../utils/signing-key-store.js';
import { readToken } from '../utils/token-store.js';
import type { Platform } from '../utils/upload.js';
import { readApiUrl } from '../utils/user-config.js';

/**
 * The app check with the app it fetched, which the signing-key check reads.
 */
interface AppCheck {
  app: App | undefined;
  check: DoctorCheck;
}

type DoctorCheck = FrameworkCheck;

/**
 * What every check reads: the project, its configuration, its `package.json` and its framework, located once;
 * a project whose framework the CLI cannot name or does not package carries the error that says so.
 */
interface Project {
  directoryPath: string;
  framework: CliError | FrameworkModule;
  packageJson: PackageJson | undefined;
  projectConfig: ProjectConfig | undefined;
}

interface SessionAndAppChecks {
  app: App | undefined;
  checks: DoctorCheck[];
}

const CHANNEL_NAME_SCHEMA = ProjectConfigurationSchema.shape.channel;

const ID_SCHEMA = z.guid();

const INIT_STEP = 'run hotcodepush init';

const PLATFORMS: Platform[] = ['android', 'ios'];

const PROBE_TIMEOUT_MS = 5000;

export default defineCommand({
  description:
    'Check the project: its configuration, the hook wiring, the resource files, the hosts and the versions a bug report needs.',
  examples: ['hotcodepush doctor', 'hotcodepush doctor --json'],
  options: defineCommandOptions({}),
  action: async options => {
    const { directoryPath, projectConfig } = locateProjectConfig(
      options.config,
    );
    const project: Project = {
      directoryPath,
      framework: resolveProjectFramework(directoryPath),
      packageJson: existsSync(join(directoryPath, 'package.json'))
        ? readPackageJson(directoryPath)
        : undefined,
      projectConfig,
    };
    const { app, checks: sessionAndAppChecks } =
      await checkSessionAndApp(project);
    const checks: DoctorCheck[] = [
      checkConfiguration(project),
      ...sessionAndAppChecks,
      ...checkFramework(project),
      await checkHosts(),
      await checkSigningKey(project, app),
      checkVersions(project),
    ];
    const status = checks.some(({ status }) => status === 'failed')
      ? 'failed'
      : 'clean';
    if (options.json) {
      printJson({ checks, status });
    } else {
      printOutcomeRows(
        checks.map(({ check, manualStep, message, status }) => ({
          label: check,
          manualStep,
          message,
          status,
        })),
      );
    }
    if (status === 'failed') {
      throw new ReportedFailureError('E_DOCTOR_FAILED');
    }
  },
});

function checkConfiguration({
  directoryPath,
  framework,
  projectConfig,
}: Project): DoctorCheck {
  if (projectConfig === undefined) {
    return {
      check: 'configuration',
      manualStep: INIT_STEP,
      message: `no ${PROJECT_CONFIG_FILE_NAME} up from ${directoryPath}`,
      status: 'failed',
    };
  }
  // a framework whose upload packages the bundle itself has no build output for `dir` to name
  const isDirRequired =
    framework instanceof Error || framework.packageBundles === undefined;
  const problems = resolveConfigurationProblems(projectConfig, isDirRequired);
  if (problems.length > 0) {
    return {
      check: 'configuration',
      manualStep: INIT_STEP,
      message: `${PROJECT_CONFIG_FILE_NAME} ${problems.join(', ')}`,
      status: 'failed',
    };
  }
  return {
    check: 'configuration',
    message: `${PROJECT_CONFIG_FILE_NAME} names app ${projectConfig.appId} and channel ${resolveProjectChannel(projectConfig)}${projectConfig.dir === undefined ? '' : `, web build at ${projectConfig.dir}`}`,
    status: 'ok',
  };
}

/**
 * What keeps the file from naming a valid app, channel and, where the upload reads a build from the project, that build;
 * a file without `channel` follows the schema's default.
 */
function resolveConfigurationProblems(
  projectConfig: ProjectConfig,
  isDirRequired: boolean,
): string[] {
  const requiredFields = isDirRequired
    ? (['appId', 'dir'] as const)
    : (['appId'] as const);
  const problems = requiredFields
    .filter(field => projectConfig[field] === undefined)
    .map(field => `lacks ${field}`);
  if (
    projectConfig.appId !== undefined &&
    !ID_SCHEMA.safeParse(projectConfig.appId).success
  ) {
    problems.push('has an appId that is no id');
  }
  if (
    projectConfig.channel !== undefined &&
    !CHANNEL_NAME_SCHEMA.safeParse(projectConfig.channel).success
  ) {
    problems.push('has a channel that is no channel name');
  }
  return problems;
}

/**
 * The credential — a session or `HOTCODEPUSH_TOKEN` — and with one the app and channel the configuration names as the API knows them.
 */
async function checkSessionAndApp({
  projectConfig,
}: Project): Promise<SessionAndAppChecks> {
  if (readToken() === undefined) {
    return {
      app: undefined,
      checks: [
        {
          check: 'session',
          message: 'not logged in; the app is not checked against the API',
          status: 'skipped',
        },
      ],
    };
  }
  try {
    const sessionCheck: DoctorCheck = {
      check: 'session',
      message: resolveCredentialText(await fetchCurrentUser()),
      status: 'ok',
    };
    const { app, check } = await checkApp(projectConfig);
    return { app, checks: [sessionCheck, check] };
  } catch (error) {
    if (
      !isUnauthenticatedError(error) &&
      !(error instanceof NotLoggedInError)
    ) {
      throw error;
    }
    return {
      app: undefined,
      checks: [
        {
          check: 'session',
          manualStep: 'run hotcodepush login, or set a valid HOTCODEPUSH_TOKEN',
          message: 'the API does not accept the credential',
          status: 'failed',
        },
      ],
    };
  }
}

async function checkApp(
  projectConfig: ProjectConfig | undefined,
): Promise<AppCheck> {
  if (
    projectConfig?.appId === undefined ||
    !ID_SCHEMA.safeParse(projectConfig.appId).success
  ) {
    return {
      app: undefined,
      check: {
        check: 'app',
        message: 'the configuration names no app and channel to check',
        status: 'skipped',
      },
    };
  }
  const { appId } = projectConfig;
  const hotCodePush = createApiClient();
  try {
    const [app, channel] = await Promise.all([
      hotCodePush.apps.get({ appId }),
      fetchResourceId(
        'channel',
        resolveProjectChannel(projectConfig),
        () => fetchChannels(hotCodePush, appId),
        PROJECT_CONFIG_FILE_NAME,
      ).then(channelId => hotCodePush.apps.channels.get({ appId, channelId })),
    ]);
    return {
      app,
      check: {
        check: 'app',
        message: `app ${app.name}, channel ${channel.name}`,
        status: 'ok',
      },
    };
  } catch (error) {
    return {
      app: undefined,
      check: {
        check: 'app',
        manualStep: INIT_STEP,
        message: `the API does not know the app or the channel: ${error instanceof Error ? error.message : String(error)}`,
        status: 'failed',
      },
    };
  }
}

/**
 * Whether the keys `hotcodepush.json` lists and the keys at hand let this machine upload: signing off is skipped, as is
 * signing on without a private key here, the developer whose CI holds it; a key the app has and the file does not list
 * fails, since a build from that file would verify nothing and an upload would go unsigned.
 */
async function checkSigningKey(
  { projectConfig }: Project,
  app: App | undefined,
): Promise<DoctorCheck> {
  const appId = projectConfig?.appId;
  const publicKeys = projectConfig?.publicKeys ?? [];
  if (appId === undefined || publicKeys.length === 0) {
    return app?.hasSigningKey
      ? {
          check: 'signing-key',
          manualStep: `run hotcodepush signing-key list --json and add each publicKey to publicKeys in ${PROJECT_CONFIG_FILE_NAME}`,
          message: `the app has a signing key and ${PROJECT_CONFIG_FILE_NAME} lists none`,
          status: 'failed',
        }
      : {
          check: 'signing-key',
          message: 'code signing is off; signing-key create turns it on',
          status: 'skipped',
        };
  }
  try {
    const { publicKey } = await resolveSigningKeyPair(appId, publicKeys);
    return {
      check: 'signing-key',
      message: `uploads are signed with key ${resolveSigningKeyFingerprint(publicKey)}`,
      status: 'ok',
    };
  } catch (error) {
    if (error instanceof SigningKeyUnavailableError) {
      return {
        check: 'signing-key',
        message:
          'code signing is on; no private key on this machine, so uploads run where HOTCODEPUSH_SIGNING_KEY is set',
        status: 'skipped',
      };
    }
    if (error instanceof InvalidParameterError) {
      return {
        check: 'signing-key',
        manualStep: error.fix ?? undefined,
        message: error.message,
        status: 'failed',
      };
    }
    throw error;
  }
}

/**
 * The framework's SDK package and binary create step, then the resource file of each platform; a project without a framework
 * the CLI packages gets the one row that says so.
 */
function checkFramework(project: Project): DoctorCheck[] {
  const { framework } = project;
  if (framework instanceof CliError) {
    return [
      {
        check: 'framework',
        manualStep: framework.fix ?? undefined,
        message: framework.message,
        status: 'failed',
      },
    ];
  }
  return [
    ...framework.checkWiring(project),
    ...PLATFORMS.map(platform =>
      checkResourceFile(project, framework, platform),
    ),
  ];
}

/**
 * The resource file the hook wrote into the native project, parsed as the SDK parses it and naming the configured app.
 */
function checkResourceFile(
  { directoryPath, projectConfig }: Project,
  framework: FrameworkModule,
  platform: Platform,
): DoctorCheck {
  const check = `${platform}-resource-file`;
  const nativeProjectPath =
    framework.resolveNativeProjectPaths(directoryPath)[platform];
  if (!existsSync(nativeProjectPath)) {
    return {
      check,
      message: `no ${platform} project at ${relative(directoryPath, nativeProjectPath)}`,
      status: 'skipped',
    };
  }
  const filePath = framework.resolveResourceFilePath(
    platform,
    nativeProjectPath,
  );
  if (filePath === undefined) {
    return {
      check,
      message: `the ${platform} build writes hotcodepush.json into the app it builds`,
      status: 'skipped',
    };
  }
  const relativeFilePath = relative(directoryPath, filePath);
  if (!existsSync(filePath)) {
    return {
      check,
      manualStep: framework.binaryCreateStep,
      message: `no resource file at ${relativeFilePath}`,
      status: 'failed',
    };
  }
  const parsed = ConfigurationSchema.safeParse(
    JSON.parse(readFileSync(filePath, 'utf8')),
  );
  if (!parsed.success) {
    return {
      check,
      manualStep: framework.binaryCreateStep,
      message: `${relativeFilePath} is not a configuration the SDK reads`,
      status: 'failed',
    };
  }
  if (
    projectConfig?.appId !== undefined &&
    parsed.data.appId !== projectConfig.appId
  ) {
    return {
      check,
      manualStep: framework.binaryCreateStep,
      message: `${relativeFilePath} names another app`,
      status: 'failed',
    };
  }
  if (parsed.data.channelId === null) {
    return {
      check,
      manualStep: `log in or set HOTCODEPUSH_TOKEN, leave HOTCODEPUSH_OFFLINE unset, then ${framework.binaryCreateStep}`,
      message: `${relativeFilePath} names no channel, so the build takes no updates: it was made offline or without a token`,
      status: 'failed',
    };
  }
  return {
    check,
    message: `${relativeFilePath} built at ${parsed.data.builtAt}`,
    status: 'ok',
  };
}

/**
 * The API, the files host and the updates host answer; any HTTP answer counts, a network error does not.
 */
async function checkHosts(): Promise<DoctorCheck> {
  const apiUrl = readApiUrl();
  const hosts: [name: string, url: string][] = [
    ['api', `${apiUrl.replace(/\/+$/, '')}/health`],
    ['files', resolveFilesBaseUrl(apiUrl)],
    ['updates', resolveUpdatesBaseUrl(apiUrl)],
  ];
  const unreachable = (
    await Promise.all(
      hosts.map(async ([name, url]) =>
        (await isReachable(url)) ? undefined : `${name} (${url})`,
      ),
    )
  ).filter(host => host !== undefined);
  if (unreachable.length > 0) {
    return {
      check: 'hosts',
      manualStep:
        'check the network, the API URL in config.json and the HOTCODEPUSH_*_BASE_URL variables',
      message: `unreachable: ${unreachable.join(', ')}`,
      status: 'failed',
    };
  }
  return {
    check: 'hosts',
    message: `${hosts.map(([name]) => name).join(', ')} reachable`,
    status: 'ok',
  };
}

function checkVersions({
  directoryPath,
  framework,
  packageJson,
}: Project): DoctorCheck {
  const packageNames =
    framework instanceof CliError ? [] : framework.versionedPackageNames;
  const versions = [
    `${PACKAGE_JSON.name} ${PACKAGE_JSON.version}`,
    `node ${process.version}`,
    ...packageNames.map(
      packageName =>
        `${packageName} ${readInstalledPackageVersion(directoryPath, packageName) ?? packageJson?.dependencies?.[packageName] ?? 'missing'}`,
    ),
  ];
  return { check: 'versions', message: versions.join(', '), status: 'ok' };
}

async function isReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

/**
 * The module of the project's framework, or the error naming why the CLI has none for it.
 */
function resolveProjectFramework(
  directoryPath: string,
): CliError | FrameworkModule {
  try {
    return resolveFrameworkModule(detectFramework(directoryPath));
  } catch (error) {
    if (
      error instanceof UnknownFrameworkError ||
      error instanceof UnsupportedFrameworkError
    ) {
      return error;
    }
    throw error;
  }
}
