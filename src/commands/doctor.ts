import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ConfigurationSchema } from '@hotcodepush/protocol';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import {
  CAPACITOR_PACKAGE_NAME,
  EMBED_HOOK_NAME,
  PACKAGE_JSON,
  PROJECT_CONFIG_FILE_NAME,
} from '../config/consts.js';
import { createApiClient } from '../utils/api-client.js';
import { createApiAuthClient, fetchSession } from '../utils/auth-client.js';
import type { PackageJson } from '../utils/embed-hook.js';
import { readPackageJson, resolveEmbedHookState } from '../utils/embed-hook.js';
import { NotLoggedInError, ReportedFailureError } from '../utils/errors.js';
import { resolveNativeProjectPaths } from '../utils/framework.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { resolveFilesBaseUrl, resolveUpdatesBaseUrl } from '../utils/hosts.js';
import { printOutcomeRows } from '../utils/outcome.js';
import { printJson } from '../utils/output.js';
import type { ProjectConfig } from '../utils/project-config.js';
import { locateProjectConfig } from '../utils/project-config.js';
import { resolveResourceFilePath } from '../utils/resource-file.js';
import { readToken } from '../utils/token-store.js';
import type { Platform } from '../utils/upload.js';
import { readApiUrl } from '../utils/user-config.js';
import {
  hasResourceReference,
  resolveXcodeProjectFilePath,
} from '../utils/xcode-project.js';

interface DoctorCheck {
  check: string;
  manualStep?: string;
  message: string;
  status: 'failed' | 'ok' | 'skipped';
}

/**
 * What every check reads: the project, its configuration and its `package.json`, located once.
 */
interface Project {
  directoryPath: string;
  packageJson: PackageJson | undefined;
  projectConfig: ProjectConfig | undefined;
}

const ID_SCHEMA = z.guid();

const INIT_STEP = 'run hotcodepush init';

const PLATFORMS: Platform[] = ['android', 'ios'];

const PROBE_TIMEOUT_MS = 5000;

const SYNC_STEP = 'run npx cap sync, which runs the embed hook';

