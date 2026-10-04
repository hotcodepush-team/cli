import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeCapacitorProject } from '../../test/capacitor-project.js';
import { useCommandHarness } from '../../test/command-harness.js';
import { writeCordovaProject } from '../../test/cordova-project.js';
import {
  DEMO_APP,
  PRODUCTION_CHANNEL,
  RUNNER_USER,
  SIGNING_KEY,
  SIGNING_PRIVATE_KEY,
} from '../../test/fixtures.js';
import {
  writeInstalledSdk,
  writeReactNativeProject,
} from '../../test/react-native-project.js';
import { respondWithChannels } from '../../test/release-routes.js';
import { ReportedFailureError } from '../utils/errors.js';
import { reactNativeFramework } from '../utils/frameworks/react-native.js';
import type * as packageManagerModule from '../utils/package-manager.js';
import { addResourceReference } from '../utils/xcode-project.js';
import doctorCommand from './doctor.js';

// wiring a React Native project ends with pod install, which a test never runs
vi.mock('../utils/package-manager.js', async importOriginal => ({
  ...(await importOriginal<typeof packageManagerModule>()),
  runCommandLineVisibly: vi.fn(),
}));

// the no-session case must not find a token in the machine's keyring
vi.mock('@napi-rs/keyring', () => ({
  Entry: vi.fn(function () {
    return { getPassword: () => null };
  }),
}));

interface DoctorResult {
  checks: {
    check: string;
    manualStep?: string;
    message: string;
    status: string;
  }[];
  status: string;
}

