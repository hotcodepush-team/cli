import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import type { App, User } from '@hotcodepush/node';
import {
  ConfigurationSchema,
  ProjectConfigurationSchema,
  resolveSigningKeyFingerprint,
} from '@hotcodepush/protocol';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import {
  INIT_MANUAL_STEP,
  PACKAGE_JSON,
  PROJECT_CONFIG_FILE_NAME,
} from '../config/consts.js';
import { createApiClient } from '../utils/api-client.js';
import type { PackageJson } from '../utils/binary-create-hook.js';
import { readPackageJson } from '../utils/binary-create-hook.js';
import {
  fetchCurrentUser,
  isUnauthenticatedError,
  resolveCredentialText,
} from '../utils/credential.js';
import { isCi, isOfflineBuild } from '../utils/environment.js';
import { resolveCliError } from '../utils/error-mapping.js';
import {
  CliError,
  InvalidJsonError,
  NotLoggedInError,
  ReportedFailureError,
  SigningKeyUnavailableError,
  UnknownFrameworkError,
} from '../utils/errors.js';
import { detectFramework } from '../utils/framework.js';
import type {
  FrameworkCheck,
  FrameworkModule,
} from '../utils/frameworks/index.js';
import { resolveFrameworkModule } from '../utils/frameworks/index.js';
import {
  readInstalledPackageVersion,
  readSdkDependencyVersion,
} from '../utils/frameworks/sdk-package.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { resolveFilesBaseUrl, resolveUpdatesBaseUrl } from '../utils/hosts.js';
import { readJsonFile } from '../utils/json-file.js';
import { printOutcomeRows } from '../utils/outcome.js';
import { printJson, resolveQuantityText } from '../utils/output.js';
import type { ProjectConfig } from '../utils/project-config.js';
import {
  locateProjectConfigFile,
  readProjectConfigFile,
  resolveProjectChannel,
} from '../utils/project-config.js';
import {
  fetchChannels,
  fetchResourceId,
  fetchSigningKeys,
} from '../utils/resource-resolution.js';
import { readSigningKeyPair } from '../utils/signing-private-key.js';
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
 * a framework the CLI cannot name, from a `package.json` that names none or does not parse, and a configuration
 * that does not parse are carried as the errors that say so, which their own checks report.
 */
interface Project {
  directoryPath: string;
  framework: FrameworkModule | CliError;
  packageJson: PackageJson | undefined;
  projectConfig: ProjectConfig | undefined;
  projectConfigError?: InvalidJsonError;
}

interface SessionAndAppChecks {
  app: App | undefined;
  checks: DoctorCheck[];
}

const CHANNEL_NAME_SCHEMA = ProjectConfigurationSchema.shape.channel;

const ID_SCHEMA = z.guid();

const PLATFORMS: Platform[] = ['android', 'ios'];

const PROBE_TIMEOUT_MS = 5000;

