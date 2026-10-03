import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ConfigurationSchema,
  ProjectConfigurationSchema,
} from '@hotcodepush/protocol';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { PACKAGE_JSON, PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';
import { createApiClient } from '../utils/api-client.js';
import {
  fetchCurrentUser,
  isUnauthenticatedError,
  resolveCredentialText,
} from '../utils/credential.js';
import type { PackageJson } from '../utils/embed-hook.js';
import { readPackageJson } from '../utils/embed-hook.js';
import {
  CliError,
  NotLoggedInError,
  ReportedFailureError,
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
import { readToken } from '../utils/token-store.js';
import type { Platform } from '../utils/upload.js';
import { readApiUrl } from '../utils/user-config.js';

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
    const checks: DoctorCheck[] = [
      checkConfiguration(project),
      ...(await checkSessionAndApp(project)),
      ...checkFramework(project),
      await checkHosts(),
      {
        check: 'signing-key',
        message: 'code signing arrives with milestone 3',
        status: 'skipped',
      },
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
  const problems = resolveConfigurationProblems(projectConfig);
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
    message: `${PROJECT_CONFIG_FILE_NAME} names app ${projectConfig.appId} and channel ${resolveProjectChannel(projectConfig)}, web build at ${projectConfig.dir}`,
    status: 'ok',
  };
}

/**
 * What keeps the file from naming a valid app, channel and web build; a file without `channel` follows the schema's default.
 */
function resolveConfigurationProblems(projectConfig: ProjectConfig): string[] {
  const problems = (['appId', 'dir'] as const)
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
}: Project): Promise<DoctorCheck[]> {
  if (readToken() === undefined) {
    return [
      {
        check: 'session',
        message: 'not logged in; the app is not checked against the API',
        status: 'skipped',
      },
    ];
  }
  try {
    const sessionCheck: DoctorCheck = {
      check: 'session',
      message: resolveCredentialText(await fetchCurrentUser()),
      status: 'ok',
    };
    return [sessionCheck, await checkApp(projectConfig)];
  } catch (error) {
    if (
      !isUnauthenticatedError(error) &&
      !(error instanceof NotLoggedInError)
    ) {
      throw error;
    }
    return [
      {
        check: 'session',
        manualStep: 'run hotcodepush login, or set a valid HOTCODEPUSH_TOKEN',
        message: 'the API does not accept the credential',
        status: 'failed',
      },
    ];
  }
}

async function checkApp(
  projectConfig: ProjectConfig | undefined,
): Promise<DoctorCheck> {
  if (
    projectConfig?.appId === undefined ||
    !ID_SCHEMA.safeParse(projectConfig.appId).success
  ) {
    return {
      check: 'app',
      message: 'the configuration names no app and channel to check',
      status: 'skipped',
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
      check: 'app',
      message: `app ${app.name}, channel ${channel.name}`,
      status: 'ok',
    };
  } catch (error) {
    return {
      check: 'app',
      manualStep: INIT_STEP,
      message: `the API does not know the app or the channel: ${error instanceof Error ? error.message : String(error)}`,
      status: 'failed',
    };
  }
}

/**
 * The framework's SDK package and embed step, then the resource file of each platform; a project without a framework
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
  const relativeFilePath = relative(directoryPath, filePath);
  if (!existsSync(filePath)) {
    return {
      check,
      manualStep: framework.embedStep,
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
      manualStep: framework.embedStep,
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
      manualStep: framework.embedStep,
      message: `${relativeFilePath} names another app`,
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
