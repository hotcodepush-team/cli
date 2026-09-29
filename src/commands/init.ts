import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { App, HotCodePush, Organization } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import {
  CAPACITOR_PACKAGE_NAME,
  CAPACITOR_PACKAGE_SPEC,
  DOCS_URL,
  EMBED_HOOK_NAME,
  PROJECT_CONFIG_FILE_NAME,
} from '../config/consts.js';
import { createApiClient } from '../utils/api-client.js';
import { fetchCredential } from '../utils/credential.js';
import type { PackageJson } from '../utils/embed-hook.js';
import {
  readPackageJson,
  resolveEmbedHookState,
  stringifyLikeSource,
  wireEmbedHook,
} from '../utils/embed-hook.js';
import type { InteractivityOptions } from '../utils/environment.js';
import { isInteractive } from '../utils/environment.js';
import {
  ConfirmationRequiredError,
  InvalidParameterError,
  MissingParameterError,
  NotLoggedInError,
  ReportedFailureError,
  UnexpectedError,
  UnsupportedFrameworkError,
} from '../utils/errors.js';
import type { Framework } from '../utils/framework.js';
import {
  detectFramework,
  readCapacitorWebDir,
  resolveNativeProjectPaths,
} from '../utils/framework.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { resolveConsoleBaseUrl } from '../utils/hosts.js';
import type { StepOutcome } from '../utils/init-steps.js';
import { InitRun, resolveStepRows } from '../utils/init-steps.js';
import { printOutcomeRows } from '../utils/outcome.js';
import { printJson } from '../utils/output.js';
import type { CommandLine } from '../utils/package-manager.js';
import {
  resolveCommandLineText,
  resolveInstallCommandLine,
  resolvePackageManager,
  resolveRunScriptCommandLine,
  runCommandLineVisibly,
} from '../utils/package-manager.js';
import type { ProjectConfig } from '../utils/project-config.js';
import { locateProjectConfig } from '../utils/project-config.js';
import {
  confirmConsequence,
  promptSelect,
  promptText,
  promptYesNo,
} from '../utils/prompts.js';
import { fetchApps, fetchOrganizations } from '../utils/resource-resolution.js';
import { readToken } from '../utils/token-store.js';
import { readApiUrl } from '../utils/user-config.js';
import {
  addResourceReference,
  hasResourceReference,
  resolveXcodeProjectFilePath,
} from '../utils/xcode-project.js';
import { logIn } from './login.js';
import releaseCreateCommand from './release/create.js';

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
 * What the run knows about the project once the app is settled: the files the remaining steps edit.
 */
interface ProjectFiles {
  directoryPath: string;
  packageJson: PackageJson;
  projectConfig: ProjectConfig | undefined;
  xcodeProjectFilePath: string | undefined;
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
  action: async options => {
    const { directoryPath, projectConfig } = locateProjectConfig(
      options.config,
    );
    const framework = options.framework ?? detectFramework(directoryPath);
    if (framework !== 'capacitor') {
      throw new UnsupportedFrameworkError(framework);
    }
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
    const projectFiles = resolveProjectFiles(
      directoryPath,
      projectConfig,
      options,
    );
    const editBlocker = await resolveEditBlocker(projectFiles, options);
    await run.run('package', () => installPackage(projectFiles, editBlocker));
    await run.run(
      'configuration',
      () => writeConfiguration(projectFiles, requireValue(app), editBlocker),
      { dependsOn: ['app'] },
    );
    await run.run('hook', () => wireHook(projectFiles, editBlocker, options));
    await run.run('signing-key', () =>
      Promise.resolve({
        message:
          'run signing-key create to enable code signing; it arrives with milestone 3',
        status: 'skipped',
        value: undefined,
      }),
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
  description:
    'Set a Capacitor project up from sign-in to the first release, re-runnable at any step.',
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
        'The app target to add the resource to, when the iOS project has several.',
      ),
  }),
});

/**
 * The credential in place — a session or `HOTCODEPUSH_TOKEN` — or the `login` flow: non-interactively it leaves the device code for the next run.
 */