describe('doctor', () => {
  const harness = useCommandHarness();
  const directoryPaths: string[] = [];

  async function writeSetUpProject(): Promise<string> {
    const directoryPath = writeCapacitorProject({
      hookScript: 'npx hotcodepush binary create',
      isPackageInstalled: true,
      projectConfig: {
        appId: DEMO_APP.id,
        channel: PRODUCTION_CHANNEL.name,
        dir: 'www',
      },
    });
    directoryPaths.push(directoryPath);
    await addResourceReference(
      join(directoryPath, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'),
      {},
    );
    for (const packageName of [
      '@capacitor/core',
      '@hotcodepush/capacitor-live-updates',
    ]) {
      const packagePath = join(directoryPath, 'node_modules', packageName);
      mkdirSync(packagePath, { recursive: true });
      writeFileSync(
        join(packagePath, 'package.json'),
        JSON.stringify({ name: packageName, version: '8.0.0' }),
      );
    }
    const resourceFile = {
      appId: DEMO_APP.id,
      builtAt: '2026-09-29T12:00:00.000Z',
      channelId: PRODUCTION_CHANNEL.id,
      dir: 'www',
      embeddedBundleId: null,
      embeddedBundleManifest: {
        appId: DEMO_APP.id,
        bundleVersion: '1.0',
        files: [],
        fingerprint: null,
        keyId: null,
        platforms: ['ios'],
      },
      fingerprint: null,
    };
    mkdirSync(join(directoryPath, 'ios', 'App', 'App'), { recursive: true });
    writeFileSync(
      join(directoryPath, 'ios', 'App', 'App', 'hotcodepush.json'),
      JSON.stringify(resourceFile),
    );
    writeFileSync(
      join(
        directoryPath,
        'android',
        'app',
        'src',
        'main',
        'assets',
        'hotcodepush.json',
      ),
      JSON.stringify(resourceFile),
    );
    return directoryPath;
  }

  function respondWithSessionAndApp(): void {
    harness.routes['GET /v1/users/me'] = () => Response.json(RUNNER_USER);
    harness.routes[`GET /v1/apps/${DEMO_APP.id}`] = () =>
      Response.json(DEMO_APP);
    respondWithChannels(harness);
    harness.routes[
      `GET /v1/apps/${DEMO_APP.id}/channels/${PRODUCTION_CHANNEL.id}`
    ] = () => Response.json(PRODUCTION_CHANNEL);
    harness.routes['GET /health'] = () => Response.json({ status: 'ok' });
  }

  afterEach(() => {
    for (const directoryPath of directoryPaths.splice(0)) {
      rmSync(directoryPath, { force: true, recursive: true });
    }
  });

  it('should report a set-up project clean, with the versions a bug report needs', async () => {
    const directoryPath = await writeSetUpProject();
    respondWithSessionAndApp();

    await doctorCommand.action(
      { config: join(directoryPath, 'hotcodepush.json'), json: true },
      undefined,
    );

    const result = harness.readJson() as DoctorResult;
    expect(result.status).toBe('clean');
    expect(
      result.checks.map(({ check, status }) => `${check}:${status}`),
    ).toEqual([
      'configuration:ok',
      'session:ok',
      'app:ok',
      'package:ok',
      'hook:ok',
      'ios-project:ok',
      'android-resource-file:ok',
      'ios-resource-file:ok',
      'hosts:ok',
      'signing-key:skipped',
      'versions:ok',
    ]);
    expect(result.checks.at(-1)?.message).toMatch(
      /^hotcodepush \d+\.\d+\.\d+, node v\d+.*, @capacitor\/core 8\.0\.0, @hotcodepush\/capacitor-live-updates 8\.0\.0$/,
    );
  });

  it("should check a Cordova project by its plugin, its hook and the resource file beside each prepared platform's web assets", async () => {
    const directoryPath = writeCordovaProject({
      isPluginInstalled: true,
      projectConfig: {
        appId: DEMO_APP.id,
        channel: PRODUCTION_CHANNEL.name,
        dir: 'www',
      },
    });
    directoryPaths.push(directoryPath);
    const assetsPath = join(
      directoryPath,
      'platforms/android/app/src/main/assets/www',
    );
    mkdirSync(assetsPath, { recursive: true });
    respondWithSessionAndApp();

    await expect(
      doctorCommand.action(
        { config: join(directoryPath, 'hotcodepush.json'), json: true },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ReportedFailureError);

    const result = harness.readJson() as DoctorResult;
    expect(
      result.checks
        .slice(3, 7)
        .map(({ check, status }) => `${check}:${status}`),
    ).toEqual([
      'package:ok',
      'hook:ok',
      'android-resource-file:failed',
      'ios-resource-file:skipped',
    ]);
    expect(result.checks[5]?.manualStep).toBe(
      'run npx cordova prepare, which runs binary create',
    );
    expect(result.checks.at(-1)?.message).toMatch(
      /, cordova 13\.0\.0, cordova-android 15\.1\.0, cordova-ios missing, @hotcodepush\/cordova-code-push 0\.1\.0$/,
    );
  });

  it('should name the missing steps and the hosts it cannot reach, and exit with a failure', async () => {
    const directoryPath = await writeSetUpProject();
    writeFileSync(
      join(directoryPath, 'package.json'),
      JSON.stringify({
        dependencies: { '@capacitor/core': '8.0.0' },
        name: 'demo',
      }),
    );
    rmSync(
      join(
        directoryPath,
        'android',
        'app',
        'src',
        'main',
        'assets',
        'hotcodepush.json',
      ),
    );
    respondWithSessionAndApp();
    harness.routes['GET /health'] = () => {
      throw new TypeError('fetch failed');
    };

    await expect(
      doctorCommand.action(
        { config: join(directoryPath, 'hotcodepush.json') },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ReportedFailureError);

    expect(harness.readLines()).toEqual([
      `✓ configuration          hotcodepush.json names app ${DEMO_APP.id} and channel production, web build at www`,
      '✓ session                logged in as Anna Example (anna@example.com)',
      '✓ app                    app Demo, channel production',
      '✗ package                @hotcodepush/capacitor-live-updates is not in package.json',
      '                         run hotcodepush init',
      '✗ hook                   capacitor:copy:after does not run binary create',
      '                         run hotcodepush init',
      '✓ ios-project            the app target copies hotcodepush.json into the bundle',
      '✗ android-resource-file  no resource file at android/app/src/main/assets/hotcodepush.json',
      '                         run npx cap sync, which runs binary create',
      '✓ ios-resource-file      ios/App/App/hotcodepush.json built at 2026-09-29T12:00:00.000Z',
      '✗ hosts                  unreachable: api (https://api.example.com/health)',
      '                         check the network, the API URL in config.json and the HOTCODEPUSH_*_BASE_URL variables',
      '– signing-key            code signing is off; signing-key create turns it on',
      expect.stringMatching(/^✓ versions +hotcodepush /),
    ]);
  });

  it('should fail a resource file that names no channel, a build made offline or without a token', async () => {
    const directoryPath = await writeSetUpProject();
    const resourceFilePath = join(
      directoryPath,
      'ios',
      'App',
      'App',
      'hotcodepush.json',
    );
    writeFileSync(
      resourceFilePath,
      JSON.stringify({
        ...JSON.parse(readFileSync(resourceFilePath, 'utf8')),
        channelId: null,
      }),
    );
    respondWithSessionAndApp();

    await expect(
      doctorCommand.action(
        { config: join(directoryPath, 'hotcodepush.json'), json: true },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ReportedFailureError);

    expect(
      (harness.readJson() as DoctorResult).checks.find(
        ({ check }) => check === 'ios-resource-file',
      ),
    ).toEqual({
      check: 'ios-resource-file',
      manualStep:
        'log in or set HOTCODEPUSH_TOKEN, leave HOTCODEPUSH_OFFLINE unset, then run npx cap sync, which runs binary create',
      message:
        'ios/App/App/hotcodepush.json names no channel, so the build takes no updates: it was made offline or without a token',
      status: 'failed',
    });
  });

  function listPublicKey(directoryPath: string): void {
    const configPath = join(directoryPath, 'hotcodepush.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        ...(JSON.parse(readFileSync(configPath, 'utf8')) as object),
        publicKeys: [SIGNING_KEY.publicKey],
      }),
    );
  }

  async function readSigningKeyCheck(
    directoryPath: string,
  ): Promise<DoctorResult['checks'][number] | undefined> {
    try {
      await doctorCommand.action(
        { config: join(directoryPath, 'hotcodepush.json'), json: true },
        undefined,
      );
    } catch (error) {
      // a failed check ends the command through the reported failure, after its JSON
      if (!(error instanceof ReportedFailureError)) {
        throw error;
      }
    }
    return (harness.readJson() as DoctorResult).checks.find(
      ({ check }) => check === 'signing-key',
    );
  }

  it('should name the key uploads are signed with when its private half is at hand', async () => {
    const directoryPath = await writeSetUpProject();
    listPublicKey(directoryPath);
    vi.stubEnv('HOTCODEPUSH_SIGNING_KEY', SIGNING_PRIVATE_KEY);
    respondWithSessionAndApp();

    expect(await readSigningKeyCheck(directoryPath)).toEqual({
      check: 'signing-key',
      message: `uploads are signed with key ${SIGNING_KEY.fingerprint}`,
      status: 'ok',
    });
  });

  it('should skip the signing key when the configuration lists a key and this machine holds no private half', async () => {
    const directoryPath = await writeSetUpProject();
    listPublicKey(directoryPath);
    respondWithSessionAndApp();

    expect(await readSigningKeyCheck(directoryPath)).toEqual({
      check: 'signing-key',
      message:
        'code signing is on; no private key on this machine, so uploads run where HOTCODEPUSH_SIGNING_KEY is set',
      status: 'skipped',
    });
  });

  it('should fail the signing key when the app has one and the configuration lists none', async () => {
    const directoryPath = await writeSetUpProject();
    respondWithSessionAndApp();
    harness.routes[`GET /v1/apps/${DEMO_APP.id}`] = () =>
      Response.json({ ...DEMO_APP, hasSigningKey: true });

    expect(await readSigningKeyCheck(directoryPath)).toEqual({
      check: 'signing-key',
      manualStep:
        'run hotcodepush signing-key list --json and add each publicKey to publicKeys in hotcodepush.json',
      message: 'the app has a signing key and hotcodepush.json lists none',
      status: 'failed',
    });
  });

  it('should accept HOTCODEPUSH_TOKEN as an API token, the credential CI and agents hold', async () => {
    const directoryPath = await writeSetUpProject();
    respondWithSessionAndApp();
    harness.routes['GET /v1/users/me'] = () =>
      Response.json({ ...RUNNER_USER, credential: 'token' });

    await doctorCommand.action(
      { config: join(directoryPath, 'hotcodepush.json'), json: true },
      undefined,
    );

    const result = harness.readJson() as DoctorResult;
    expect(result.status).toBe('clean');
    expect(result.checks.slice(1, 3)).toEqual([
      {
        check: 'session',
        message:
          'authenticated with HOTCODEPUSH_TOKEN as Anna Example (anna@example.com)',
        status: 'ok',
      },
      { check: 'app', message: 'app Demo, channel production', status: 'ok' },
    ]);
  });

  it('should fail the configuration on a channel that is no channel name', async () => {
    const directoryPath = await writeSetUpProject();
    writeFileSync(
      join(directoryPath, 'hotcodepush.json'),
      JSON.stringify({
        appId: DEMO_APP.id,
        channel: 'pre release',
        dir: 'www',
      }),
    );
    respondWithSessionAndApp();

    await expect(
      doctorCommand.action(
        { config: join(directoryPath, 'hotcodepush.json'), json: true },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ReportedFailureError);

    expect((harness.readJson() as DoctorResult).checks[0]).toEqual({
      check: 'configuration',
      manualStep: 'run hotcodepush init',
      message: 'hotcodepush.json has a channel that is no channel name',
      status: 'failed',
    });
  });

  it('should fail the app check when the app has no channel of the configured name', async () => {
    const directoryPath = await writeSetUpProject();
    writeFileSync(
      join(directoryPath, 'hotcodepush.json'),
      JSON.stringify({ appId: DEMO_APP.id, channel: 'beta', dir: 'www' }),
    );
    respondWithSessionAndApp();

    await expect(
      doctorCommand.action(
        { config: join(directoryPath, 'hotcodepush.json'), json: true },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ReportedFailureError);

    expect((harness.readJson() as DoctorResult).checks[2]).toEqual({
      check: 'app',
      manualStep: 'run hotcodepush init',
      message:
        'the API does not know the app or the channel: hotcodepush.json: no channel is named "beta"',
      status: 'failed',
    });
  });

  it('should skip the API checks without a session and fail on a missing configuration', async () => {
    vi.stubEnv('HOTCODEPUSH_TOKEN', '');
    const directoryPath = await writeSetUpProject();
    rmSync(join(directoryPath, 'hotcodepush.json'));
    vi.spyOn(process, 'cwd').mockReturnValue(directoryPath);
    harness.routes['GET /health'] = () => Response.json({ status: 'ok' });

    await expect(
      doctorCommand.action({ json: true }, undefined),
    ).rejects.toBeInstanceOf(ReportedFailureError);

    const result = harness.readJson() as DoctorResult;
    expect(result.checks.slice(0, 2)).toEqual([
      {
        check: 'configuration',
        manualStep: 'run hotcodepush init',
        message: `no hotcodepush.json up from ${directoryPath}`,
        status: 'failed',
      },
      {
        check: 'session',
        message: 'not logged in; the app is not checked against the API',
        status: 'skipped',
      },
    ]);
  });

  it('should check a wired React Native project: no dir to name, the phase and the Gradle line, both apps, and no resource file to read', async () => {
    const directoryPath = writeReactNativeProject({
      isPackageInstalled: true,
      projectConfig: { appId: DEMO_APP.id, channel: PRODUCTION_CHANNEL.name },
    });
    directoryPaths.push(directoryPath);
    writeInstalledSdk(directoryPath);
    await (
      await reactNativeFramework.resolveWiring(
        {
          directoryPath,
          packageJson: {
            dependencies: {
              '@hotcodepush/react-native-code-push': '0.1.0',
            },
          },
        },
        { yes: true },
      )
    ).wireBinaryCreateStep(undefined);
    respondWithSessionAndApp();

    await doctorCommand.action(
      { config: join(directoryPath, 'hotcodepush.json'), json: true },
      undefined,
    );

    const result = harness.readJson() as DoctorResult;
    expect(result.status).toBe('clean');
    expect(result.checks[0]?.message).toBe(
      `hotcodepush.json names app ${DEMO_APP.id} and channel production`,
    );
    expect(
      result.checks.map(({ check, status }) => `${check}:${status}`),
    ).toEqual([
      'configuration:ok',
      'session:ok',
      'app:ok',
      'package:ok',
      'hook:ok',
      'host:ok',
      'android-resource-file:skipped',
      'ios-resource-file:skipped',
      'hosts:ok',
      'signing-key:skipped',
      'versions:ok',
    ]);
  });
});
