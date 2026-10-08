import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeCapacitorProject } from '../../test/capacitor-project.js';
import { useCommandHarness } from '../../test/command-harness.js';
import { writeCordovaProject } from '../../test/cordova-project.js';
import {
  DEMO_APP,
  PRODUCTION_CHANNEL,
  resolveProtocolSigningKey,
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
import { resolveConfigDirectoryPath } from '../utils/user-config.js';
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
      'binary:skipped',
      'hosts:ok',
      'signing-key:skipped',
      'versions:ok',
    ]);
    expect(result.checks.at(-1)?.message).toMatch(
      /^hotcodepush \d+\.\d+\.\d+, node v\d+.*, @capacitor\/core 8\.0\.0, @hotcodepush\/capacitor-live-updates 8\.0\.0$/,
    );
  });

  it('should say a build creates its binary when CI is set', async () => {
    vi.stubEnv('CI', 'true');
    const directoryPath = await writeSetUpProject();
    respondWithSessionAndApp();

    await doctorCommand.action(
      { config: join(directoryPath, 'hotcodepush.json'), json: true },
      undefined,
    );

    expect(
      (harness.readJson() as DoctorResult).checks.find(
        ({ check }) => check === 'binary',
      ),
    ).toEqual({
      check: 'binary',
      message: 'CI is set, so a build creates its binary',
      status: 'ok',
    });
  });

  it('should say a build creates no binary when HOTCODEPUSH_OFFLINE is set, also in CI', async () => {
    vi.stubEnv('CI', 'true');
    vi.stubEnv('HOTCODEPUSH_OFFLINE', '1');
    const directoryPath = await writeSetUpProject();
    respondWithSessionAndApp();

    await doctorCommand.action(
      { config: join(directoryPath, 'hotcodepush.json'), json: true },
      undefined,
    );

    expect(
      (harness.readJson() as DoctorResult).checks.find(
        ({ check }) => check === 'binary',
      ),
    ).toEqual({
      check: 'binary',
      message:
        'HOTCODEPUSH_OFFLINE is set, so a build asks the API nothing and creates no binary',
      status: 'skipped',
    });
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
        .slice(3, 8)
        .map(({ check, status }) => `${check}:${status}`),
    ).toEqual([
      'package:ok',
      'hook:ok',
      'android-file-mode:ok',
      'android-resource-file:failed',
      'ios-resource-file:skipped',
    ]);
    expect(result.checks[6]?.manualStep).toBe(
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
      `✗ android-resource-file  no resource file at ${join('android', 'app', 'src', 'main', 'assets', 'hotcodepush.json')}`,
      '                         run npx cap sync, which runs binary create',
      `✓ ios-resource-file      ${join('ios', 'App', 'App', 'hotcodepush.json')} built at 2026-09-29T12:00:00.000Z`,
      '– binary                 a local build creates no binary; a build under CI or with binary create --register creates one',
      '✗ hosts                  unreachable: api (https://api.example.com/health)',
      '                         check the network, the API URL in config.json and the HOTCODEPUSH_*_BASE_URL variables',
      '– signing-key            code signing is off; signing-key create turns it on',
      expect.stringMatching(/^✓ versions +hotcodepush /),
    ]);
  });

  it('should fail the session and still reach every check when the API cannot be reached', async () => {
    const directoryPath = await writeSetUpProject();
    for (const route of ['GET /v1/users/me', 'GET /health']) {
      harness.routes[route] = () => {
        throw new TypeError('fetch failed');
      };
    }

    await expect(
      doctorCommand.action(
        { config: join(directoryPath, 'hotcodepush.json'), json: true },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ReportedFailureError);

    const result = harness.readJson() as DoctorResult;
    expect(result.status).toBe('failed');
    expect(result.checks.map(({ check }) => check)).toEqual([
      'configuration',
      'session',
      'package',
      'hook',
      'ios-project',
      'android-resource-file',
      'ios-resource-file',
      'binary',
      'hosts',
      'signing-key',
      'versions',
    ]);
    expect(result.checks[1]).toEqual({
      check: 'session',
      manualStep:
        'run the command again with --verbose, and report it at https://github.com/hotcodepush-team/cli/issues if it persists.',
      message: 'the credential cannot be checked: fetch failed',
      status: 'failed',
    });
    expect(result.checks[8]?.status).toBe('failed');
  });

  it('should fail the configuration when hotcodepush.json does not parse, and still run every other check', async () => {
    const directoryPath = await writeSetUpProject();
    const configPath = join(directoryPath, 'hotcodepush.json');
    writeFileSync(configPath, '{ "appId": ');
    respondWithSessionAndApp();

    await expect(
      doctorCommand.action({ config: configPath, json: true }, undefined),
    ).rejects.toBeInstanceOf(ReportedFailureError);

    const result = harness.readJson() as DoctorResult;
    expect(result.checks[0]).toEqual({
      check: 'configuration',
      manualStep: 'correct the JSON in that file and run the command again.',
      message: `${configPath} is no valid JSON: unexpected end of JSON input`,
      status: 'failed',
    });
    expect(result.checks.map(({ check }) => check)).toEqual([
      'configuration',
      'session',
      'app',
      'package',
      'hook',
      'ios-project',
      'android-resource-file',
      'ios-resource-file',
      'binary',
      'hosts',
      'signing-key',
      'versions',
    ]);
  });

  it('should fail the framework when package.json does not parse', async () => {
    const directoryPath = await writeSetUpProject();
    const packageJsonPath = join(directoryPath, 'package.json');
    writeFileSync(packageJsonPath, '{ "dependencies": ');
    respondWithSessionAndApp();

    await expect(
      doctorCommand.action(
        { config: join(directoryPath, 'hotcodepush.json'), json: true },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ReportedFailureError);

    const result = harness.readJson() as DoctorResult;
    expect(result.checks.find(({ check }) => check === 'framework')).toEqual({
      check: 'framework',
      manualStep: 'correct the JSON in that file and run the command again.',
      message: `${packageJsonPath} is no valid JSON: unexpected end of JSON input`,
      status: 'failed',
    });
  });

  it('should fail the session and the hosts when config.json does not parse', async () => {
    const directoryPath = await writeSetUpProject();
    const userConfigPath = join(resolveConfigDirectoryPath(), 'config.json');
    writeFileSync(userConfigPath, '{ "apiUrl": ');

    await expect(
      doctorCommand.action(
        { config: join(directoryPath, 'hotcodepush.json'), json: true },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ReportedFailureError);

    const result = harness.readJson() as DoctorResult;
    const invalidJsonMessage = `${userConfigPath} is no valid JSON: unexpected end of JSON input`;
    expect(result.checks.filter(({ status }) => status === 'failed')).toEqual([
      {
        check: 'session',
        manualStep: 'correct the JSON in that file and run the command again.',
        message: `the credential cannot be checked: ${invalidJsonMessage}`,
        status: 'failed',
      },
      {
        check: 'hosts',
        manualStep: 'correct the JSON in that file and run the command again.',
        message: invalidJsonMessage,
        status: 'failed',
      },
    ]);
  });

  it('should fail a resource file that does not parse with where its parse stopped, and still run every other check', async () => {
    const directoryPath = await writeSetUpProject();
    const resourceFilePath = join(
      directoryPath,
      'android',
      'app',
      'src',
      'main',
      'assets',
      'hotcodepush.json',
    );
    writeFileSync(resourceFilePath, '{ "appId": ');
    respondWithSessionAndApp();

    await expect(
      doctorCommand.action(
        { config: join(directoryPath, 'hotcodepush.json'), json: true },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ReportedFailureError);

    const result = harness.readJson() as DoctorResult;
    expect(result.checks.filter(({ status }) => status === 'failed')).toEqual([
      {
        check: 'android-resource-file',
        manualStep: 'run npx cap sync, which runs binary create',
        message: `${resourceFilePath} is no valid JSON: unexpected end of JSON input`,
        status: 'failed',
      },
    ]);
    expect(result.checks.at(-1)?.check).toBe('versions');
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
      message: `${join('ios', 'App', 'App', 'hotcodepush.json')} names no channel, so the build takes no updates: it was made offline or without a token`,
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

  function respondWithSigningKeys(signingKeys: object[]): void {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/signing-keys`] = () =>
      Response.json(signingKeys);
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

  it('should name the key HOTCODEPUSH_SIGNING_KEY signs with when it belongs to a registered listed key', async () => {
    const directoryPath = await writeSetUpProject();
    listPublicKey(directoryPath);
    vi.stubEnv('HOTCODEPUSH_SIGNING_KEY', SIGNING_PRIVATE_KEY);
    respondWithSessionAndApp();
    respondWithSigningKeys([SIGNING_KEY]);

    expect(await readSigningKeyCheck(directoryPath)).toEqual({
      check: 'signing-key',
      message: `HOTCODEPUSH_SIGNING_KEY signs with key ${SIGNING_KEY.fingerprint}`,
      status: 'ok',
    });
  });

  it('should pass the signing key without HOTCODEPUSH_SIGNING_KEY when the listed keys are registered, looking for no file', async () => {
    const directoryPath = await writeSetUpProject();
    listPublicKey(directoryPath);
    respondWithSessionAndApp();
    respondWithSigningKeys([SIGNING_KEY]);

    expect(await readSigningKeyCheck(directoryPath)).toEqual({
      check: 'signing-key',
      message:
        'code signing is on; an upload signs with --private-key-path or HOTCODEPUSH_SIGNING_KEY',
      status: 'ok',
    });
  });

  it('should fail the signing key when HOTCODEPUSH_SIGNING_KEY belongs to no listed key', async () => {
    const directoryPath = await writeSetUpProject();
    listPublicKey(directoryPath);
    vi.stubEnv(
      'HOTCODEPUSH_SIGNING_KEY',
      resolveProtocolSigningKey('rsa-4096-b').privateKey,
    );
    respondWithSessionAndApp();
    respondWithSigningKeys([SIGNING_KEY]);

    expect(await readSigningKeyCheck(directoryPath)).toEqual({
      check: 'signing-key',
      manualStep:
        'give the private key of a public key hotcodepush.json lists; "hotcodepush signing-key create" makes a new pair.',
      message:
        'HOTCODEPUSH_SIGNING_KEY: the private key belongs to no public key hotcodepush.json lists',
      status: 'failed',
    });
  });

  it('should fail the signing key when the configuration lists a key the app has not registered', async () => {
    const directoryPath = await writeSetUpProject();
    listPublicKey(directoryPath);
    respondWithSessionAndApp();
    respondWithSigningKeys([]);

    expect(await readSigningKeyCheck(directoryPath)).toEqual({
      check: 'signing-key',
      manualStep:
        'run hotcodepush signing-key list --json and keep in publicKeys only the keys it prints',
      message: 'hotcodepush.json lists 1 public key the app has not registered',
      status: 'failed',
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
      'binary:skipped',
      'hosts:ok',
      'signing-key:skipped',
      'versions:ok',
    ]);
  });
});
