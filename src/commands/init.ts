import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { App, HotCodePush, Organization } from '@hotcodepush/node';
import { HotCodePushError } from '@hotcodepush/node';
import { z } from 'zod';
import {
  DOCS_URL,
  PROJECT_CONFIG_FILE_NAME,
  SIGNING_PRIVATE_KEY_FILE_NAME,
} from '../config/consts.js';
import type { Framework } from '../frameworks/framework.js';
import { detectFramework } from '../frameworks/framework.js';
import { resolveFrameworkModule } from '../frameworks/index.js';
import type {
  FrameworkModule,
  FrameworkWiring,
  StepOutcome,
} from '../frameworks/index.js';
import { fetchApps } from '../resources/apps.js';
import { fetchOrganizations } from '../resources/organizations.js';
import { fetchHasSigningKey } from '../resources/signing-keys.js';
import { createApiClient } from '../utils/api-client.js';
import { defineCommand } from '../utils/command.js';
import {
  fetchCurrentUser,
  isUnauthenticatedError,
  resolveCredentialText,
} from '../utils/credential.js';
import { printNotice } from '../utils/diagnostics.js';
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
import { defineCommandOptions } from '../utils/global-options.js';
import { resolveConsoleBaseUrl } from '../utils/hosts.js';
import { stringifyLikeSource } from '../utils/json-file.js';
import { logIn } from '../utils/login.js';
import { printOutcomeRows } from '../utils/outcome.js';
import { printJson, printResult } from '../utils/output.js';
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
  locateProjectConfig,
  resolveProjectChannel,
} from '../utils/project-config.js';
import {
  confirmConsequence,
  promptSelect,
  promptText,
  promptYesNo,
} from '../utils/prompts.js';
import { isId } from '../utils/reference.js';
import { findResource } from '../utils/resources.js';
import { isEnvironmentToken, readToken } from '../utils/token-store.js';
import { readApiUrl } from '../utils/user-config.js';
import { InitRun, resolveStepRows } from './init/steps.js';
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

interface Account {
  app: App | undefined;
  hotCodePush: HotCodePush | undefined;
}

interface InitProject {
  framework: Framework;
  frameworkModule: FrameworkModule;
  location: ProjectConfigLocation;
}

interface NamedResource {
  id: string;
  name: string;
}

interface ResourceCreation<TResource extends NamedResource> {
  create: (name: string) => Promise<TResource>;
  noun: string;
  options: InitOptions;
}

interface Scope {
  app: App | undefined;
  organization: Organization;
}

const CREATE_CHOICE = 'create';

const SIGNING_KEY_DECLINED_OUTCOME: StepOutcome<undefined> = {
  message: 'Run "hotcodepush signing-key create" to enable code signing.',
  status: 'skipped',
  value: undefined,
};

const SIGNING_KEY_PRESENT_OUTCOME: StepOutcome<undefined> = {
  message: 'The app already has a signing key.',
  status: 'skipped',
  value: undefined,
};

export default defineCommand({
  description:
    'Set a React Native, Expo, Capacitor or Cordova project up from sign-in to the first release, re-runnable at any step.',
  authentication: 'optional',
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
    const run = new InitRun();
    const project = locateInitProject(options);
    const account = await runAccountSteps(run, { options, project });
    const projectFiles = await readProjectFiles(project.location, {
      framework: project.frameworkModule,
      options,
    });
    const privateKeyPath = await runProjectSteps(run, {
      account,
      options,
      projectFiles,
    });
    const isReleased = await runReleaseSteps(run, {
      options,
      privateKeyPath,
      projectFiles,
    });
    printRun(run, {
      app: account.app,
      appImportStep: projectFiles.wiring.appImportStep,
      isReleased,
      options,
      privateKeyPath,
    });
    if (run.stoppedCode !== undefined) {
      throw new ReportedFailureError(run.stoppedCode, run.stoppedStep);
    }
  },
});

