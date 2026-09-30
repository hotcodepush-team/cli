import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeCapacitorProject } from '../../test/capacitor-project.js';
import { useCommandHarness } from '../../test/command-harness.js';
import {
  DEMO_APP,
  PRODUCTION_CHANNEL,
  RUNNER_USER,
} from '../../test/fixtures.js';
import { ReportedFailureError } from '../utils/errors.js';
import { addResourceReference } from '../utils/xcode-project.js';
import doctorCommand from './doctor.js';

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
      hookScript: 'npx hotcodepush bundle embed',
      isPackageInstalled: true,
      projectConfig: {
        appId: DEMO_APP.id,
        channelId: PRODUCTION_CHANNEL.id,
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
        bundleId: 'embedded',
        createdAt: '2026-09-29T12:00:00.000Z',
        deltas: [],
        files: [],
        pack: null,
        patches: [],
        version: '1.0',
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
      `✓ configuration          hotcodepush.json names app ${DEMO_APP.id} and channel ${PRODUCTION_CHANNEL.id}, web build at www`,
      '✓ session                logged in as Anna Example (anna@example.com)',
      '✓ app                    app Demo, channel production',
      '✗ package                @hotcodepush/capacitor-live-updates is not in package.json',
      '                         run hotcodepush init',
      '✗ hook                   capacitor:copy:after does not run the embed step',
      '                         run hotcodepush init',
      '✓ ios-project            the app target copies hotcodepush.json into the bundle',
      '✗ android-resource-file  no resource file at android/app/src/main/assets/hotcodepush.json',
      '                         run npx cap sync, which runs the embed hook',
      '✓ ios-resource-file      ios/App/App/hotcodepush.json built at 2026-09-29T12:00:00.000Z',
      '✗ hosts                  unreachable: api (https://api.example.com/health)',
      '                         check the network, the API URL in config.json and the HOTCODEPUSH_*_BASE_URL variables',
      '– signing-key            code signing arrives with milestone 3',
      expect.stringMatching(/^✓ versions +hotcodepush /),
    ]);
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
});
