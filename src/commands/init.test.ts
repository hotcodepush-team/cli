import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { confirm, select } from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readJsonFile,
  writeCapacitorProject,
} from '../../test/capacitor-project.js';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../test/command-harness.js';
import { writeCordovaProject } from '../../test/cordova-project.js';
import {
  ACME_ORGANIZATION,
  DEMO_APP,
  GLOBEX_ORGANIZATION,
  PRODUCTION_CHANNEL,
  RUNNER_USER,
  SIGNING_KEY,
} from '../../test/fixtures.js';
import {
  APP_DELEGATE_FILE_PATH,
  APP_GRADLE_FILE_PATH,
  MAIN_APPLICATION_FILE_PATH,
  PODFILE_PATH,
  XCODE_PROJECT_FILE_PATH,
  readProjectFile,
  writeInstalledSdk,
  writeReactNativeProject,
} from '../../test/react-native-project.js';
import { CAPACITOR_PACKAGE_SPEC } from '../config/consts.js';
import {
  ReportedFailureError,
  UnknownFrameworkError,
} from '../utils/errors.js';
import type * as packageManagerModule from '../utils/package-manager.js';
import { runCommandLineVisibly } from '../utils/package-manager.js';
import { readUserConfig, writeUserConfig } from '../utils/user-config.js';
import { hasResourceReference } from '../utils/xcode-project.js';
import initCommand from './init.js';

// the in-place login must not touch the machine's keyring: a fake one keeps the token the flow stores
const keyring = vi.hoisted(() => {
  let storedToken: string | null = null;
  return {
    deletePassword: () => {
      storedToken = null;
      return true;
    },
    getPassword: () => storedToken,
    setPassword: (token: string) => {
      storedToken = token;
    },
  };
});
vi.mock('@napi-rs/keyring', () => ({
  Entry: vi.fn(function () {
    return keyring;
  }),
}));
vi.mock('@clack/prompts');
vi.mock('../utils/package-manager.js', async importOriginal => ({
  ...(await importOriginal<typeof packageManagerModule>()),
  runCommandLineVisibly: vi.fn(),
}));