function locateInitProject(options: InitOptions): InitProject {
  const location = locateProjectConfig(options.config);
  const framework =
    options.framework ?? detectFramework(location.directoryPath);
  return {
    framework,
    frameworkModule: resolveFrameworkModule(framework),
    location,
  };
}

async function runAccountSteps(
  run: InitRun,
  { options, project }: { options: InitOptions; project: InitProject },
): Promise<Account> {
  const hotCodePush = await run.run('sign_in', {
    perform: () => signIn(options),
  });
  const scope = await run.run('organization', {
    dependsOn: ['sign_in'],
    perform: () =>
      fetchOrganizationScope(requireValue(hotCodePush), {
        options,
        projectConfig: project.location.projectConfig,
      }),
  });
  const app = await run.run('app', {
    dependsOn: ['organization'],
    perform: () =>
      fetchInitApp(requireValue(hotCodePush), {
        framework: project.framework,
        location: project.location,
        options,
        scope: requireValue(scope),
      }),
  });
  return { app, hotCodePush };
}

// Returns the private key's path when the signing key step generated one.
async function runProjectSteps(
  run: InitRun,
  {
    account: { app, hotCodePush },
    options,
    projectFiles,
  }: { account: Account; options: InitOptions; projectFiles: ProjectFiles },
): Promise<string | undefined> {
  const editBlocker = await confirmProjectEdits(projectFiles, { app, options });
  await run.run('package', {
    perform: () => installPackage(projectFiles, editBlocker),
  });
  await run.run('configuration', {
    dependsOn: ['app'],
    perform: () =>
      writeConfiguration(requireValue(hotCodePush), {
        app: requireValue(app),
        editBlocker,
        projectFiles,
      }),
  });
  await run.run('hook', {
    perform: () => projectFiles.wiring.wireBinaryCreateStep(editBlocker),
  });
  return run.run('signing_key', {
    perform: () => createSigningKey(projectFiles, { app, options }),
  });
}

async function runReleaseSteps(
  run: InitRun,
  {
    options,
    privateKeyPath,
    projectFiles,
  }: {
    options: InitOptions;
    privateKeyPath: string | undefined;
    projectFiles: ProjectFiles;
  },
): Promise<boolean> {
  const isReleaseWanted =
    run.stoppedCode === undefined &&
    (await promptYesNo('Publish a first release now?', options));
  const isBuilt = await run.run('build', {
    perform: () => runBuildScript(projectFiles, { isReleaseWanted }),
  });
  const isReleased = await run.run('release', {
    dependsOn: ['configuration', 'build'],
    perform: () =>
      releaseFirst(projectFiles, {
        isBuilt: isBuilt === true,
        isReleaseWanted,
        options,
        privateKeyPath,
      }),
  });
  return isReleased === true;
}

function printRun(
  run: InitRun,
  {
    app,
    appImportStep,
    isReleased,
    options,
    privateKeyPath,
  }: {
    app: App | undefined;
    appImportStep: string | undefined;
    isReleased: boolean;
    options: InitOptions;
    privateKeyPath: string | undefined;
  },
): void {
  const status = run.stoppedCode === undefined ? 'complete' : 'incomplete';
  if (options.json) {
    printJson({ status, steps: run.steps });
    return;
  }
  // A blank line separates the rows from the package manager and build output above them.
  console.log('');
  printOutcomeRows(resolveStepRows(run.steps));
  if (appImportStep !== undefined) {
    printNotice(appImportStep);
  }
  if (app !== undefined && status === 'complete') {
    printFinish(app, { isReleased, privateKeyPath });
  }
}

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
async function fetchOrganizationScope(
  hotCodePush: HotCodePush,
  {
    options,
    projectConfig,
  }: { options: InitOptions; projectConfig: ProjectConfig | undefined },
): Promise<StepOutcome<Scope>> {
  const app =
    options.app === undefined && projectConfig?.appId !== undefined
      ? await fetchExistingApp(hotCodePush, projectConfig.appId)
      : undefined;
  if (app !== undefined) {
    return fetchAppScope(hotCodePush, app);
  }
  const organizations = await fetchOrganizations(hotCodePush);
  const creation = {
    create: (name: string) => hotCodePush.organizations.create({ name }),
    noun: 'organization',
    options,
  };
  const outcome =
    options.organization === undefined
      ? await pickOrCreateResource(organizations, {
          ...creation,
          newNameMessage: 'What is the new organization called?',
        })
      : await useOrCreateNamedResource(organizations, {
          ...creation,
          name: options.organization,
        });
  return { ...outcome, value: { app: undefined, organization: outcome.value } };
}

