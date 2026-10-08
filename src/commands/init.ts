import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { App, HotCodePush, Organization } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { DOCS_URL, PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';
import { createApiClient } from '../utils/api-client.js';
import {
  fetchCurrentUser,
  isUnauthenticatedError,
  resolveCredentialText,
} from '../utils/credential.js';
import type { InteractivityOptions } from '../utils/environment.js';
import { isInteractive } from '../utils/environment.js';
import {
  ConfirmationRequiredError,
  InvalidParameterError,
  MissingParameterError,
  NotLoggedInError,
  ReportedFailureError,
  UnexpectedError,
} from '../utils/errors.js';
import type { Framework } from '../utils/framework.js';
import { detectFramework } from '../utils/framework.js';
import type {
  FrameworkModule,
  FrameworkWiring,
} from '../utils/frameworks/index.js';
import { resolveFrameworkModule } from '../utils/frameworks/index.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { resolveConsoleBaseUrl } from '../utils/hosts.js';
import type { StepOutcome } from '../utils/init-steps.js';
import { InitRun, resolveStepRows } from '../utils/init-steps.js';
import { stringifyLikeSource } from '../utils/json-file.js';
import { printOutcomeRows } from '../utils/outcome.js';
import { printJson } from '../utils/output.js';
import type { PackageJson } from '../utils/package-json.js';
import { readPackageJson } from '../utils/package-json.js';
import type { CommandLine } from '../utils/package-manager.js';
import {
  resolveCommandLineText,
  resolvePackageManager,
  resolveRunScriptCommandLine,
  runCommandLineVisibly,
} from '../utils/package-manager.js';
import type { ProjectConfig } from '../utils/project-config.js';
import {
  locateProjectConfig,
  resolveProjectChannel,
} from '../utils/project-config.js';
import {
  confirmConsequence,
  promptSelect,
  promptText,
  promptYesNo,
} from '../utils/prompts.js';
import { fetchApps, fetchOrganizations } from '../utils/resource-resolution.js';
import { readToken } from '../utils/token-store.js';
import { readApiUrl } from '../utils/user-config.js';
import { logIn } from './login.js';
import releaseCreateCommand from './release/create.js';
import signingKeyCreateCommand from './signing-key/create.js';

interface InitOptions extends InteractivityOptions {
  androidPath?: string;
  app?: string;
  config?: string;
  framework?: Framework;
  iosPath?: string;
  organization?: string;
  xcodeTarget?: string;
}

/**
 * What the run knows about the project once the app is settled: the files the remaining steps edit and what its framework wires.
 */
interface ProjectFiles {
  directoryPath: string;
  framework: FrameworkModule;
  packageJson: PackageJson;
  projectConfig: ProjectConfig | undefined;
  wiring: FrameworkWiring;
}

/**
 * What the organization step settles: the organization, and the app when `hotcodepush.json` named it.
 */
interface Scope {
  app: App | undefined;
  organization: Organization;
}

const CREATE_CHOICE = 'create';

const ID_SCHEMA = z.guid();

export default defineCommand({
  description:
    'Set a Capacitor, Cordova, Expo or React Native project up from sign-in to the first release, re-runnable at any step.',
  examples: ['hotcodepush init', 'hotcodepush init --yes --json'],
  options: defineCommandOptions({
    androidPath: z
      .string()
      .optional()
      .describe(
        "The Android project, when it is not capacitor.config's android.path or android/.",
      ),
    framework: z
      .enum(['capacitor', 'cordova', 'expo', 'react-native'])
      .optional()
      .describe('The framework, over the one detected from package.json.'),
    iosPath: z
      .string()
      .optional()
      .describe(
        "The iOS project, when it is not capacitor.config's ios.path or ios/.",
      ),
    xcodeTarget: z
      .string()
      .optional()
      .describe(
        'The app target that gets the build step phase, when the iOS project has several.',
      ),
  }),
  action: async options => {
    const { directoryPath, projectConfig } = locateProjectConfig(
      options.config,
    );
    const framework = options.framework ?? detectFramework(directoryPath);
    const frameworkModule = resolveFrameworkModule(framework);
    const run = new InitRun();
    const hotCodePush = await run.run('sign-in', () => signIn(options));
    const scope = await run.run(
      'organization',
      () =>
        resolveOrganization(requireValue(hotCodePush), projectConfig, options),
      { dependsOn: ['sign-in'] },
    );
    const app = await run.run(
      'app',
      () =>
        resolveApp(
          requireValue(hotCodePush),
          requireValue(scope),
          framework,
          options,
        ),
      { dependsOn: ['organization'] },
    );
    const projectFiles = await resolveProjectFiles(
      directoryPath,
      projectConfig,
      frameworkModule,
      options,
    );
    const editBlocker = await resolveEditBlocker(projectFiles, options);
    await run.run('package', () => installPackage(projectFiles, editBlocker));
    await run.run(
      'configuration',
      () =>
        writeConfiguration(
          requireValue(hotCodePush),
          projectFiles,
          requireValue(app),
          editBlocker,
        ),
      { dependsOn: ['app'] },
    );
    await run.run('hook', () =>
      projectFiles.wiring.wireBinaryCreateStep(editBlocker),
    );
    await run.run('signing-key', () =>
      createSigningKey(app, projectFiles, options),
    );
    const isReleaseWanted =
      run.stoppedCode === undefined &&
      (await promptYesNo('Publish a first release now?', options));
    const isBuilt = await run.run('build', () =>
      buildProject(projectFiles, isReleaseWanted),
    );
    await run.run(
      'release',
      () =>
        releaseFirst(projectFiles, isReleaseWanted, isBuilt === true, options),
      { dependsOn: ['configuration', 'build'] },
    );
    const status = run.stoppedCode === undefined ? 'complete' : 'incomplete';
    if (options.json) {
      printJson({ status, steps: run.steps });
    } else {
      printOutcomeRows(resolveStepRows(run.steps));
      if (app !== undefined && status === 'complete') {
        printFinish(app);
      }
    }
    if (run.stoppedCode !== undefined) {
      throw new ReportedFailureError(run.stoppedCode);
    }
  },
});

/**
 * The credential in place — a session or `HOTCODEPUSH_TOKEN` — or the `login` flow: non-interactively it leaves the device code for the next run.
 */
async function signIn(options: InitOptions): Promise<StepOutcome<HotCodePush>> {
  if (readToken() !== undefined) {
    try {
      return {
        message: resolveCredentialText(await fetchCurrentUser()),
        status: 'skipped',
        value: createApiClient(),
      };
    } catch (error) {
      if (
        !isUnauthenticatedError(error) &&
        !(error instanceof NotLoggedInError)
      ) {
        throw error;
      }
    }
  }
  const user = await logIn(options);
  return {
    message: `logged in as ${user.name} (${user.email})`,
    status: 'done',
    value: createApiClient(),
  };
}

/**
 * The organization of the app `hotcodepush.json` names, when it names one; otherwise `--organization`, used when it
 * exists and created when not; without the flag a picker with "create a new one", or non-interactively the only one.
 */
async function resolveOrganization(
  hotCodePush: HotCodePush,
  projectConfig: ProjectConfig | undefined,
  options: InitOptions,
): Promise<StepOutcome<Scope>> {
  if (projectConfig?.appId !== undefined) {
    const app = await hotCodePush.apps.get({ appId: projectConfig.appId });
    const organization = await hotCodePush.organizations.get({
      organizationId: app.organizationId,
    });
    return {
      message: `used organization ${organization.name}, the one of ${PROJECT_CONFIG_FILE_NAME}'s app`,
      status: 'done',
      value: { app, organization },
    };
  }
  const organizations = await fetchOrganizations(hotCodePush);
  if (options.organization !== undefined) {
    const named = findNamed(organizations, options.organization);
    if (named !== undefined) {
      return resolveUsedScope(named);
    }
    assertName('--organization', options.organization);
    await confirmCreation('organization', options.organization, options);
    return resolveCreatedScope(
      await hotCodePush.organizations.create({ name: options.organization }),
    );
  }
  const [onlyOrganization] = organizations;
  if (
    !isInteractive(options) &&
    onlyOrganization !== undefined &&
    organizations.length === 1
  ) {
    return resolveUsedScope(onlyOrganization);
  }
  const choice = await promptCreateOrPick(
    'organization',
    organizations,
    options,
  );
  if (choice !== CREATE_CHOICE) {
    return resolveUsedScope(requireById(organizations, choice));
  }
  const name = await promptText(
    '--organization',
    'What is the new organization called?',
    options,
  );
  return resolveCreatedScope(await hotCodePush.organizations.create({ name }));
}

/**
 * The app `hotcodepush.json` names, as the organization step read it; otherwise `--app`'s rule as for the organization,
 * the creation carrying the framework.
 */
async function resolveApp(
  hotCodePush: HotCodePush,
  { app, organization }: Scope,
  framework: Framework,
  options: InitOptions,
): Promise<StepOutcome<App>> {
  if (app !== undefined) {
    return {
      message: `used app ${app.name}, as ${PROJECT_CONFIG_FILE_NAME} names it`,
      status: 'done',
      value: app,
    };
  }
  const apps = await fetchApps(hotCodePush, organization.id);
  if (options.app !== undefined) {
    const named = findNamed(apps, options.app);
    if (named !== undefined) {
      return resolveUsed('app', named);
    }
    assertName('--app', options.app);
    await confirmCreation('app', options.app, options);
    return resolveCreated(
      'app',
      await hotCodePush.organizations.apps.create({
        framework,
        name: options.app,
        organizationId: organization.id,
      }),
    );
  }
  const [onlyApp] = apps;
  if (!isInteractive(options) && onlyApp !== undefined && apps.length === 1) {
    return resolveUsed('app', onlyApp);
  }
  const choice = await promptCreateOrPick('app', apps, options);
  if (choice !== CREATE_CHOICE) {
    return resolveUsed('app', requireById(apps, choice));
  }
  const name = await promptText('--app', 'What is the app called?', options);
  return resolveCreated(
    'app',
    await hotCodePush.organizations.apps.create({
      framework,
      name,
      organizationId: organization.id,
    }),
  );
}

async function resolveProjectFiles(
  directoryPath: string,
  projectConfig: ProjectConfig | undefined,
  framework: FrameworkModule,
  options: InitOptions,
): Promise<ProjectFiles> {
  const packageJson = readPackageJson(directoryPath);
  return {
    directoryPath,
    framework,
    packageJson,
    projectConfig,
    wiring: await framework.resolveWiring(
      { directoryPath, packageJson },
      options,
    ),
  };
}

/**
 * The files the remaining steps would change, shown and confirmed once; nothing to change asks nothing.
 * Declined, or with nobody to ask, the reason is what each editing step stops with.
 */
async function resolveEditBlocker(
  projectFiles: ProjectFiles,
  options: InitOptions,
): Promise<ConfirmationRequiredError | undefined> {
  const filePaths = resolveFilesToChange(projectFiles);
  if (filePaths.length === 0) {
    return undefined;
  }
  const consequence = `changes ${filePaths.join(', ')}`;
  const manualStep = `run init --yes to change ${filePaths.join(', ')}`;
  try {
    return (await confirmConsequence(consequence, options))
      ? undefined
      : new ConfirmationRequiredError(consequence, manualStep);
  } catch (error) {
    if (error instanceof ConfirmationRequiredError) {
      return new ConfirmationRequiredError(consequence, manualStep);
    }
    throw error;
  }
}

function resolveFilesToChange({
  projectConfig,
  wiring,
}: ProjectFiles): string[] {
  return [
    ...wiring.packageFilePaths,
    ...(isConfigurationComplete(projectConfig)
      ? []
      : [PROJECT_CONFIG_FILE_NAME]),
    ...wiring.nativeFilePaths,
  ];
}

function installPackage(
  { framework, wiring }: ProjectFiles,
  editBlocker: ConfirmationRequiredError | undefined,
): Promise<StepOutcome<undefined>> {
  if (wiring.isPackageInstalled) {
    return Promise.resolve({
      message: `${framework.packageName} already installed`,
      status: 'skipped',
      value: undefined,
    });
  }
  if (editBlocker !== undefined) {
    throw editBlocker;
  }
  return Promise.resolve({
    message: wiring.installPackage(),
    status: 'done',
    value: undefined,
  });
}

/**
 * `hotcodepush.json` with the app and its default channel by name; a file present keeps what it has.
 */
async function writeConfiguration(
  hotCodePush: HotCodePush,
  { directoryPath, projectConfig }: ProjectFiles,
  app: App,
  editBlocker: ConfirmationRequiredError | undefined,
): Promise<StepOutcome<undefined>> {
  if (isConfigurationComplete(projectConfig)) {
    return {
      message: `${PROJECT_CONFIG_FILE_NAME} already present`,
      status: 'skipped',
      value: undefined,
    };
  }
  if (editBlocker !== undefined) {
    throw editBlocker;
  }
  const filePath = join(directoryPath, PROJECT_CONFIG_FILE_NAME);
  const sourceText = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  writeFileSync(
    filePath,
    stringifyLikeSource(
      {
        ...projectConfig,
        appId: projectConfig?.appId ?? app.id,
        ...(projectConfig?.channel !== undefined
          ? {}
          : { channel: await fetchDefaultChannelName(hotCodePush, app) }),
      },
      sourceText || '{}\n',
    ),
  );
  return {
    message: `${projectConfig === undefined ? 'wrote' : 'completed'} ${PROJECT_CONFIG_FILE_NAME}`,
    status: 'done',
    value: undefined,
  };
}

/**
 * The name of the app's default channel, the one a new project follows; the schema's default for an app without one.
 */
async function fetchDefaultChannelName(
  hotCodePush: HotCodePush,
  app: App,
): Promise<string> {
  if (app.defaultChannelId === null) {
    return resolveProjectChannel({});
  }
  const defaultChannel = await hotCodePush.apps.channels.get({
    appId: app.id,
    channelId: app.defaultChannelId,
  });
  return defaultChannel.name;
}

/**
 * The signing key pair, for a person only: `signing-key create` in place, which writes the private key to a new file.
 * Nobody to ask points at the command instead, since a key file written on a runner is lost with it.
 */
async function createSigningKey(
  app: App | undefined,
  { directoryPath }: ProjectFiles,
  options: InitOptions,
): Promise<StepOutcome<undefined>> {
  if (app?.hasSigningKey) {
    return {
      message: 'the app already has a signing key',
      status: 'skipped',
      value: undefined,
    };
  }
  if (
    app === undefined ||
    !(await promptYesNo('Generate a signing key pair?', options))
  ) {
    return {
      message: 'run signing-key create to enable code signing',
      status: 'skipped',
      value: undefined,
    };
  }
  const configPath = join(directoryPath, PROJECT_CONFIG_FILE_NAME);
  await signingKeyCreateCommand.action(
    {
      app: app.id,
      config: existsSync(configPath) ? configPath : undefined,
      json: options.json,
    },
    undefined,
  );
  return {
    message:
      'generated a signing key pair, its private key in the file named above',
    status: 'done',
    value: undefined,
  };
}

/**
 * The project's `build` script, run visibly when a release follows; skipped with the reason otherwise.
 */
function buildProject(
  { directoryPath, framework, packageJson }: ProjectFiles,
  isReleaseWanted: boolean,
): Promise<StepOutcome<boolean>> {
  if (framework.packageBundles !== undefined) {
    return Promise.resolve({
      message: 'release create packages the bundles itself',
      status: 'skipped',
      value: false,
    });
  }
  const buildCommandLine = resolveBuildCommandLine(directoryPath, packageJson);
  if (buildCommandLine === undefined) {
    return Promise.resolve({
      message: 'no build script in package.json',
      status: 'skipped',
      value: false,
    });
  }
  const buildText = resolveCommandLineText(buildCommandLine);
  if (!isReleaseWanted) {
    return Promise.resolve({
      message: `no release follows: run ${buildText}, then release create`,
      status: 'skipped',
      value: false,
    });
  }
  runCommandLineVisibly(buildCommandLine, directoryPath);
  return Promise.resolve({
    message: `ran ${buildText}`,
    status: 'done',
    value: true,
  });
}

/**
 * The first release through `release create`, interactively only; the web build must exist by then.
 */
async function releaseFirst(
  { directoryPath, framework, packageJson }: ProjectFiles,
  isReleaseWanted: boolean,
  isBuilt: boolean,
  options: InitOptions,
): Promise<StepOutcome<undefined>> {
  if (!isReleaseWanted) {
    return {
      message: 'run release create to publish the first release',
      status: 'skipped',
      value: undefined,
    };
  }
  const buildDirectory = framework.readBuildDirectory(directoryPath);
  if (
    framework.packageBundles === undefined &&
    !isBuilt &&
    'path' in buildDirectory &&
    !existsSync(join(directoryPath, buildDirectory.path))
  ) {
    const buildCommandLine = resolveBuildCommandLine(
      directoryPath,
      packageJson,
    );
    return {
      message: `${buildCommandLine === undefined ? 'no build script and ' : ''}no output at ${buildDirectory.path}; build, then release create`,
      status: 'skipped',
      value: undefined,
    };
  }
  await releaseCreateCommand.action(
    {
      config: join(directoryPath, PROJECT_CONFIG_FILE_NAME),
      json: options.json,
      yes: true,
    },
    undefined,
  );
  return {
    message: 'released to production',
    status: 'done',
    value: undefined,
  };
}

function printFinish(app: App): void {
  console.log('');
  console.log(
    'Build the app natively once and run it; change a line, run the build and "npx hotcodepush release create", then reopen the app.',
  );
  console.log(`Console: ${resolveConsoleBaseUrl(readApiUrl())}/apps/${app.id}`);
  console.log(`Docs: ${DOCS_URL}`);
}

function assertName(flag: string, reference: string): void {
  if (ID_SCHEMA.safeParse(reference).success) {
    throw new InvalidParameterError(
      `${flag}: nothing has the id ${reference}`,
      undefined,
    );
  }
}

async function confirmCreation(
  noun: string,
  name: string,
  options: InitOptions,
): Promise<void> {
  const isConfirmed = await confirmConsequence(
    `creates the ${noun} ${name}, which does not exist yet`,
    options,
  );
  if (!isConfirmed) {
    throw new MissingParameterError(`--${noun}`);
  }
}

function findNamed<TResource extends { id: string; name: string }>(
  resources: TResource[],
  reference: string,
): TResource | undefined {
  return ID_SCHEMA.safeParse(reference).success
    ? resources.find(({ id }) => id === reference)
    : resources.find(
        ({ name }) => name.toLowerCase() === reference.toLowerCase(),
      );
}

/**
 * The file names the app and the channel, all `init` writes.
 */
function isConfigurationComplete(
  projectConfig: ProjectConfig | undefined,
): boolean {
  return (
    projectConfig?.appId !== undefined && projectConfig.channel !== undefined
  );
}

function promptCreateOrPick(
  noun: string,
  resources: { id: string; name: string }[],
  options: InitOptions,
): Promise<string> {
  return promptSelect(
    `--${noun}`,
    `Which ${noun}?`,
    [
      ...resources.map(({ id, name }) => ({ label: name, value: id })),
      { label: `Create a new ${noun}`, value: CREATE_CHOICE },
    ],
    options,
  );
}

function requireById<TResource extends { id: string }>(
  resources: TResource[],
  id: string,
): TResource {
  const resource = resources.find(candidate => candidate.id === id);
  if (resource === undefined) {
    throw new InvalidParameterError(`nothing has the id ${id}`, undefined);
  }
  return resource;
}

/**
 * A value an earlier step produced; the run never reaches here without it, since a stopped step skips the rest.
 */
function requireValue<TValue>(value: TValue | undefined): TValue {
  if (value === undefined) {
    throw new UnexpectedError(new Error('an earlier step did not run'));
  }
  return value;
}

function resolveBuildCommandLine(
  directoryPath: string,
  packageJson: PackageJson,
): CommandLine | undefined {
  return packageJson.scripts?.build === undefined
    ? undefined
    : resolveRunScriptCommandLine(
        resolvePackageManager(directoryPath),
        'build',
      );
}

function resolveCreatedScope(organization: Organization): StepOutcome<Scope> {
  return {
    message: `created organization ${organization.name}`,
    status: 'done',
    value: { app: undefined, organization },
  };
}

function resolveUsedScope(organization: Organization): StepOutcome<Scope> {
  return {
    message: `used organization ${organization.name}`,
    status: 'done',
    value: { app: undefined, organization },
  };
}

function resolveCreated<TResource extends { name: string }>(
  noun: string,
  resource: TResource,
): StepOutcome<TResource> {
  return {
    message: `created ${noun} ${resource.name}`,
    status: 'done',
    value: resource,
  };
}

function resolveUsed<TResource extends { name: string }>(
  noun: string,
  resource: TResource,
): StepOutcome<TResource> {
  return {
    message: `used ${noun} ${resource.name}`,
    status: 'done',
    value: resource,
  };
}
