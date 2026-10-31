import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { App, HotCodePush, Organization } from '@hotcodepush/node';
import { HotCodePushError } from '@hotcodepush/node';
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
import type {
  ProjectConfig,
  ProjectConfigLocation,
} from '../utils/project-config.js';
import {
  ID_SCHEMA,
  locateProjectConfig,
  resolveProjectChannel,
} from '../utils/project-config.js';
import {
  confirmConsequence,
  promptSelect,
  promptText,
  promptYesNo,
} from '../utils/prompts.js';
import {
  fetchApps,
  fetchHasSigningKey,
  fetchOrganizations,
} from '../utils/resource-resolution.js';
import { isEnvironmentToken, readToken } from '../utils/token-store.js';
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

interface ProjectFiles {
  configFilePath: string;
  directoryPath: string;
  framework: FrameworkModule;
  packageJson: PackageJson;
  projectConfig: ProjectConfig | undefined;
  wiring: FrameworkWiring;
}

interface Scope {
  app: App | undefined;
  organization: Organization;
}

const CREATE_CHOICE = 'create';

export default defineCommand({
  description:
    'Set a React Native, Expo, Capacitor or Cordova project up from sign-in to the first release, re-runnable at any step.',
  examples: ['hotcodepush init', 'hotcodepush init --yes --json'],
  options: defineCommandOptions({
    androidPath: z
      .string()
      .optional()
      .describe(
        "The Android project, when it is not capacitor.config's android.path or android/.",
      ),
    framework: z
      .enum(['react_native', 'expo', 'capacitor', 'cordova'])
      .optional()
      .describe(
        'The framework, react_native, expo, capacitor or cordova, over the one detected from package.json.',
      ),
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
    const projectConfigLocation = locateProjectConfig(options.config);
    const { directoryPath, projectConfig } = projectConfigLocation;
    const framework = options.framework ?? detectFramework(directoryPath);
    const frameworkModule = resolveFrameworkModule(framework);
    const run = new InitRun();
    const hotCodePush = await run.run('sign_in', () => signIn(options));
    const scope = await run.run(
      'organization',
      () =>
        resolveOrganization(requireValue(hotCodePush), projectConfig, options),
      { dependsOn: ['sign_in'] },
    );
    const app = await run.run(
      'app',
      () =>
        resolveApp(
          requireValue(hotCodePush),
          requireValue(scope),
          projectConfigLocation,
          framework,
          options,
        ),
      { dependsOn: ['organization'] },
    );
    const projectFiles = await resolveProjectFiles(
      projectConfigLocation,
      frameworkModule,
      options,
    );
    const editBlocker = await resolveEditBlocker(projectFiles, app, options);
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
    await run.run('signing_key', () =>
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
      throw new ReportedFailureError(run.stoppedCode, run.stoppedStep);
    }
  },
});

// A non-interactive login leaves the device code for the next run.
async function signIn(options: InitOptions): Promise<StepOutcome<HotCodePush>> {
  if (readToken() !== undefined) {
    try {
      return {
        message: resolveCredentialText(
          await fetchCurrentUser(),
          isEnvironmentToken(),
        ),
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
    message: `Logged in as ${user.name} (${user.email}).`,
    status: 'done',
    value: createApiClient(),
  };
}

// Without `--organization`, a person picks or creates one. Non-interactively the only one is used.
async function resolveOrganization(
  hotCodePush: HotCodePush,
  projectConfig: ProjectConfig | undefined,
  options: InitOptions,
): Promise<StepOutcome<Scope>> {
  const app =
    options.app === undefined && projectConfig?.appId !== undefined
      ? await fetchExistingApp(hotCodePush, projectConfig.appId)
      : undefined;
  if (app !== undefined) {
    const organization = await hotCodePush.organizations.get({
      organizationId: app.organizationId,
    });
    return {
      message: `Used organization ${organization.name}, the one of ${PROJECT_CONFIG_FILE_NAME}'s app.`,
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

// An app in the file that the API lacks is refused non-interactively. A person picks or creates another.
async function resolveApp(
  hotCodePush: HotCodePush,
  { app, organization }: Scope,
  { filePath, projectConfig }: ProjectConfigLocation,
  framework: Framework,
  options: InitOptions,
): Promise<StepOutcome<App>> {
  if (app !== undefined) {
    return {
      message: `Used app ${app.name}, as ${PROJECT_CONFIG_FILE_NAME} names it.`,
      status: 'done',
      value: app,
    };
  }
  if (
    options.app === undefined &&
    projectConfig?.appId !== undefined &&
    !isInteractive(options)
  ) {
    throw new InvalidParameterError(
      `The app ${projectConfig.appId} in ${filePath ?? PROJECT_CONFIG_FILE_NAME} does not exist.`,
      `Pass --app with the app's id or name, or delete ${PROJECT_CONFIG_FILE_NAME} to create a new app.`,
    );
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
  { directoryPath, filePath, projectConfig }: ProjectConfigLocation,
  framework: FrameworkModule,
  options: InitOptions,
): Promise<ProjectFiles> {
  const packageJson = readPackageJson(directoryPath);
  return {
    configFilePath: filePath ?? join(directoryPath, PROJECT_CONFIG_FILE_NAME),
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

// Declined, or with nobody to ask, each editing step stops with that reason.
async function resolveEditBlocker(
  projectFiles: ProjectFiles,
  app: App | undefined,
  options: InitOptions,
): Promise<ConfirmationRequiredError | undefined> {
  const filePaths = resolveFilesToChange(projectFiles, app);
  if (filePaths.length === 0) {
    return undefined;
  }
  const consequence = `changes ${filePaths.join(', ')}`;
  const manualStep = `Run "hotcodepush init --yes" to change ${filePaths.join(', ')}.`;
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

// Without an app the configuration step waits, so `hotcodepush.json` is not among the files.
function resolveFilesToChange(
  { configFilePath, projectConfig, wiring }: ProjectFiles,
  app: App | undefined,
): string[] {
  return [
    ...wiring.packageFilePaths,
    ...(app === undefined || isConfigurationComplete(projectConfig, app)
      ? []
      : [basename(configFilePath)]),
    ...wiring.nativeFilePaths,
  ];
}

function installPackage(
  { framework, wiring }: ProjectFiles,
  editBlocker: ConfirmationRequiredError | undefined,
): Promise<StepOutcome<undefined>> {
  if (wiring.isPackageInstalled) {
    return Promise.resolve({
      message: `The package ${framework.packageName} is already installed.`,
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

async function writeConfiguration(
  hotCodePush: HotCodePush,
  { configFilePath, projectConfig }: ProjectFiles,
  app: App,
  editBlocker: ConfirmationRequiredError | undefined,
): Promise<StepOutcome<undefined>> {
  if (isConfigurationComplete(projectConfig, app)) {
    return {
      message: `The file ${basename(configFilePath)} is already present.`,
      status: 'skipped',
      value: undefined,
    };
  }
  if (editBlocker !== undefined) {
    throw editBlocker;
  }
  const sourceText = existsSync(configFilePath)
    ? readFileSync(configFilePath, 'utf8')
    : '';
  writeFileSync(
    configFilePath,
    stringifyLikeSource(
      {
        ...projectConfig,
        appId: app.id,
        ...(projectConfig?.channel !== undefined
          ? {}
          : { channel: await fetchDefaultChannelName(hotCodePush, app) }),
      },
      sourceText || '{}\n',
    ),
  );
  return {
    message: resolveConfigurationMessage(
      basename(configFilePath),
      projectConfig,
      app,
    ),
    status: 'done',
    value: undefined,
  };
}

function resolveConfigurationMessage(
  fileName: string,
  projectConfig: ProjectConfig | undefined,
  app: App,
): string {
  if (projectConfig === undefined) {
    return `Wrote ${fileName}.`;
  }
  if (projectConfig.appId !== undefined && projectConfig.appId !== app.id) {
    return `Set the app in ${fileName} to ${app.name}.`;
  }
  return `Completed ${fileName}.`;
}

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

// Nobody to ask points at the command instead, since a key file written on a runner is lost with it.
async function createSigningKey(
  app: App | undefined,
  { configFilePath }: ProjectFiles,
  options: InitOptions,
): Promise<StepOutcome<undefined>> {
  if (
    app !== undefined &&
    (await fetchHasSigningKey(createApiClient(), app.id))
  ) {
    return {
      message: 'The app already has a signing key.',
      status: 'skipped',
      value: undefined,
    };
  }
  if (
    app === undefined ||
    !(await promptYesNo('Generate a signing key pair?', options))
  ) {
    return {
      message: 'Run "hotcodepush signing-key create" to enable code signing.',
      status: 'skipped',
      value: undefined,
    };
  }
  await signingKeyCreateCommand.action(
    {
      app: app.id,
      config: existsSync(configFilePath) ? configFilePath : undefined,
      json: options.json,
    },
    undefined,
  );
  return {
    message:
      'Generated a signing key pair, its private key in the file named above.',
    status: 'done',
    value: undefined,
  };
}

function buildProject(
  { directoryPath, framework, packageJson }: ProjectFiles,
  isReleaseWanted: boolean,
): Promise<StepOutcome<boolean>> {
  if (framework.packageBundles !== undefined) {
    return Promise.resolve({
      message:
        'The command "hotcodepush release create" packages the bundles itself.',
      status: 'skipped',
      value: false,
    });
  }
  const buildCommandLine = resolveBuildCommandLine(directoryPath, packageJson);
  if (buildCommandLine === undefined) {
    return Promise.resolve({
      message: 'There is no build script in package.json.',
      status: 'skipped',
      value: false,
    });
  }
  const buildText = resolveCommandLineText(buildCommandLine);
  if (!isReleaseWanted) {
    return Promise.resolve({
      message: `No release follows. Run "${buildText}", then "hotcodepush release create".`,
      status: 'skipped',
      value: false,
    });
  }
  runCommandLineVisibly(buildCommandLine, directoryPath);
  return Promise.resolve({
    message: `Ran "${buildText}".`,
    status: 'done',
    value: true,
  });
}

async function releaseFirst(
  { configFilePath, directoryPath, framework, packageJson }: ProjectFiles,
  isReleaseWanted: boolean,
  isBuilt: boolean,
  options: InitOptions,
): Promise<StepOutcome<undefined>> {
  if (!isReleaseWanted) {
    return {
      message: 'Run "hotcodepush release create" to publish the first release.',
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
      message: `There is ${buildCommandLine === undefined ? 'no build script and ' : ''}no output at ${buildDirectory.path}. Build, then run "hotcodepush release create".`,
      status: 'skipped',
      value: undefined,
    };
  }
  await releaseCreateCommand.action(
    {
      config: configFilePath,
      json: options.json,
      yes: true,
    },
    undefined,
  );
  return {
    message: 'Released to production.',
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
      `Nothing has the id ${reference} from ${flag}.`,
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

// Such as a copied project, a cloned demo or a reset environment.
async function fetchExistingApp(
  hotCodePush: HotCodePush,
  appId: string,
): Promise<App | undefined> {
  try {
    return await hotCodePush.apps.get({ appId });
  } catch (error) {
    if (error instanceof HotCodePushError && error.code === 'not_found') {
      return undefined;
    }
    throw error;
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

function isConfigurationComplete(
  projectConfig: ProjectConfig | undefined,
  app: App,
): boolean {
  return projectConfig?.appId === app.id && projectConfig.channel !== undefined;
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
    throw new InvalidParameterError(`Nothing has the id ${id}.`);
  }
  return resource;
}

// A stopped step skips the rest, so the run never gets here without the value.
function requireValue<TValue>(value: TValue | undefined): TValue {
  if (value === undefined) {
    throw new UnexpectedError(new Error('An earlier step did not run.'));
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
    message: `Created organization ${organization.name}.`,
    status: 'done',
    value: { app: undefined, organization },
  };
}

function resolveUsedScope(organization: Organization): StepOutcome<Scope> {
  return {
    message: `Used organization ${organization.name}.`,
    status: 'done',
    value: { app: undefined, organization },
  };
}

function resolveCreated<TResource extends { name: string }>(
  noun: string,
  resource: TResource,
): StepOutcome<TResource> {
  return {
    message: `Created ${noun} ${resource.name}.`,
    status: 'done',
    value: resource,
  };
}

function resolveUsed<TResource extends { name: string }>(
  noun: string,
  resource: TResource,
): StepOutcome<TResource> {
  return {
    message: `Used ${noun} ${resource.name}.`,
    status: 'done',
    value: resource,
  };
}