async function fetchAppScope(
  hotCodePush: HotCodePush,
  app: App,
): Promise<StepOutcome<Scope>> {
  const organization = await hotCodePush.organizations.get({
    organizationId: app.organizationId,
  });
  return {
    message: `Used organization ${organization.name}, the one of ${PROJECT_CONFIG_FILE_NAME}'s app.`,
    status: 'done',
    value: { app, organization },
  };
}

// An app in the file that the API lacks is refused non-interactively. A person picks or creates another.
async function fetchInitApp(
  hotCodePush: HotCodePush,
  {
    framework,
    location,
    options,
    scope: { app, organization },
  }: {
    framework: Framework;
    location: ProjectConfigLocation;
    options: InitOptions;
    scope: Scope;
  },
): Promise<StepOutcome<App>> {
  if (app !== undefined) {
    return {
      message: `Used app ${app.name}, as ${PROJECT_CONFIG_FILE_NAME} names it.`,
      status: 'done',
      value: app,
    };
  }
  assertProjectConfigAppReplaceable(location, options);
  const apps = await fetchApps(hotCodePush, organization.id);
  const creation = {
    create: (name: string) =>
      hotCodePush.organizations.apps.create({
        framework,
        name,
        organizationId: organization.id,
      }),
    noun: 'app',
    options,
  };
  return options.app === undefined
    ? pickOrCreateResource(apps, {
        ...creation,
        newNameMessage: 'What is the app called?',
      })
    : useOrCreateNamedResource(apps, { ...creation, name: options.app });
}

function assertProjectConfigAppReplaceable(
  { filePath, projectConfig }: ProjectConfigLocation,
  options: InitOptions,
): void {
  if (
    options.app === undefined &&
    projectConfig?.appId !== undefined &&
    !isInteractive(options)
  ) {
    throw new InvalidParameterError(
      `The app ${projectConfig.appId} in ${filePath ?? PROJECT_CONFIG_FILE_NAME} does not exist.`,
      {
        fix: `Pass --app with the app's id or name, or delete ${PROJECT_CONFIG_FILE_NAME} to create a new app.`,
      },
    );
  }
}

async function pickOrCreateResource<TResource extends NamedResource>(
  resources: TResource[],
  {
    create,
    newNameMessage,
    noun,
    options,
  }: ResourceCreation<TResource> & { newNameMessage: string },
): Promise<StepOutcome<TResource>> {
  const [onlyResource] = resources;
  if (
    !isInteractive(options) &&
    onlyResource !== undefined &&
    resources.length === 1
  ) {
    return resolveUsed(noun, onlyResource);
  }
  const choice = await promptCreateOrPick(options, { noun, resources });
  if (choice !== CREATE_CHOICE) {
    return resolveUsed(noun, requireById(resources, choice));
  }
  const name = await promptText(options, {
    flag: `--${noun}`,
    message: newNameMessage,
  });
  return resolveCreated(noun, await create(name));
}