async function signIn(options: InitOptions): Promise<StepOutcome<HotCodePush>> {
  if (readToken() !== undefined) {
    try {
      const credential = await fetchCredential();
      return {
        message: credential.description,
        status: 'skipped',
        value: createApiClient(),
      };
    } catch (error) {
      if (!(error instanceof NotLoggedInError)) {
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

function resolveProjectFiles(
  directoryPath: string,
  projectConfig: ProjectConfig | undefined,
  options: InitOptions,
): ProjectFiles {
  const iosProjectPath =
    options.iosPath === undefined
      ? resolveNativeProjectPaths(directoryPath).ios
      : join(directoryPath, options.iosPath);
  return {
    directoryPath,
    packageJson: readPackageJson(directoryPath),
    projectConfig,
    xcodeProjectFilePath: resolveXcodeProjectFilePath(iosProjectPath),
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
  directoryPath,
  packageJson,
  projectConfig,
  xcodeProjectFilePath,
}: ProjectFiles): string[] {
  const filePaths: string[] = [];
  if (
    !isPackageInstalled(packageJson) ||
    resolveEmbedHookState(packageJson) !== 'wired'
  ) {
    filePaths.push('package.json');
  }
  if (!isConfigurationComplete(projectConfig)) {
    filePaths.push(PROJECT_CONFIG_FILE_NAME);
  }
  if (
    xcodeProjectFilePath !== undefined &&
    !hasReadableResourceReference(xcodeProjectFilePath)
  ) {
    filePaths.push(relative(directoryPath, xcodeProjectFilePath));
  }
  return filePaths;
}

/**
 * Whether the reference is there; a project the CLI cannot read counts as one to change, and the hook step says why.
 */
function hasReadableResourceReference(xcodeProjectFilePath: string): boolean {
  try {
    return hasResourceReference(xcodeProjectFilePath);
  } catch {
    return false;
  }
}

function installPackage(
  { directoryPath, packageJson }: ProjectFiles,
  editBlocker: ConfirmationRequiredError | undefined,
): Promise<StepOutcome<undefined>> {
  if (isPackageInstalled(packageJson)) {
    return Promise.resolve({
      message: `${CAPACITOR_PACKAGE_NAME} already installed`,
      status: 'skipped',
      value: undefined,
    });
  }
  if (editBlocker !== undefined) {
    throw editBlocker;
  }
  const packageManager = resolvePackageManager(directoryPath);
  runCommandLineVisibly(
    resolveInstallCommandLine(packageManager, CAPACITOR_PACKAGE_SPEC),
    directoryPath,
  );
  return Promise.resolve({
    message: `installed ${CAPACITOR_PACKAGE_NAME} from ${CAPACITOR_PACKAGE_SPEC}`,
    status: 'done',
    value: undefined,
  });
}

/**
 * `hotcodepush.json` with the app, its production channel and the web build from `capacitor.config`; a file present keeps what it has.
 */
function writeConfiguration(
  { directoryPath, projectConfig }: ProjectFiles,
  app: App,
  editBlocker: ConfirmationRequiredError | undefined,
): Promise<StepOutcome<undefined>> {
  if (isConfigurationComplete(projectConfig)) {
    return Promise.resolve({
      message: `${PROJECT_CONFIG_FILE_NAME} already present`,
      status: 'skipped',
      value: undefined,
    });
  }
  if (editBlocker !== undefined) {
    throw editBlocker;
  }
  const dir = projectConfig?.dir ?? readCapacitorWebDir(directoryPath);
  if (dir === undefined) {
    throw new InvalidParameterError(
      'capacitor.config names no webDir',
      undefined,
      `set dir in ${PROJECT_CONFIG_FILE_NAME} to the web build directory.`,
    );
  }
  const filePath = join(directoryPath, PROJECT_CONFIG_FILE_NAME);
  const sourceText = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  writeFileSync(
    filePath,
    stringifyLikeSource(
      {
        ...projectConfig,
        appId: projectConfig?.appId ?? app.id,
        channelId: projectConfig?.channelId ?? app.defaultChannelId,
        dir,
      },
      sourceText || '{}\n',
    ),
  );
  return Promise.resolve({
    message: `${projectConfig === undefined ? 'wrote' : 'completed'} ${PROJECT_CONFIG_FILE_NAME}`,
    status: 'done',
    value: undefined,
  });
}

/**
 * The embed command in the `capacitor:copy:after` script and the resource reference in the iOS project, each left alone when present.
 */
async function wireHook(
  { directoryPath, xcodeProjectFilePath }: ProjectFiles,
  editBlocker: ConfirmationRequiredError | undefined,
  options: InitOptions,
): Promise<StepOutcome<undefined>> {
  const isHookWired =
    resolveEmbedHookState(readPackageJson(directoryPath)) === 'wired';
  const isReferencePresent =
    xcodeProjectFilePath === undefined ||
    hasReadableResourceReference(xcodeProjectFilePath);
  if (isHookWired && isReferencePresent) {
    return {
      message: `${EMBED_HOOK_NAME} and the iOS resource reference already wired`,
      status: 'skipped',
      value: undefined,
    };
  }
  if (editBlocker !== undefined) {
    throw editBlocker;
  }
  const wired: string[] = [];
  if (wireEmbedHook(directoryPath) === 'wired') {
    wired.push(EMBED_HOOK_NAME);
  }
  if (
    xcodeProjectFilePath !== undefined &&
    (await addResourceReference(xcodeProjectFilePath, options)) === 'added'
  ) {
    wired.push('the iOS resource reference');
  }
  return {
    message: `wired ${wired.join(' and ')}`,
    status: 'done',
    value: undefined,
  };
}

/**
 * The project's `build` script, run visibly when a release follows; skipped with the reason otherwise.
 */
function buildProject(
  { directoryPath, packageJson }: ProjectFiles,
  isReleaseWanted: boolean,
): Promise<StepOutcome<boolean>> {
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
  { directoryPath, packageJson, projectConfig }: ProjectFiles,
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
  const dir = projectConfig?.dir ?? readCapacitorWebDir(directoryPath) ?? '';
  if (!isBuilt && !existsSync(join(directoryPath, dir))) {
    const buildCommandLine = resolveBuildCommandLine(
      directoryPath,
      packageJson,
    );
    return {
      message: `${buildCommandLine === undefined ? 'no build script and ' : ''}no output at ${dir}; build, then release create`,
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

function isConfigurationComplete(
  projectConfig: ProjectConfig | undefined,
): projectConfig is Required<ProjectConfig> {
  return (
    projectConfig?.appId !== undefined &&
    projectConfig.channelId !== undefined &&
    projectConfig.dir !== undefined
  );
}

function isPackageInstalled(packageJson: PackageJson): boolean {
  return (
    packageJson.dependencies?.[CAPACITOR_PACKAGE_NAME] !== undefined ||
    packageJson.devDependencies?.[CAPACITOR_PACKAGE_NAME] !== undefined
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
