import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readJsonFile,
  writeCapacitorProject,
} from '../testing/capacitor-project.js';
import { useCommandHarness } from '../testing/command-harness.js';
import {
  ACME_ORGANIZATION,
  DEMO_APP,
  GLOBEX_ORGANIZATION,
  PRODUCTION_CHANNEL,
} from '../testing/fixtures.js';
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
    harness.routes['GET /v1/auth/get-session'] = () =>
      Response.json({
        session: { id: 'session-1', userId: 'user-1' },
        user: { email: 'anna@example.com', id: 'user-1', name: 'Anna Example' },
      });
    harness.routes['GET /v1/organizations'] = () =>
      Response.json(organizations);
  }

  function readStepStatuses(result: InitResult): Record<string, string> {
    return Object.fromEntries(
      result.steps.map(({ status, step }) => [step, status]),
    );
  }

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
        args: [
          'install',
          '--save-exact',
          'https://pkg.pr.new/hotcodepush-team/capacitor-live-updates/@hotcodepush/capacitor-live-updates@93a9cc2',
        ],
        command: 'npm',
      },
      directoryPath,
    );
    expect(readJsonFile(join(directoryPath, 'hotcodepush.json'))).toEqual({
      appId: DEMO_APP.id,
      channelId: PRODUCTION_CHANNEL.id,
      dir: 'www',
    });
    expect(
      readJsonFile<{ scripts: Record<string, string> }>(
        join(directoryPath, 'package.json'),
      ).scripts['capacitor:copy:after'],
    ).toBe('npx hotcodepush bundle embed');
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
      'installed @hotcodepush/capacitor-live-updates from https://pkg.pr.new/hotcodepush-team/capacitor-live-updates/@hotcodepush/capacitor-live-updates@93a9cc2',
      'wrote hotcodepush.json',
      'wired capacitor:copy:after and the iOS resource reference',
      'run signing-key create to enable code signing; it arrives with milestone 3',
      'no release follows: run npm run build, then release create',
      'run release create to publish the first release',
    ]);
  }, 15_000);

  it('should skip what a set-up project already has, naming the app hotcodepush.json names', async () => {
    const directoryPath = writeProject({
      hookScript: 'npx hotcodepush bundle embed',
      isPackageInstalled: true,
      projectConfig: {
        appId: DEMO_APP.id,
        channelId: PRODUCTION_CHANNEL.id,
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
    respondWithSession([ACME_ORGANIZATION]);
    harness.routes[`GET /v1/apps/${DEMO_APP.id}`] = () =>
      Response.json(DEMO_APP);

    await initCommand.action(
      { config: join(directoryPath, 'hotcodepush.json'), yes: true },
      undefined,
    );

    expect(existsSync(pbxprojPath)).toBe(false);
    expect(runCommandLineVisibly).not.toHaveBeenCalled();
    expect(harness.readLines()).toEqual([
      '– sign-in        logged in as Anna Example (anna@example.com)',
      '✓ organization   used organization Acme',
      '✓ app            used app Demo',
      '– package        @hotcodepush/capacitor-live-updates already installed',
      '– configuration  hotcodepush.json already present',
      '– hook           capacitor:copy:after and the iOS resource reference already wired',
      '– signing-key    run signing-key create to enable code signing; it arrives with milestone 3',
      '– build          no release follows: run npm run build, then release create',
      '– release        run release create to publish the first release',
      '',
      'Build the app natively once and run it; change a line, run the build and "npx hotcodepush release create", then reopen the app.',
      `Console: http://localhost:4300/apps/${DEMO_APP.id}`,
      'Docs: https://hotcodepush.com/docs',
    ]);
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
    expect(configurationStep).toEqual({
      code: 'E_CONFIRMATION_REQUIRED',
      manualStep: 'pass --yes to confirm.',
      message:
        'a confirmation is required: changes package.json, hotcodepush.json, ios/App/App.xcodeproj/project.pbxproj',
      status: 'stopped',
      step: 'configuration',
    });
    expect(readStepStatuses(result)).toMatchObject({
      configuration: 'stopped',
      hook: 'skipped',
      package: 'skipped',
      release: 'skipped',
    });
    expect(result.steps.find(({ step }) => step === 'hook')?.message).toBe(
      'not run: init stopped at configuration',
    );
    expect(existsSync(join(directoryPath, 'hotcodepush.json'))).toBe(false);
  });

  it('should skip the sign-in under HOTCODEPUSH_TOKEN, an API token no session answers for, and never start a device login', async () => {
    const directoryPath = writeProject({
      hookScript: 'npx hotcodepush bundle embed',
      isPackageInstalled: true,
      projectConfig: {
        appId: DEMO_APP.id,
        channelId: PRODUCTION_CHANNEL.id,
        dir: 'www',
      },
    });
    rmSync(join(directoryPath, 'ios'), { force: true, recursive: true });
    harness.routes['GET /v1/auth/get-session'] = () => Response.json(null);
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION]);
    harness.routes[`GET /v1/apps/${DEMO_APP.id}`] = () =>
      Response.json(DEMO_APP);

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
      message: 'authenticated with HOTCODEPUSH_TOKEN',
      status: 'skipped',
      step: 'sign-in',
    });
    expect(
      harness.requests.filter(({ url }) => url.includes('/device')),
    ).toEqual([]);
  });

  it('should log in in place with the kept device code and keep --json stdout to the result', async () => {
    const directoryPath = writeProject({
      hookScript: 'npx hotcodepush bundle embed',
      isPackageInstalled: true,
      projectConfig: {
        appId: DEMO_APP.id,
        channelId: PRODUCTION_CHANNEL.id,
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
    harness.routes[`GET /v1/apps/${DEMO_APP.id}`] = () =>
      Response.json(DEMO_APP);

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
      manualStep: 'add "npx hotcodepush bundle embed" to it by hand.',
      message: 'capacitor:copy:after runs a script the CLI cannot parse',
      status: 'stopped',
      step: 'hook',
    });
    expect(readJsonFile(join(directoryPath, 'hotcodepush.json'))).toEqual({
      appId: DEMO_APP.id,
      channelId: PRODUCTION_CHANNEL.id,
      dir: 'www',
    });
  });

  it('should stop at the organization with E_MISSING_PARAMETER when the user belongs to several and none is named', async () => {
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
      'hook': 'skipped',
      'organization': 'stopped',
      'package': 'skipped',
      'release': 'skipped',
      'sign-in': 'skipped',
      'signing-key': 'skipped',
    });
    expect(result.steps[1]?.code).toBe('E_MISSING_PARAMETER');
    expect(result.steps[2]?.message).toBe(
      'not run: init stopped at organization',
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
});