async function useOrCreateNamedResource<TResource extends NamedResource>(
  resources: TResource[],
  {
    create,
    name,
    noun,
    options,
  }: ResourceCreation<TResource> & { name: string },
): Promise<StepOutcome<TResource>> {
  const named = findResource(resources, { noun, reference: name });
  if (named !== undefined) {
    return resolveUsed(noun, named);
  }
  assertName(`--${noun}`, name);
  await confirmCreation(options, { name, noun });
  return resolveCreated(noun, await create(name));
}

async function readProjectFiles(
  { directoryPath, filePath, projectConfig }: ProjectConfigLocation,
  { framework, options }: { framework: FrameworkModule; options: InitOptions },
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
async function confirmProjectEdits(
  projectFiles: ProjectFiles,
  { app, options }: { app: App | undefined; options: InitOptions },
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
  {
    app,
    editBlocker,
    projectFiles: { configFilePath, projectConfig },
  }: {
    app: App;
    editBlocker: ConfirmationRequiredError | undefined;
    projectFiles: ProjectFiles;
  },
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
  writeProjectConfigFile(configFilePath, {
    ...projectConfig,
    appId: app.id,
    ...(projectConfig?.channel !== undefined
      ? {}
      : { channel: await fetchDefaultChannelName(hotCodePush, app) }),
  });
  return {
    message: resolveConfigurationMessage(projectConfig, {
      app,
      fileName: basename(configFilePath),
    }),
    status: 'done',
    value: undefined,
  };
}

function writeProjectConfigFile(
  configFilePath: string,
  projectConfig: ProjectConfig,
): void {
  const sourceText = existsSync(configFilePath)
    ? readFileSync(configFilePath, 'utf8')
    : '';
  writeFileSync(
    configFilePath,
    stringifyLikeSource(projectConfig, sourceText || '{}\n'),
  );
}

function resolveConfigurationMessage(
  projectConfig: ProjectConfig | undefined,
  { app, fileName }: { app: App; fileName: string },
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
  { configFilePath }: ProjectFiles,
  { app, options }: { app: App | undefined; options: InitOptions },
): Promise<StepOutcome<string | undefined>> {
  if (
    app !== undefined &&
    (await fetchHasSigningKey(createApiClient(), app.id))
  ) {
    return SIGNING_KEY_PRESENT_OUTCOME;
  }
  if (
    app === undefined ||
    !(await promptYesNo('Generate a signing key pair?', options))
  ) {
    return SIGNING_KEY_DECLINED_OUTCOME;
  }
  const privateKeyPath = SIGNING_PRIVATE_KEY_FILE_NAME;
  await signingKeyCreateCommand.action(
    {
      app: app.id,
      config: existsSync(configFilePath) ? configFilePath : undefined,
      json: options.json,
      privateKeyPath,
    },
    undefined,
  );
  return {
    message:
      'Generated a signing key pair, its private key in the file named above.',
    status: 'done',
    value: privateKeyPath,
  };
}

function runBuildScript(
  { directoryPath, framework, packageJson }: ProjectFiles,
  { isReleaseWanted }: { isReleaseWanted: boolean },
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
  if (!isReleaseWanted) {
    return Promise.resolve({
      message: 'No release follows.',
      status: 'skipped',
      value: false,
    });
  }
  runCommandLineVisibly(buildCommandLine, directoryPath);
  return Promise.resolve({
    message: `Ran "${resolveCommandLineText(buildCommandLine)}".`,
    status: 'done',
    value: true,
  });
}

async function releaseFirst(
  projectFiles: ProjectFiles,
  {
    isBuilt,
    isReleaseWanted,
    options,
    privateKeyPath,
  }: {
    isBuilt: boolean;
    isReleaseWanted: boolean;
    options: InitOptions;
    privateKeyPath: string | undefined;
  },
): Promise<StepOutcome<boolean>> {
  const releaseCommandText = resolveReleaseCommandText(privateKeyPath);
  if (!isReleaseWanted) {
    return resolveDeclinedReleaseOutcome(projectFiles, releaseCommandText);
  }
  const missingBuildOutcome = checkBuildOutput(projectFiles, {
    isBuilt,
    releaseCommandText,
  });
  if (missingBuildOutcome !== undefined) {
    return missingBuildOutcome;
  }
  await releaseCreateCommand.action(
    {
      config: projectFiles.configFilePath,
      json: options.json,
      privateKeyPath,
      yes: true,
    },
    undefined,
  );
  return {
    message: 'Released to production.',
    status: 'done',
    value: true,
  };
}

function checkBuildOutput(
  { directoryPath, framework, packageJson }: ProjectFiles,
  {
    isBuilt,
    releaseCommandText,
  }: { isBuilt: boolean; releaseCommandText: string },
): StepOutcome<boolean> | undefined {
  const buildDirectory = framework.readBuildDirectory(directoryPath);
  if (
    framework.packageBundles !== undefined ||
    isBuilt ||
    !('path' in buildDirectory) ||
    existsSync(join(directoryPath, buildDirectory.path))
  ) {
    return undefined;
  }
  const buildCommandLine = resolveBuildCommandLine(directoryPath, packageJson);
  return {
    message: `There is ${buildCommandLine === undefined ? 'no build script and ' : ''}no output at ${buildDirectory.path}. Build, then run "${releaseCommandText}".`,
    status: 'skipped',
    value: false,
  };
}

function resolveDeclinedReleaseOutcome(
  { directoryPath, framework, packageJson }: ProjectFiles,
  releaseCommandText: string,
): StepOutcome<boolean> {
  const buildCommandLine =
    framework.packageBundles === undefined
      ? resolveBuildCommandLine(directoryPath, packageJson)
      : undefined;
  return {
    message:
      buildCommandLine === undefined
        ? `Run "${releaseCommandText}" to publish the first release.`
        : `Run "${resolveCommandLineText(buildCommandLine)}", then "${releaseCommandText}" to publish the first release.`,
    status: 'skipped',
    value: false,
  };
}

// A skipped release row already names the release command, so it is repeated only after a release.
function printFinish(
  app: App,
  {
    isReleased,
    privateKeyPath,
  }: { isReleased: boolean; privateKeyPath: string | undefined },
): void {
  console.log('');
  printResult({
    rows: [
      ['Console', `${resolveConsoleBaseUrl(readApiUrl())}/apps/${app.id}`],
      ['Docs', DOCS_URL],
    ],
    sentence: `Set up ${app.name}.`,
  });
  printNotice(
    isReleased
      ? `Build the app natively once and run it. Change a line, run the build and "${resolveReleaseCommandText(privateKeyPath)}", then reopen the app.`
      : 'Build the app natively once and run it, then publish the first release as shown above.',
  );
}

function assertName(flag: string, reference: string): void {
  if (isId(reference)) {
    throw new InvalidParameterError(
      `Nothing has the id ${reference} from ${flag}.`,
    );
  }
}

async function confirmCreation(
  options: InitOptions,
  { name, noun }: { name: string; noun: string },
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

function isConfigurationComplete(
  projectConfig: ProjectConfig | undefined,
  app: App,
): boolean {
  return projectConfig?.appId === app.id && projectConfig.channel !== undefined;
}

function promptCreateOrPick(
  options: InitOptions,
  { noun, resources }: { noun: string; resources: NamedResource[] },
): Promise<string> {
  return promptSelect(options, {
    choices: [
      ...resources.map(({ id, name }) => ({ label: name, value: id })),
      { label: `Create a new ${noun}`, value: CREATE_CHOICE },
    ],
    flag: `--${noun}`,
    message: `Which ${noun}?`,
  });
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

function resolveReleaseCommandText(privateKeyPath: string | undefined): string {
  return privateKeyPath === undefined
    ? 'hotcodepush release create'
    : `hotcodepush release create --private-key-path ${privateKeyPath}`;
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