export default defineCommand({
  description:
    'Check the project: its configuration, the hook wiring, the resource files, the hosts and the versions a bug report needs.',
  examples: ['hotcodepush doctor', 'hotcodepush doctor --json'],
  options: defineCommandOptions({}),
  action: async options => {
    const project = readProject(options.config);
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

/**
 * The project the checks read; a configuration that does not parse leaves the configuration out and is kept for its check.
 */
function readProject(configPath: string | undefined): Project {
  const { directoryPath, filePath } = locateProjectConfigFile(configPath);
  const framework = resolveProjectFramework(directoryPath);
  const project: Project = {
    directoryPath,
    framework,
    packageJson:
      framework instanceof CliError
        ? undefined
        : readPackageJson(directoryPath),
    projectConfig: undefined,
  };
  if (filePath === undefined) {
    return project;
  }
  try {
    return { ...project, projectConfig: readProjectConfigFile(filePath) };
  } catch (error) {
    if (!(error instanceof InvalidJsonError)) {
      throw error;
    }
    return { ...project, projectConfigError: error };
  }
}

function checkConfiguration({
  directoryPath,
  framework,
  projectConfig,
  projectConfigError,
}: Project): DoctorCheck {
  if (projectConfigError !== undefined) {
    return resolveFailedCheck('configuration', projectConfigError);
  }
  if (projectConfig === undefined) {
    return {
      check: 'configuration',
      manualStep: INIT_MANUAL_STEP,
      message: `no ${PROJECT_CONFIG_FILE_NAME} up from ${directoryPath}`,
      status: 'failed',
    };
  }
  // a framework whose upload packages the bundle itself has no build output for `dir` to name
  const isDirRequired =
    framework instanceof CliError || framework.packageBundles === undefined;
  const problems = resolveConfigurationProblems(projectConfig, isDirRequired);
  if (problems.length > 0) {
    return {
      check: 'configuration',
      manualStep: INIT_MANUAL_STEP,
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
 * The credential — a session or `HOTCODEPUSH_TOKEN` — and with one the app and channel the configuration names as the API knows them;
 * a credential the API refuses, or an API that cannot be asked, fails the session and leaves the app out.
 */
async function checkSessionAndApp({
  projectConfig,
}: Project): Promise<SessionAndAppChecks> {
  let user: User;
  try {
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
    user = await fetchCurrentUser();
  } catch (error) {
    return { app: undefined, checks: [resolveFailedSessionCheck(error)] };
  }
  const sessionCheck: DoctorCheck = {
    check: 'session',
    message: resolveCredentialText(user),
    status: 'ok',
  };
  const { app, check } = await checkApp(projectConfig);
  return { app, checks: [sessionCheck, check] };
}

function resolveFailedSessionCheck(error: unknown): DoctorCheck {
  if (isUnauthenticatedError(error) || error instanceof NotLoggedInError) {
    return {
      check: 'session',
      manualStep: 'run hotcodepush login, or set a valid HOTCODEPUSH_TOKEN',
      message: 'the API does not accept the credential',
      status: 'failed',
    };
  }
  const { fix, message } = resolveCliError(error);
  return {
    check: 'session',
    manualStep: fix ?? undefined,
    message: `the credential cannot be checked: ${message}`,
    status: 'failed',
  };
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
        manualStep: INIT_MANUAL_STEP,
        message: `the API does not know the app or the channel: ${error instanceof Error ? error.message : String(error)}`,
        status: 'failed',
      },
    };
  }
}

/**
 * Whether signing works for the project: the public keys `hotcodepush.json` lists are registered with the app, where a session
 * lets the API be asked, and the private key `HOTCODEPUSH_SIGNING_KEY` holds, when set, belongs to one of them; no file is
 * looked for, since an upload is told where its key is. A key the app has and the file does not list fails, since a build
 * from that file would verify nothing and an upload would go unsigned; so does a key that cannot be read or an API that cannot be asked.
 */
async function checkSigningKey(
  { projectConfig }: Project,
  app: App | undefined,
): Promise<DoctorCheck> {
  const publicKeys =
    projectConfig?.appId === undefined ? [] : (projectConfig.publicKeys ?? []);
  if (publicKeys.length === 0 && app?.hasSigningKey) {
    return {
      check: 'signing-key',
      manualStep: `run hotcodepush signing-key list --json and add each publicKey to publicKeys in ${PROJECT_CONFIG_FILE_NAME}`,
      message: `the app has a signing key and ${PROJECT_CONFIG_FILE_NAME} lists none`,
      status: 'failed',
    };
  }
  try {
    const unregisteredKeyCount =
      app === undefined || publicKeys.length === 0
        ? 0
        : await fetchUnregisteredPublicKeyCount(app.id, publicKeys);
    if (unregisteredKeyCount > 0) {
      return {
        check: 'signing-key',
        manualStep:
          'run hotcodepush signing-key list --json and keep in publicKeys only the keys it prints',
        message: `${PROJECT_CONFIG_FILE_NAME} lists ${resolveQuantityText(unregisteredKeyCount, 'public key')} the app has not registered`,
        status: 'failed',
      };
    }
    return await checkSigningPrivateKey(publicKeys);
  } catch (error) {
    return resolveFailedCheck('signing-key', error);
  }
}

/**
 * The private key `HOTCODEPUSH_SIGNING_KEY` holds against the listed public keys: none set while keys are listed is fine,
 * the upload being told where its key is.
 */
async function checkSigningPrivateKey(
  publicKeys: string[],
): Promise<DoctorCheck> {
  try {
    const signingKeyPair = await readSigningKeyPair(publicKeys, undefined);
    return signingKeyPair === null
      ? {
          check: 'signing-key',
          message: 'code signing is off; signing-key create turns it on',
          status: 'skipped',
        }
      : {
          check: 'signing-key',
          message: `HOTCODEPUSH_SIGNING_KEY signs with key ${resolveSigningKeyFingerprint(signingKeyPair.publicKey)}`,
          status: 'ok',
        };
  } catch (error) {
    if (error instanceof SigningKeyUnavailableError) {
      return {
        check: 'signing-key',
        message:
          'code signing is on; an upload signs with --private-key-path or HOTCODEPUSH_SIGNING_KEY',
        status: 'ok',
      };
    }
    throw error;
  }
}

/**
 * How many of the listed public keys the app has not registered: an upload signed with one is refused.
 */
async function fetchUnregisteredPublicKeyCount(
  appId: string,
  publicKeys: string[],
): Promise<number> {
  const registeredPublicKeys = new Set(
    (await fetchSigningKeys(createApiClient(), appId)).map(
      ({ publicKey }) => publicKey,
    ),
  );
  return publicKeys.filter(publicKey => !registeredPublicKeys.has(publicKey))
    .length;
}

/**
 * The framework's SDK package and binary create step, then the resource file of each platform and whether a build here
 * creates its binary; a project without a framework the CLI knows gets the one row that says so.
 */
function checkFramework(project: Project): DoctorCheck[] {
  const { framework } = project;
  if (framework instanceof CliError) {
    return [resolveFailedCheck('framework', framework)];
  }
  return [
    ...framework.checkWiring(project),
    ...PLATFORMS.map(platform =>
      checkResourceFile(project, framework, platform),
    ),
    checkBinaryCreation(),
  ];
}

/**
 * Whether the build step creates the binary, as binary create decides it without --register: under CI it does,
 * a local build writes its resource file alone, and HOTCODEPUSH_OFFLINE asks the API nothing.
 */
function checkBinaryCreation(): DoctorCheck {
  if (isOfflineBuild()) {
    return {
      check: 'binary',
      message:
        'HOTCODEPUSH_OFFLINE is set, so a build asks the API nothing and creates no binary',
      status: 'skipped',
    };
  }
  if (isCi()) {
    return {
      check: 'binary',
      message: 'CI is set, so a build creates its binary',
      status: 'ok',
    };
  }
  return {
    check: 'binary',
    message:
      'a local build creates no binary; a build under CI or with binary create --register creates one',
    status: 'skipped',
  };
}

/**
 * The resource file the hook wrote into the native project, parsed as the SDK parses it and naming the configured app;
 * one that is no JSON, a write cut short, is rebuilt rather than corrected.
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
  let resourceFile: unknown;
  try {
    resourceFile = readJsonFile(filePath);
  } catch (error) {
    if (!(error instanceof InvalidJsonError)) {
      throw error;
    }
    return {
      check,
      manualStep: framework.binaryCreateStep,
      message: error.message,
      status: 'failed',
    };
  }
  const parsed = ConfigurationSchema.safeParse(resourceFile);
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
 * The API, the files host and the updates host answer; any HTTP answer counts, a network error does not, and a config.json
 * that does not parse names no host to ask.
 */
async function checkHosts(): Promise<DoctorCheck> {
  let apiUrl: string;
  try {
    apiUrl = readApiUrl();
  } catch (error) {
    return resolveFailedCheck('hosts', error);
  }
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
  const versions = [
    `${PACKAGE_JSON.name} ${PACKAGE_JSON.version}`,
    `node ${process.version}`,
  ];
  if (!(framework instanceof CliError)) {
    versions.push(
      ...framework.versionedPackageNames.map(
        packageName =>
          `${packageName} ${readInstalledPackageVersion(directoryPath, packageName) ?? packageJson?.dependencies?.[packageName] ?? 'missing'}`,
      ),
      ...(framework.versionedSdkDependencyNames ?? []).map(
        packageName =>
          `${packageName} ${readSdkDependencyVersion(directoryPath, framework.packageName, packageName) ?? 'missing'}`,
      ),
    );
  }
  return { check: 'versions', message: versions.join(', '), status: 'ok' };
}

/**
 * A check that could not be made, failed with what the error says happened and its fix as the manual step.
 */
function resolveFailedCheck(check: string, error: unknown): DoctorCheck {
  const { fix, message } = resolveCliError(error);
  return {
    check,
    manualStep: fix ?? undefined,
    message,
    status: 'failed',
  };
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
): FrameworkModule | CliError {
  try {
    return resolveFrameworkModule(detectFramework(directoryPath));
  } catch (error) {
    if (
      error instanceof UnknownFrameworkError ||
      error instanceof InvalidJsonError
    ) {
      return error;
    }
    throw error;
  }
}