export default defineCommand({
  action: async options => {
    const { directoryPath, projectConfig } = locateProjectConfig(
      options.config,
    );
    const project: Project = {
      directoryPath,
      packageJson: existsSync(join(directoryPath, 'package.json'))
        ? readPackageJson(directoryPath)
        : undefined,
      projectConfig,
    };
    const checks: DoctorCheck[] = [
      checkConfiguration(project),
      ...(await checkSessionAndApp(project)),
      checkPackage(project),
      checkHook(project),
      checkXcodeProject(project),
      ...PLATFORMS.map(platform => checkResourceFile(project, platform)),
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
  description:
    'Check the project: its configuration, the hook wiring, the resource files, the hosts and the versions a bug report needs.',
  examples: ['hotcodepush doctor', 'hotcodepush doctor --json'],
  options: defineCommandOptions({}),
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
  const missingFields = (['appId', 'channelId', 'dir'] as const).filter(
    field => projectConfig[field] === undefined,
  );
  const invalidIds = (['appId', 'channelId'] as const).filter(
    field =>
      projectConfig[field] !== undefined &&
      !ID_SCHEMA.safeParse(projectConfig[field]).success,
  );
  if (missingFields.length > 0 || invalidIds.length > 0) {
    return {
      check: 'configuration',
      manualStep: INIT_STEP,
      message: `${PROJECT_CONFIG_FILE_NAME} ${[
        ...missingFields.map(field => `lacks ${field}`),
        ...invalidIds.map(field => `has a ${field} that is no id`),
      ].join(', ')}`,
      status: 'failed',
    };
  }
  return {
    check: 'configuration',
    message: `${PROJECT_CONFIG_FILE_NAME} names app ${projectConfig.appId} and channel ${projectConfig.channelId}, web build at ${projectConfig.dir}`,
    status: 'ok',
  };
}

/**
 * The session, and with one the app and channel the configuration names as the API knows them.
 */
async function checkSessionAndApp({
  projectConfig,
}: Project): Promise<DoctorCheck[]> {
  const token = readToken();
  if (token === undefined) {
    return [
      {
        check: 'session',
        message: 'not logged in; the app is not checked against the API',
        status: 'skipped',
      },
    ];
  }
  try {
    const { user } = await fetchSession(createApiAuthClient(token));
    const sessionCheck: DoctorCheck = {
      check: 'session',
      message: `logged in as ${user.name} (${user.email})`,
      status: 'ok',
    };
    return [sessionCheck, await checkApp(projectConfig)];
  } catch (error) {
    if (!(error instanceof NotLoggedInError)) {
      throw error;
    }
    return [
      {
        check: 'session',
        manualStep: 'run hotcodepush login',
        message: 'the session has expired',
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
    projectConfig.channelId === undefined ||
    !ID_SCHEMA.safeParse(projectConfig.appId).success ||
    !ID_SCHEMA.safeParse(projectConfig.channelId).success
  ) {
    return {
      check: 'app',
      message: 'the configuration names no app and channel to check',
      status: 'skipped',
    };
  }
  const hotCodePush = createApiClient();
  try {
    const [app, channel] = await Promise.all([
      hotCodePush.apps.get({ appId: projectConfig.appId }),
      hotCodePush.apps.channels.get({
        appId: projectConfig.appId,
        channelId: projectConfig.channelId,
      }),
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

function checkPackage({ directoryPath, packageJson }: Project): DoctorCheck {
  const declaredSpec =
    packageJson?.dependencies?.[CAPACITOR_PACKAGE_NAME] ??
    packageJson?.devDependencies?.[CAPACITOR_PACKAGE_NAME];
  if (declaredSpec === undefined) {
    return {
      check: 'package',
      manualStep: INIT_STEP,
      message: `${CAPACITOR_PACKAGE_NAME} is not in package.json`,
      status: 'failed',
    };
  }
  const installedVersion = readInstalledVersion(
    directoryPath,
    CAPACITOR_PACKAGE_NAME,
  );
  if (installedVersion === undefined) {
    return {
      check: 'package',
      manualStep: 'install the dependencies',
      message: `${CAPACITOR_PACKAGE_NAME} is declared but not in node_modules`,
      status: 'failed',
    };
  }
  return {
    check: 'package',
    message: `${CAPACITOR_PACKAGE_NAME} ${installedVersion} installed`,
    status: 'ok',
  };
}

function checkHook({ packageJson }: Project): DoctorCheck {
  const state =
    packageJson === undefined ? 'absent' : resolveEmbedHookState(packageJson);
  switch (state) {
    case 'wired':
      return {
        check: 'hook',
        message: `${EMBED_HOOK_NAME} runs the embed step`,
        status: 'ok',
      };
    case 'unparseable':
      return {
        check: 'hook',
        manualStep: `add "npx hotcodepush bundle embed" to the ${EMBED_HOOK_NAME} script by hand`,
        message: `${EMBED_HOOK_NAME} runs a script without the embed step`,
        status: 'failed',
      };
    default:
      return {
        check: 'hook',
        manualStep: INIT_STEP,
        message: `${EMBED_HOOK_NAME} does not run the embed step`,
        status: 'failed',
      };
  }
}

function checkXcodeProject({ directoryPath }: Project): DoctorCheck {
  const iosProjectPath = resolveNativeProjectPaths(directoryPath).ios;
  const projectFilePath = resolveXcodeProjectFilePath(iosProjectPath);
  if (projectFilePath === undefined) {
    return {
      check: 'ios-project',
      message: `no iOS project at ${relative(directoryPath, iosProjectPath)}`,
      status: 'skipped',
    };
  }
  try {
    return hasResourceReference(projectFilePath)
      ? {
          check: 'ios-project',
          message: 'the app target copies hotcodepush.json into the bundle',
          status: 'ok',
        }
      : {
          check: 'ios-project',
          manualStep: INIT_STEP,
          message: 'the app target does not copy hotcodepush.json',
          status: 'failed',
        };
  } catch (error) {
    return {
      check: 'ios-project',
      manualStep:
        "add hotcodepush.json to the app target's Copy Bundle Resources in Xcode",
      message: error instanceof Error ? error.message : String(error),
      status: 'failed',
    };
  }
}

/**
 * The resource file the hook wrote into the native project, parsed as the SDK parses it and naming the configured app.
 */
function checkResourceFile(
  { directoryPath, projectConfig }: Project,
  platform: Platform,
): DoctorCheck {
  const check = `${platform}-resource-file`;
  const nativeProjectPath = resolveNativeProjectPaths(directoryPath)[platform];
  if (!existsSync(nativeProjectPath)) {
    return {
      check,
      message: `no ${platform} project at ${relative(directoryPath, nativeProjectPath)}`,
      status: 'skipped',
    };
  }
  const filePath = resolveResourceFilePath(platform, nativeProjectPath);
  const relativeFilePath = relative(directoryPath, filePath);
  if (!existsSync(filePath)) {
    return {
      check,
      manualStep: SYNC_STEP,
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
      manualStep: SYNC_STEP,
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
      manualStep: SYNC_STEP,
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

function checkVersions({ directoryPath, packageJson }: Project): DoctorCheck {
  const versions = [
    `${PACKAGE_JSON.name} ${PACKAGE_JSON.version}`,
    `node ${process.version}`,
    ...['@capacitor/core', CAPACITOR_PACKAGE_NAME].map(
      packageName =>
        `${packageName} ${readInstalledVersion(directoryPath, packageName) ?? packageJson?.dependencies?.[packageName] ?? 'missing'}`,
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

function readInstalledVersion(
  directoryPath: string,
  packageName: string,
): string | undefined {
  const packageJsonPath = join(
    directoryPath,
    'node_modules',
    packageName,
    'package.json',
  );
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }
  return (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson)
    .version;
}
