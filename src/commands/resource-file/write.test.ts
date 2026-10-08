import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigurationSchema } from '@hotcodepush/protocol';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';
import {
  CAPACITOR_FINGERPRINT,
  writeCapacitorProject,
  writeFingerprintInputs,
} from '../../../test/capacitor-project.js';
import {
  respondWithApiError,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { DEMO_APP, PRODUCTION_CHANNEL } from '../../../test/fixtures.js';
import {
  CHANNELS_PATH,
  respondWithChannels,
} from '../../../test/release-routes.js';
import { MissingParameterError } from '../../utils/errors.js';
import resourceFileWriteCommand from './write.js';

// the not-logged-in case must not find a token in the machine's keyring
vi.mock('@napi-rs/keyring', () => ({
  Entry: vi.fn(function () {
    return { getPassword: () => null };
  }),
}));

const INDEX_HTML = '<h1>v1</h1>';
const INDEX_SHA256 = createHash('sha256').update(INDEX_HTML).digest('hex');

describe('resource-file write', () => {
  const harness = useCommandHarness();
  let projectDirectoryPath = '';
  let resourceFilePath = '';
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    projectDirectoryPath = writeCapacitorProject({
      projectConfig: {
        appId: DEMO_APP.id,
        channel: PRODUCTION_CHANNEL.name,
      },
    });
    writeFingerprintInputs(projectDirectoryPath);
    resourceFilePath = join(projectDirectoryPath, 'build', 'hotcodepush.json');
    stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    respondWithChannels(harness);
  });

  afterEach(() => {
    rmSync(projectDirectoryPath, { force: true, recursive: true });
    vi.unstubAllEnvs();
  });

  async function writeIosResourceFile(
    options: { json?: boolean; resourceFilePath?: string } = {},
  ): Promise<void> {
    await resourceFileWriteCommand.action(
      {
        config: join(projectDirectoryPath, 'hotcodepush.json'),
        platform: 'ios',
        resourceFilePath,
        ...options,
      },
      undefined,
    );
  }

  function readResourceFile() {
    return ConfigurationSchema.parse(
      JSON.parse(readFileSync(resourceFilePath, 'utf8')),
    );
  }

  function writeChannelById(): void {
    writeFileSync(
      join(projectDirectoryPath, 'hotcodepush.json'),
      JSON.stringify({
        appId: DEMO_APP.id,
        channel: PRODUCTION_CHANNEL.id,
      }),
    );
  }

  it('should write the embedded bundle and the resolved channel without a bundle id, creating no binary', async () => {
    await writeIosResourceFile();

    expect(harness.requests.filter(({ method }) => method === 'POST')).toEqual(
      [],
    );
    expect(readResourceFile()).toMatchObject({
      appId: DEMO_APP.id,
      channelId: PRODUCTION_CHANNEL.id,
      embeddedBundleId: null,
      embeddedBundleManifest: {
        bundleVersion: '',
        files: [{ path: 'index.html', sha256: INDEX_SHA256, sizeBytes: 11 }],
        fingerprint: CAPACITOR_FINGERPRINT,
        platforms: ['ios'],
      },
      fingerprint: CAPACITOR_FINGERPRINT,
    });
    expect(harness.readLines()).toEqual([`Wrote ${resourceFilePath} for ios.`]);
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('should print where the resource file went with --json', async () => {
    await writeIosResourceFile({ json: true });

    expect(harness.readJson()).toEqual({ resourceFilePath });
  });

  it('should take a channel given by id without asking the API, offline too', async () => {
    writeChannelById();
    vi.stubEnv('HOTCODEPUSH_OFFLINE', '1');

    await writeIosResourceFile();

    expect(harness.requests).toEqual([]);
    expect(readResourceFile().channelId).toBe(PRODUCTION_CHANNEL.id);
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('should leave the channel name unresolved with one warning and ask the API nothing under HOTCODEPUSH_OFFLINE, in CI too', async () => {
    vi.stubEnv('HOTCODEPUSH_OFFLINE', '1');
    vi.stubEnv('CI', 'true');

    await writeIosResourceFile();

    expect(harness.requests).toEqual([]);
    expect(readResourceFile()).toMatchObject({
      channelId: null,
      embeddedBundleId: null,
    });
    expect(stderrWrite.mock.calls).toEqual([
      [
        'Warning: HOTCODEPUSH_OFFLINE is set, so the channel name was not resolved: the build names no channel and takes no updates.\n',
      ],
    ]);
  });

  it('should leave the channel name unresolved with one warning naming the login when not logged in, in CI too', async () => {
    stubNoToken();
    vi.stubEnv('CI', 'true');

    await writeIosResourceFile();

    expect(harness.requests).toEqual([]);
    expect(readResourceFile().channelId).toBeNull();
    expect(stderrWrite.mock.calls).toEqual([
      [
        'Warning: not logged in, so the channel name was not resolved: the build names no channel and takes no updates; run "hotcodepush login" or set HOTCODEPUSH_TOKEN.\n',
      ],
    ]);
  });

  it('should leave the channel name unresolved with one warning when the API refuses, in CI too', async () => {
    vi.stubEnv('CI', 'true');
    harness.routes[`GET ${CHANNELS_PATH}`] = () =>
      respondWithApiError(403, 'E_FORBIDDEN', 'You are not a member.');

    await writeIosResourceFile();

    expect(readResourceFile().channelId).toBeNull();
    expect(stderrWrite.mock.calls).toEqual([
      [
        'Warning: the channel could not be resolved, so the build names none and takes no updates: E_FORBIDDEN You are not a member.\n',
      ],
    ]);
  });

  it('should fail naming hotcodepush.json when the app has no channel of its name, before writing anything', async () => {
    writeFileSync(
      join(projectDirectoryPath, 'hotcodepush.json'),
      JSON.stringify({ appId: DEMO_APP.id, channel: 'beta' }),
    );

    await expect(writeIosResourceFile()).rejects.toMatchObject({
      code: 'E_INVALID_PARAMETER',
      message: 'hotcodepush.json: no channel is named "beta"',
    });
    expect(existsSync(resourceFilePath)).toBe(false);
  });

  it('should name --resource-file-path when the build does not say where the resource file goes', async () => {
    await expect(
      writeIosResourceFile({ resourceFilePath: undefined }),
    ).rejects.toThrow(new MissingParameterError('--resource-file-path'));
  });

  it('should write the file without an embedded bundle, asking the API nothing, when the build bundled no JavaScript', async () => {
    rewriteAsReactNativeProject();
    const appDirectoryPath = join(projectDirectoryPath, 'build', 'Demo.app');
    mkdirSync(appDirectoryPath, { recursive: true });

    await resourceFileWriteCommand.action(
      {
        config: join(projectDirectoryPath, 'hotcodepush.json'),
        embeddedBundlePath: appDirectoryPath,
        platform: 'ios',
        resourceFilePath,
      },
      undefined,
    );

    expect(harness.requests).toEqual([]);
    expect(readResourceFile()).toMatchObject({
      channelId: null,
      embeddedBundleManifest: null,
    });
    expect(stderrWrite.mock.calls).toEqual([
      [
        `The ios build bundled no JavaScript, as a debug build served by the development server does. Wrote ${resourceFilePath} without an embedded bundle: live updates are off in this build.\n`,
      ],
    ]);
  });

  /**
   * The project as a React Native one with the lockfile and the installed package the fingerprint reads.
   */
  function rewriteAsReactNativeProject(): void {
    const dependencies = { 'react-native': '0.82.1' };
    writeFileSync(
      join(projectDirectoryPath, 'package.json'),
      JSON.stringify({ dependencies, name: 'demo', version: '1.0.0' }),
    );
    writeFileSync(
      join(projectDirectoryPath, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { dependencies },
          'node_modules/react-native': {
            integrity: 'sha512-reactnative0821invented==',
            version: '0.82.1',
          },
        },
      }),
    );
    mkdirSync(join(projectDirectoryPath, 'node_modules', 'react-native'), {
      recursive: true,
    });
    rmSync(join(projectDirectoryPath, 'capacitor.config.json'));
  }
});

/**
 * No token anywhere: none in the environment, and a config home of the test's own.
 */
function stubNoToken(): void {
  const configHomePath = mkdtempSync(join(tmpdir(), 'hotcodepush-nohome-'));
  onTestFinished(() => {
    rmSync(configHomePath, { force: true, recursive: true });
  });
  vi.stubEnv('APPDATA', configHomePath);
  vi.stubEnv('HOTCODEPUSH_TOKEN', undefined);
  vi.stubEnv('XDG_CONFIG_HOME', configHomePath);
}