const APPS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/apps`;

interface InitResult {
  status: string;
  steps: {
    code?: string;
    manualStep?: string;
    message: string;
    status: string;
    step: string;
  }[];
}

describe('init', () => {
  const harness = useCommandHarness();
  const directoryPaths: string[] = [];

  function writeProject(
    options: Parameters<typeof writeCapacitorProject>[0] = {},
  ): string {
    const directoryPath = writeCapacitorProject(options);
    directoryPaths.push(directoryPath);
    return directoryPath;
  }

  function respondWithSession(organizations: object[]): void {
    harness.routes['GET /v1/users/me'] = () => Response.json(RUNNER_USER);
    harness.routes['GET /v1/organizations'] = () =>
      Response.json(organizations);
  }

  function respondWithConfiguredApp(): void {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}`] = () =>
      Response.json(DEMO_APP);
    harness.routes[`GET /v1/organizations/${ACME_ORGANIZATION.id}`] = () =>
      Response.json(ACME_ORGANIZATION);
  }

  function readStepStatuses(result: InitResult): Record<string, string> {
    return Object.fromEntries(
      result.steps.map(({ status, step }) => [step, status]),
    );
  }

  beforeEach(() => {
    // the configuration step names the app's default channel by its name
    harness.routes[
      `GET /v1/apps/${DEMO_APP.id}/channels/${PRODUCTION_CHANNEL.id}`
    ] = () => Response.json(PRODUCTION_CHANNEL);
  });

  afterEach(() => {
    for (const directoryPath of directoryPaths.splice(0)) {
      rmSync(directoryPath, { force: true, recursive: true });
    }
  });

  it('should set a fresh project up with --yes: the only organization, the app --app creates, the package, hotcodepush.json, the hook and the resource reference', async () => {
    const directoryPath = writeProject();
    respondWithSession([ACME_ORGANIZATION]);
    harness.routes[`GET ${APPS_PATH}`] = () => Response.json([]);
    harness.routes[`POST ${APPS_PATH}`] = () =>
      Response.json(DEMO_APP, { status: 201 });

    await initCommand.action(
      { app: 'Demo', json: true, yes: true, ...withCwd(directoryPath) },
      undefined,
    );

    const createRequest = harness.requests.find(
      ({ method }) => method === 'POST',
    );
    expect(createRequest?.url).toBe(`https://api.example.com${APPS_PATH}`);
    expect(await createRequest?.json()).toEqual({
      framework: 'capacitor',
      name: 'Demo',
    });
    expect(runCommandLineVisibly).toHaveBeenCalledWith(
      {
        args: ['install', '--save-exact', CAPACITOR_PACKAGE_SPEC],
        command: 'npm',
      },
      directoryPath,
    );
    expect(readJsonFile(join(directoryPath, 'hotcodepush.json'))).toEqual({
      appId: DEMO_APP.id,
      channel: PRODUCTION_CHANNEL.name,
      dir: 'www',
    });
    expect(
      readJsonFile<{ scripts: Record<string, string> }>(
        join(directoryPath, 'package.json'),
      ).scripts['capacitor:copy:after'],
    ).toBe('npx hotcodepush binary create');
    expect(
      hasResourceReference(
        join(directoryPath, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'),
      ),
    ).toBe(true);
    const result = harness.readJson() as InitResult;
    expect(result.status).toBe('complete');
    expect(readStepStatuses(result)).toEqual({
      'app': 'done',
      'build': 'skipped',
      'configuration': 'done',
      'hook': 'done',
      'organization': 'done',
      'package': 'done',
      'release': 'skipped',
      'sign-in': 'skipped',
      'signing-key': 'skipped',
    });
    expect(result.steps.map(({ message }) => message)).toEqual([
      'logged in as Anna Example (anna@example.com)',
      'used organization Acme',
      'created app Demo',
      `installed @hotcodepush/capacitor-live-updates from ${CAPACITOR_PACKAGE_SPEC}`,
      'wrote hotcodepush.json',
      'wired capacitor:copy:after and the iOS resource reference',
      'run signing-key create to enable code signing',
      'no release follows: run npm run build, then release create',
      'run release create to publish the first release',
    ]);
  }, 15_000);

  it('should skip what a set-up project already has, the app and its organization from hotcodepush.json, whatever --organization would need', async () => {
    const directoryPath = writeProject({
      hookScript: 'npx hotcodepush binary create',
      isPackageInstalled: true,
      projectConfig: {
        appId: DEMO_APP.id,
        channel: PRODUCTION_CHANNEL.name,
        dir: 'www',
      },
    });
    const pbxprojPath = join(
      directoryPath,
      'ios',
      'App',
      'App.xcodeproj',
      'project.pbxproj',
    );
    rmSync(join(directoryPath, 'ios'), { force: true, recursive: true });
    respondWithSession([ACME_ORGANIZATION, GLOBEX_ORGANIZATION]);
    respondWithConfiguredApp();

    await initCommand.action(
      { config: join(directoryPath, 'hotcodepush.json'), yes: true },
      undefined,
    );

    expect(existsSync(pbxprojPath)).toBe(false);
    expect(runCommandLineVisibly).not.toHaveBeenCalled();
    expect(harness.readLines()).toEqual([
      '– sign-in        logged in as Anna Example (anna@example.com)',
      "✓ organization   used organization Acme, the one of hotcodepush.json's app",
      '✓ app            used app Demo, as hotcodepush.json names it',
      '– package        @hotcodepush/capacitor-live-updates already installed',
      '– configuration  hotcodepush.json already present',
      '– hook           capacitor:copy:after and the iOS resource reference already wired',
      '– signing-key    run signing-key create to enable code signing',
      '– build          no release follows: run npm run build, then release create',
      '– release        run release create to publish the first release',
      '',
      'Build the app natively once and run it; change a line, run the build and "npx hotcodepush release create", then reopen the app.',
      `Console: http://localhost:4300/apps/${DEMO_APP.id}`,
      'Docs: https://hotcodepush.com/docs',
    ]);
  });

  it('should complete a hotcodepush.json that names its channel by id without naming another channel', async () => {
    const directoryPath = writeProject({
      hookScript: 'npx hotcodepush binary create',
      isPackageInstalled: true,
      projectConfig: { appId: DEMO_APP.id, channel: PRODUCTION_CHANNEL.id },
    });
    rmSync(join(directoryPath, 'ios'), { force: true, recursive: true });
    respondWithSession([ACME_ORGANIZATION]);
    respondWithConfiguredApp();

    await initCommand.action(
      {
        config: join(directoryPath, 'hotcodepush.json'),
        json: true,
        yes: true,
      },
      undefined,
    );

    expect(readJsonFile(join(directoryPath, 'hotcodepush.json'))).toEqual({
      appId: DEMO_APP.id,
      channel: PRODUCTION_CHANNEL.id,
      dir: 'www',
    });
  });

  it('should stop the editing steps with E_CONFIRMATION_REQUIRED when nobody can confirm the files to change', async () => {
    const directoryPath = writeProject({ isPackageInstalled: true });
    respondWithSession([ACME_ORGANIZATION]);
    harness.routes[`GET ${APPS_PATH}`] = () => Response.json([DEMO_APP]);

    await expect(
      initCommand.action({ json: true, ...withCwd(directoryPath) }, undefined),
    ).rejects.toBeInstanceOf(ReportedFailureError);

    const result = harness.readJson() as InitResult;
    expect(result.status).toBe('incomplete');
    const configurationStep = result.steps.find(
      ({ step }) => step === 'configuration',
    );
    const projectFilePath = join(
      'ios',
      'App',
      'App.xcodeproj',
      'project.pbxproj',
    );
    expect(configurationStep).toEqual({
      code: 'E_CONFIRMATION_REQUIRED',
      manualStep: `run init --yes to change package.json, hotcodepush.json, ${projectFilePath}`,
      message: `a confirmation is required: changes package.json, hotcodepush.json, ${projectFilePath}`,
      status: 'stopped',
      step: 'configuration',
    });
    expect(readStepStatuses(result)).toMatchObject({
      configuration: 'stopped',
      hook: 'stopped',
      package: 'skipped',
      release: 'skipped',
    });
    expect(result.steps.find(({ step }) => step === 'release')?.message).toBe(
      'waits on the configuration step',
    );
    expect(existsSync(join(directoryPath, 'hotcodepush.json'))).toBe(false);
  });

  it('should skip the sign-in under HOTCODEPUSH_TOKEN, an API token no session answers for, and never start a device login', async () => {
    const directoryPath = writeProject({
      hookScript: 'npx hotcodepush binary create',
      isPackageInstalled: true,
      projectConfig: {
        appId: DEMO_APP.id,
        channel: PRODUCTION_CHANNEL.name,
        dir: 'www',
      },
    });
    rmSync(join(directoryPath, 'ios'), { force: true, recursive: true });
    harness.routes['GET /v1/users/me'] = () =>
      Response.json({ ...RUNNER_USER, credential: 'token' });
    respondWithConfiguredApp();

    await initCommand.action(
      {
        config: join(directoryPath, 'hotcodepush.json'),
        json: true,
        yes: true,
      },
      undefined,
    );

    const result = harness.readJson() as InitResult;
    expect(result.status).toBe('complete');
    expect(result.steps[0]).toEqual({
      message:
        'authenticated with HOTCODEPUSH_TOKEN as Anna Example (anna@example.com)',
      status: 'skipped',
      step: 'sign-in',
    });
    expect(
      harness.requests.filter(({ url }) => url.includes('/device')),
    ).toEqual([]);
  });

  it('should log in in place with the kept device code and keep --json stdout to the result', async () => {
    const directoryPath = writeProject({
      hookScript: 'npx hotcodepush binary create',
      isPackageInstalled: true,
      projectConfig: {
        appId: DEMO_APP.id,
        channel: PRODUCTION_CHANNEL.name,
        dir: 'www',
      },
    });
    rmSync(join(directoryPath, 'ios'), { force: true, recursive: true });
    vi.stubEnv('HOTCODEPUSH_TOKEN', '');
    writeUserConfig({
      ...readUserConfig(),
      pendingDeviceCode: 'device-code-1',
      pendingDeviceCodeExpiresAt: '2999-01-01T00:00:00.000Z',
      pendingUserCode: 'KEPTCODE',
      pendingVerificationUrl:
        'https://console.example.com/device?user_code=KEPTCODE',
    });
    let hasToken = false;
    harness.routes['POST /v1/auth/device/token'] = () => {
      hasToken = true;
      return Response.json({
        access_token: 'session-token-2',
        token_type: 'Bearer',
      });
    };
    harness.routes['GET /v1/auth/get-session'] = () =>
      hasToken
        ? Response.json({
            session: { id: 'session-2', userId: 'user-1' },
            user: {
              email: 'anna@example.com',
              id: 'user-1',
              name: 'Anna Example',
            },
          })
        : Response.json(null);
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION]);
    respondWithConfiguredApp();

    await initCommand.action(
      {
        config: join(directoryPath, 'hotcodepush.json'),
        json: true,
        yes: true,
      },
      undefined,
    );

    const result = harness.readJson() as InitResult;
    expect(result.steps[0]).toEqual({
      message: 'logged in as Anna Example (anna@example.com)',
      status: 'done',
      step: 'sign-in',
    });
    expect(readUserConfig().pendingDeviceCode).toBeUndefined();
  });

  it('should stop at the hook with E_HOOK_OCCUPIED and the manual step when the script cannot be parsed', async () => {
    const directoryPath = writeProject({
      hookScript: 'a; b',
      isPackageInstalled: true,
    });
    respondWithSession([ACME_ORGANIZATION]);
    harness.routes[`GET ${APPS_PATH}`] = () => Response.json([DEMO_APP]);

    await expect(
      initCommand.action(
        { json: true, yes: true, ...withCwd(directoryPath) },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ReportedFailureError);

    const result = harness.readJson() as InitResult;
    expect(result.steps.find(({ step }) => step === 'hook')).toEqual({
      code: 'E_HOOK_OCCUPIED',
      manualStep:
        'append " && npx hotcodepush binary create" to the capacitor:copy:after script in package.json.',
      message: 'capacitor:copy:after runs a script the CLI cannot parse',
      status: 'stopped',
      step: 'hook',
    });
    expect(readStepStatuses(result)).toMatchObject({
      'build': 'skipped',
      'release': 'skipped',
      'signing-key': 'skipped',
    });
    expect(readJsonFile(join(directoryPath, 'hotcodepush.json'))).toEqual({
      appId: DEMO_APP.id,
      channel: PRODUCTION_CHANNEL.name,
      dir: 'www',
    });
  });

  it('should stop at the organization when the user belongs to several and none is named, and still run the independent steps', async () => {
    const directoryPath = writeProject();
    respondWithSession([ACME_ORGANIZATION, GLOBEX_ORGANIZATION]);

    await expect(
      initCommand.action(
        { json: true, yes: true, ...withCwd(directoryPath) },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ReportedFailureError);

    const result = harness.readJson() as InitResult;
    expect(readStepStatuses(result)).toEqual({
      'app': 'skipped',
      'build': 'skipped',
      'configuration': 'skipped',
      'hook': 'done',
      'organization': 'stopped',
      'package': 'done',
      'release': 'skipped',
      'sign-in': 'skipped',
      'signing-key': 'skipped',
    });
    expect(result.steps[1]?.code).toBe('E_MISSING_PARAMETER');
    expect(result.steps[2]?.message).toBe('waits on the organization step');
    expect(result.steps[4]?.message).toBe('waits on the app step');
    expect(result.steps[8]?.message).toBe('waits on the configuration step');
  });

  it('should offer the picker with a create choice interactively, even with one organization and one app', async () => {
    stubInteractiveTerminal();
    vi.mocked(select)
      .mockResolvedValueOnce(ACME_ORGANIZATION.id)
      .mockResolvedValueOnce(DEMO_APP.id);
    // the files to change, then the signing key, then the first release
    vi.mocked(confirm)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    const directoryPath = writeProject({ isPackageInstalled: true });
    respondWithSession([ACME_ORGANIZATION]);
    harness.routes[`GET ${APPS_PATH}`] = () => Response.json([DEMO_APP]);

    await initCommand.action({ ...withCwd(directoryPath) }, undefined);

    expect(select).toHaveBeenNthCalledWith(1, {
      message: 'Which organization?',
      options: [
        { label: 'Acme', value: ACME_ORGANIZATION.id },
        { label: 'Create a new organization', value: 'create' },
      ],
    });
    expect(select).toHaveBeenNthCalledWith(2, {
      message: 'Which app?',
      options: [
        { label: 'Demo', value: DEMO_APP.id },
        { label: 'Create a new app', value: 'create' },
      ],
    });
    expect(harness.readLines().slice(1, 3)).toEqual([
      '✓ organization   used organization Acme',
      '✓ app            used app Demo',
    ]);
  });

  it('should generate a signing key pair in place when a person says yes', async () => {
    stubInteractiveTerminal();
    vi.mocked(select)
      .mockResolvedValueOnce(ACME_ORGANIZATION.id)
      .mockResolvedValueOnce(DEMO_APP.id);
    // the files to change, then the signing key, then the first release
    vi.mocked(confirm)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const directoryPath = writeProject({ isPackageInstalled: true });
    respondWithSession([ACME_ORGANIZATION]);
    harness.routes[`GET ${APPS_PATH}`] = () => Response.json([DEMO_APP]);
    harness.routes[`POST /v1/apps/${DEMO_APP.id}/signing-keys`] =
      async request =>
        Response.json(
          {
            ...SIGNING_KEY,
            ...((await request.json()) as { publicKey: string }),
          },
          { status: 201 },
        );

    await initCommand.action({ ...withCwd(directoryPath) }, undefined);

    expect(confirm).toHaveBeenNthCalledWith(2, {
      initialValue: true,
      message: 'Generate a signing key pair?',
    });
    expect(
      readJsonFile<{ publicKeys: string[] }>(
        join(directoryPath, 'hotcodepush.json'),
      ).publicKeys,
    ).toEqual([expect.stringMatching(/^rsa-v1_5-sha256:/)]);
    expect(harness.readLines()).toContain(
      '✓ signing-key    generated a signing key pair, its private key in the file named above',
    );
    expect(existsSync(join(directoryPath, 'hotcodepush-private-key.pem'))).toBe(
      true,
    );
  });

  it('should skip the signing key for an app that has one', async () => {
    const directoryPath = writeProject({
      hookScript: 'npx hotcodepush binary create',
      isPackageInstalled: true,
      projectConfig: {
        appId: DEMO_APP.id,
        channel: PRODUCTION_CHANNEL.name,
        dir: 'www',
      },
    });
    respondWithSession([ACME_ORGANIZATION]);
    respondWithConfiguredApp();
    harness.routes[`GET /v1/apps/${DEMO_APP.id}`] = () =>
      Response.json({ ...DEMO_APP, hasSigningKey: true });

    await initCommand.action(
      {
        config: join(directoryPath, 'hotcodepush.json'),
        json: true,
        yes: true,
      },
      undefined,
    );

    expect(
      (harness.readJson() as InitResult).steps.find(
        ({ step }) => step === 'signing-key',
      ),
    ).toEqual({
      message: 'the app already has a signing key',
      status: 'skipped',
      step: 'signing-key',
    });
  });

  it('should take the native projects from --ios-path and --android-path, typed against the working directory', async () => {
    const directoryPath = writeProject({ isPackageInstalled: true });
    renameSync(join(directoryPath, 'ios'), join(directoryPath, 'native-ios'));
    renameSync(
      join(directoryPath, 'android'),
      join(directoryPath, 'native-android'),
    );
    respondWithSession([ACME_ORGANIZATION]);
    harness.routes[`GET ${APPS_PATH}`] = () => Response.json([DEMO_APP]);

    await initCommand.action(
      {
        androidPath: 'native-android',
        iosPath: 'native-ios',
        json: true,
        yes: true,
        ...withCwd(directoryPath),
      },
      undefined,
    );

    const result = harness.readJson() as InitResult;
    expect(result.status).toBe('complete');
    expect(
      hasResourceReference(
        join(
          directoryPath,
          'native-ios',
          'App',
          'App.xcodeproj',
          'project.pbxproj',
        ),
      ),
    ).toBe(true);
  });

  it('should stop the hook with the manual step when neither native project exists and nobody can be asked', async () => {
    const directoryPath = writeProject({ isPackageInstalled: true });
    rmSync(join(directoryPath, 'ios'), { force: true, recursive: true });
    rmSync(join(directoryPath, 'android'), { force: true, recursive: true });
    respondWithSession([ACME_ORGANIZATION]);
    harness.routes[`GET ${APPS_PATH}`] = () => Response.json([DEMO_APP]);

    await expect(
      initCommand.action(
        { json: true, yes: true, ...withCwd(directoryPath) },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ReportedFailureError);

    const result = harness.readJson() as InitResult;
    expect(result.steps.find(({ step }) => step === 'hook')).toEqual({
      code: 'E_MISSING_PARAMETER',
      manualStep:
        'run "npx cap add ios" and "npx cap add android", or pass --ios-path and --android-path; neither ios nor android exists.',
      message: '--ios-path is missing',
      status: 'stopped',
      step: 'hook',
    });
  });

  it('should set a Cordova project up through cordova plugin add, with www as the build directory and no hook to wire', async () => {
    const directoryPath = writeCordovaProject();
    directoryPaths.push(directoryPath);
    respondWithSession([ACME_ORGANIZATION]);
    harness.routes[`GET ${APPS_PATH}`] = () => Response.json([DEMO_APP]);

    await initCommand.action(
      { json: true, yes: true, ...withCwd(directoryPath) },
      undefined,
    );

    expect(runCommandLineVisibly).toHaveBeenCalledWith(
      {
        args: [
          'cordova',
          'plugin',
          'add',
          expect.stringMatching(/@hotcodepush\/cordova-code-push@/) as string,
        ],
        command: 'npx',
      },
      directoryPath,
    );
    expect(readJsonFile(join(directoryPath, 'hotcodepush.json'))).toEqual({
      appId: DEMO_APP.id,
      channel: PRODUCTION_CHANNEL.name,
      dir: 'www',
    });
    const result = harness.readJson() as InitResult;
    expect(result.status).toBe('complete');
    expect(readStepStatuses(result)).toMatchObject({
      configuration: 'done',
      hook: 'skipped',
      package: 'done',
    });
    expect(result.steps.find(({ step }) => step === 'hook')?.message).toBe(
      'the plugin brings its after_prepare hook; nothing to wire',
    );
  });

  it('should refuse a project without a supported framework before any step', async () => {
    const directoryPath = writeProject();
    rmSync(join(directoryPath, 'package.json'));

    await expect(
      initCommand.action({ yes: true, ...withCwd(directoryPath) }, undefined),
    ).rejects.toBeInstanceOf(UnknownFrameworkError);

    expect(harness.requests).toEqual([]);
  });

  /**
   * A project without hotcodepush.json is found from the working directory; the test points the process there.
   */
  function withCwd(directoryPath: string): Record<string, never> {
    vi.spyOn(process, 'cwd').mockReturnValue(directoryPath);
    return {};
  }

  describe('in a React Native project', () => {
    function writeReactNative(
      options: Parameters<typeof writeReactNativeProject>[0] = {},
    ): string {
      const directoryPath = writeReactNativeProject(options);
      directoryPaths.push(directoryPath);
      return directoryPath;
    }

    afterEach(() => {
      vi.mocked(runCommandLineVisibly).mockReset();
    });

    it('should install the SDK, write hotcodepush.json without dir, and wire the phase, the Gradle line, both apps and the pod', async () => {
      const directoryPath = writeReactNative();
      // the Podfile pins the commit the SDK names, which is there once the install ran
      vi.mocked(runCommandLineVisibly).mockImplementation(({ command }) => {
        if (command === 'npm') {
          writeInstalledSdk(directoryPath);
        }
      });
      respondWithSession([ACME_ORGANIZATION]);
      harness.routes[`GET ${APPS_PATH}`] = () => Response.json([]);
      harness.routes[`POST ${APPS_PATH}`] = () =>
        Response.json(
          { ...DEMO_APP, framework: 'react-native' },
          { status: 201 },
        );

      await initCommand.action(
        { app: 'Demo', json: true, yes: true, ...withCwd(directoryPath) },
        undefined,
      );

      const createRequest = harness.requests.find(
        ({ method }) => method === 'POST',
      );
      expect(await createRequest?.json()).toEqual({
        framework: 'react-native',
        name: 'Demo',
      });
      expect(readJsonFile(join(directoryPath, 'hotcodepush.json'))).toEqual({
        appId: DEMO_APP.id,
        channel: PRODUCTION_CHANNEL.name,
      });
      expect(readProjectFile(directoryPath, APP_GRADLE_FILE_PATH)).toContain(
        'hotcodepush.gradle',
      );
      expect(readProjectFile(directoryPath, APP_DELEGATE_FILE_PATH)).toContain(
        'HotCodePush.bundleURL()',
      );
      expect(
        readProjectFile(directoryPath, MAIN_APPLICATION_FILE_PATH),
      ).toContain('HotCodePushReactHost.getDefaultReactHost');
      expect(readProjectFile(directoryPath, PODFILE_PATH)).toContain(
        "pod 'HotCodePushCore'",
      );
      expect(readProjectFile(directoryPath, XCODE_PROJECT_FILE_PATH)).toContain(
        'Create HotCodePush binary',
      );
      expect(runCommandLineVisibly).toHaveBeenLastCalledWith(
        { args: ['install'], command: 'pod' },
        join(directoryPath, 'ios'),
      );
      const result = harness.readJson() as InitResult;
      expect(result.status).toBe('complete');
      expect(result.steps.slice(3).map(({ message }) => message)).toEqual([
        expect.stringMatching(
          /^installed @hotcodepush\/react-native-code-push from https:\/\/pkg\.pr\.new\//,
        ),
        'wrote hotcodepush.json',
        'wired the Create HotCodePush binary phase in Xcode, the Gradle task that runs binary create, HotCodePush.bundleURL() in AppDelegate.swift, HotCodePushReactHost in MainApplication.kt, the HotCodePushCore pod in the Podfile, the pods through pod install',
        'run signing-key create to enable code signing',
        'release create packages the bundles itself',
        'run release create to publish the first release',
      ]);
    }, 15_000);

    it('should name the native files it would change and change none when nobody can confirm', async () => {
      const directoryPath = writeReactNative();
      respondWithSession([ACME_ORGANIZATION]);
      harness.routes[`GET ${APPS_PATH}`] = () => Response.json([DEMO_APP]);

      await expect(
        initCommand.action(
          { json: true, ...withCwd(directoryPath) },
          undefined,
        ),
      ).rejects.toBeInstanceOf(ReportedFailureError);

      const result = harness.readJson() as InitResult;
      expect(result.steps.find(({ step }) => step === 'hook')?.message).toBe(
        `a confirmation is required: changes package.json, hotcodepush.json, ${XCODE_PROJECT_FILE_PATH}, ${APP_GRADLE_FILE_PATH}, ${APP_DELEGATE_FILE_PATH}, ${MAIN_APPLICATION_FILE_PATH}, ${PODFILE_PATH}`,
      );
      expect(
        readProjectFile(directoryPath, APP_GRADLE_FILE_PATH),
      ).not.toContain('hotcodepush.gradle');
    });
  });
});
