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
  writeFingerprintInputs,
} from '../../../test/capacitor-project.js';
import {
  respondWithApiError,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { writeCordovaProject } from '../../../test/cordova-project.js';
import {
  BINARY,
  DEMO_APP,
  PRODUCTION_CHANNEL,
  SIGNING_KEY,
  STAGING_CHANNEL,
} from '../../../test/fixtures.js';
import {
  CHANNELS_PATH,
  respondWithChannels,
} from '../../../test/release-routes.js';
import { MissingParameterError } from '../../utils/errors.js';
import binaryCreateCommand from './create.js';

// the not-logged-in case must not find a token in the machine's keyring
vi.mock('@napi-rs/keyring', () => ({
  Entry: vi.fn(function () {
    return { getPassword: () => null };
  }),
}));

const BINARIES_PATH = `/v1/apps/${DEMO_APP.id}/binaries`;
const INDEX_HTML = '<h1>v1</h1>';
const INDEX_SHA256 = createHash('sha256').update(INDEX_HTML).digest('hex');

describe('binary create', () => {
  const harness = useCommandHarness();
  let projectDirectoryPath = '';
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    projectDirectoryPath = mkdtempSync(
      join(tmpdir(), 'hotcodepush-binary-create-'),
    );
    writeFileSync(
      join(projectDirectoryPath, 'package.json'),
      JSON.stringify({
        dependencies: { '@capacitor/core': '8.0.0' },
        name: 'demo',
        version: '1.0.0',
      }),
    );
    writeFileSync(
      join(projectDirectoryPath, 'hotcodepush.json'),
      JSON.stringify({
        appId: DEMO_APP.id,
        channel: PRODUCTION_CHANNEL.name,
        dir: 'dist',
      }),
    );
    writeFileSync(
      join(projectDirectoryPath, 'capacitor.config.json'),
      JSON.stringify({ appId: 'com.example.demo', webDir: 'dist' }),
    );
    mkdirSync(join(projectDirectoryPath, 'dist'));
    writeFileSync(join(projectDirectoryPath, 'dist', 'index.html'), INDEX_HTML);
    mkdirSync(join(projectDirectoryPath, 'ios', 'App', 'App.xcodeproj'), {
      recursive: true,
    });
    writeFileSync(
      join(
        projectDirectoryPath,
        'ios',
        'App',
        'App.xcodeproj',
        'project.pbxproj',
      ),
      'CURRENT_PROJECT_VERSION = 1;\nMARKETING_VERSION = 1.0;\n',
    );
    mkdirSync(join(projectDirectoryPath, 'android', 'app'), {
      recursive: true,
    });
    writeFileSync(
      join(projectDirectoryPath, 'android', 'app', 'build.gradle'),
      'versionCode 1\nversionName "1.0"\n',
    );
    writeFingerprintInputs(projectDirectoryPath);
    stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    respondWithChannels(harness);
  });

  afterEach(() => {
    rmSync(projectDirectoryPath, { force: true, recursive: true });
    vi.unstubAllEnvs();
  });

  function readResourceFile(relativePath: string): unknown {
    return JSON.parse(
      readFileSync(join(projectDirectoryPath, relativePath), 'utf8'),
    );
  }

  it('should write the resource file into the iOS project and register the binary, uploading what the app lacks', async () => {
    let createCount = 0;
    harness.routes[`POST ${BINARIES_PATH}`] = () => {
      createCount += 1;
      return createCount === 1
        ? respondWithApiError(
            409,
            'E_UPLOAD_INCOMPLETE',
            'Objects are missing.',
          )
        : Response.json(BINARY, { status: 201 });
    };
    harness.routes[`POST ${BINARIES_PATH}`] = () => {
      createCount += 1;
      if (createCount === 1) {
        return Response.json(
          {
            code: 'E_UPLOAD_INCOMPLETE',
            details: { isPackMissing: false, missingSha256s: [INDEX_SHA256] },
            message: 'Objects are missing.',
          },
          { status: 409 },
        );
      }
      return Response.json(BINARY, { status: 201 });
    };
    let uploadedByteCount = 0;
    harness.routes[`PUT /v1/apps/${DEMO_APP.id}/files/${INDEX_SHA256}`] =
      async request => {
        // the gzip stream differs by platform, so the count printed is read back from the upload
        uploadedByteCount = (await request.arrayBuffer()).byteLength;
        return Response.json(
          {
            appId: DEMO_APP.id,
            createdAt: BINARY.createdAt,
            sha256: INDEX_SHA256,
            sizeBytes: 31,
          },
          { status: 201 },
        );
      };

    await binaryCreateCommand.action(
      {
        config: join(projectDirectoryPath, 'hotcodepush.json'),
        platform: 'ios',
      },
      undefined,
    );

    const createRequests = harness.requests.filter(
      ({ method, url }) => method === 'POST' && url.endsWith('/binaries'),
    );
    expect(createRequests).toHaveLength(2);
    expect(await createRequests[0]?.json()).toEqual({
      build: '1',
      version: '1.0',
      files: [{ path: 'index.html', sha256: INDEX_SHA256, sizeBytes: 11 }],
      fingerprint: CAPACITOR_FINGERPRINT,
      force: false,
      platform: 'ios',
    });
    const resourceFile = readResourceFile('ios/App/App/hotcodepush.json');
    expect(ConfigurationSchema.parse(resourceFile)).toMatchObject({
      appId: DEMO_APP.id,
      channelId: PRODUCTION_CHANNEL.id,
      embeddedBundleId: BINARY.bundleId,
      embeddedBundleManifest: {
        appId: DEMO_APP.id,
        bundleVersion: '1.0',
        files: [{ path: 'index.html', sha256: INDEX_SHA256, sizeBytes: 11 }],
        fingerprint: CAPACITOR_FINGERPRINT,
        keyId: null,
        platforms: ['ios'],
      },
      filesBaseUrl: 'https://api.example.com/files',
      fingerprint: CAPACITOR_FINGERPRINT,
      updatesBaseUrl: 'https://api.example.com/updates',
    });
    expect(harness.readLines()).toEqual([
      `Wrote ${join(projectDirectoryPath, 'ios', 'App', 'App', 'hotcodepush.json')} for ios.`,
      `Registered the binary ios 1.0 (1): 1 files uploaded, ${uploadedByteCount} B.`,
    ]);
  });

  it("should write a Cordova project's resource file beside the platform's web assets, with the identity config.xml gives the store build", async () => {
    const cordovaDirectoryPath = writeCordovaProject({
      isPluginInstalled: true,
      projectConfig: {
        appId: DEMO_APP.id,
        channel: PRODUCTION_CHANNEL.name,
        dir: 'www',
      },
    });
    harness.routes[`POST ${BINARIES_PATH}`] = () =>
      Response.json(BINARY, { status: 201 });

    try {
      await binaryCreateCommand.action(
        {
          config: join(cordovaDirectoryPath, 'hotcodepush.json'),
          platform: 'android',
        },
        undefined,
      );

      const createRequest = harness.requests.find(
        ({ method, url }) => method === 'POST' && url.endsWith('/binaries'),
      );
      expect(await createRequest?.json()).toMatchObject({
        build: '20401',
        version: '2.4.1',
        platform: 'android',
      });
      const resourceFile = ConfigurationSchema.parse(
        JSON.parse(
          readFileSync(
            join(
              cordovaDirectoryPath,
              'platforms/android/app/src/main/assets/www/hotcodepush.json',
            ),
            'utf8',
          ),
        ),
      );
      expect(resourceFile.embeddedBundleManifest.bundleVersion).toBe('2.4.1');
      expect(resourceFile.embeddedBundleManifest.files).toEqual([
        { path: 'index.html', sha256: INDEX_SHA256, sizeBytes: 11 },
      ]);
    } finally {
      rmSync(cordovaDirectoryPath, { force: true, recursive: true });
    }
  });

  it('should do nothing when the hook runs for the web platform, before any configuration check', async () => {
    vi.stubEnv('CAPACITOR_PLATFORM_NAME', 'web');
    rmSync(join(projectDirectoryPath, 'hotcodepush.json'));
    vi.spyOn(process, 'cwd').mockReturnValue(projectDirectoryPath);

    await binaryCreateCommand.action({}, undefined);

    expect(harness.requests).toEqual([]);
    expect(harness.readLines()).toEqual([]);
    expect(
      existsSync(
        join(projectDirectoryPath, 'ios', 'App', 'App', 'hotcodepush.json'),
      ),
    ).toBe(false);
  });

  it('should fail the build naming hotcodepush.json when the app has no channel of its name, before writing or registering anything', async () => {
    const configPath = join(projectDirectoryPath, 'hotcodepush.json');
    writeFileSync(
      configPath,
      JSON.stringify({ appId: DEMO_APP.id, channel: 'beta', dir: 'dist' }),
    );

    await expect(
      binaryCreateCommand.action(
        { config: configPath, platform: 'ios' },
        undefined,
      ),
    ).rejects.toMatchObject({
      code: 'E_INVALID_PARAMETER',
      message: 'hotcodepush.json: no channel is named "beta"',
    });
    expect(harness.requests.filter(({ method }) => method === 'POST')).toEqual(
      [],
    );
    expect(
      existsSync(
        join(projectDirectoryPath, 'ios', 'App', 'App', 'hotcodepush.json'),
      ),
    ).toBe(false);
  });

  it('should fail the build with E_FINGERPRINT_UNAVAILABLE when the project has no lockfile, before writing or registering anything', async () => {
    rmSync(join(projectDirectoryPath, 'package-lock.json'));

    await expect(
      binaryCreateCommand.action(
        {
          config: join(projectDirectoryPath, 'hotcodepush.json'),
          platform: 'ios',
        },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'E_FINGERPRINT_UNAVAILABLE' });
    expect(harness.requests.filter(({ method }) => method === 'POST')).toEqual(
      [],
    );
    expect(
      existsSync(
        join(projectDirectoryPath, 'ios', 'App', 'App', 'hotcodepush.json'),
      ),
    ).toBe(false);
  });

  it('should follow the channel HOTCODEPUSH_CHANNEL names over the configured one, a build flavour', async () => {
    vi.stubEnv('HOTCODEPUSH_CHANNEL', STAGING_CHANNEL.name);
    harness.routes[`POST ${BINARIES_PATH}`] = () =>
      Response.json(BINARY, { status: 201 });

    await binaryCreateCommand.action(
      {
        config: join(projectDirectoryPath, 'hotcodepush.json'),
        platform: 'ios',
      },
      undefined,
    );

    expect(readResourceFile('ios/App/App/hotcodepush.json')).toMatchObject({
      channelId: STAGING_CHANNEL.id,
    });
  });

  it('should take the platform from CAPACITOR_PLATFORM_NAME and the identity from the Gradle file, printing JSON', async () => {
    vi.stubEnv('CAPACITOR_PLATFORM_NAME', 'android');
    harness.routes[`POST ${BINARIES_PATH}`] = () =>
      Response.json({ ...BINARY, platform: 'android' });

    await binaryCreateCommand.action(
      { config: join(projectDirectoryPath, 'hotcodepush.json'), json: true },
      undefined,
    );

    expect(
      existsSync(
        join(
          projectDirectoryPath,
          'android',
          'app',
          'src',
          'main',
          'assets',
          'hotcodepush.json',
        ),
      ),
    ).toBe(true);
    expect(harness.readJson()).toEqual({
      binary: { ...BINARY, platform: 'android' },
      resourceFilePath: join(
        projectDirectoryPath,
        'android',
        'app',
        'src',
        'main',
        'assets',
        'hotcodepush.json',
      ),
      uploadedBytes: 0,
      uploadedFileCount: 0,
    });
  });

  it('should write to an absolute --out as given, the path a native build passes in', async () => {
    const outDirectoryPath = createTemporaryDirectory('hotcodepush-out-');
    const outFilePath = join(outDirectoryPath, 'hotcodepush.json');
    harness.routes[`POST ${BINARIES_PATH}`] = () =>
      Response.json(BINARY, { status: 201 });

    await binaryCreateCommand.action(
      {
        config: join(projectDirectoryPath, 'hotcodepush.json'),
        json: true,
        out: outFilePath,
        platform: 'ios',
      },
      undefined,
    );

    expect(existsSync(outFilePath)).toBe(true);
    expect(harness.readJson()).toMatchObject({ resourceFilePath: outFilePath });
  });

  describe('when the build does not reach the API', () => {
    const NO_CHANNEL_TEXT =
      'it names no channel and takes no updates until it is built with a token, and no binary was created';

    function stubNoToken(): void {
      vi.stubEnv('HOTCODEPUSH_TOKEN', undefined);
      vi.stubEnv(
        'XDG_CONFIG_HOME',
        createTemporaryDirectory('hotcodepush-nohome-'),
      );
    }

    function writeChannelById(): string {
      const configPath = join(projectDirectoryPath, 'hotcodepush.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          appId: DEMO_APP.id,
          channel: PRODUCTION_CHANNEL.id,
          dir: 'dist',
        }),
      );
      return configPath;
    }

    async function createIosBinary(configPath?: string): Promise<void> {
      await binaryCreateCommand.action(
        {
          config: configPath ?? join(projectDirectoryPath, 'hotcodepush.json'),
          platform: 'ios',
        },
        undefined,
      );
    }

    it('should write the resource file without a channel and ask the API nothing under HOTCODEPUSH_OFFLINE, also in CI', async () => {
      vi.stubEnv('HOTCODEPUSH_OFFLINE', '1');
      vi.stubEnv('CI', 'true');

      await createIosBinary();

      expect(harness.requests).toEqual([]);
      expect(readResourceFile('ios/App/App/hotcodepush.json')).toMatchObject({
        channelId: null,
        embeddedBundleId: null,
        fingerprint: CAPACITOR_FINGERPRINT,
      });
      expect(stderrWrite.mock.calls).toEqual([
        [
          `Warning: HOTCODEPUSH_OFFLINE is set, so the build was made offline: ${NO_CHANNEL_TEXT}.\n`,
        ],
      ]);
    });

    it('should write the listed public keys for the platform it builds, PKCS #1 on iOS and SPKI on Android, each with its key id', async () => {
      vi.stubEnv('HOTCODEPUSH_OFFLINE', '1');
      const configPath = join(projectDirectoryPath, 'hotcodepush.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          appId: DEMO_APP.id,
          dir: 'dist',
          publicKeys: [SIGNING_KEY.publicKey],
        }),
      );

      await createIosBinary(configPath);
      await binaryCreateCommand.action(
        { config: configPath, platform: 'android' },
        undefined,
      );

      const spkiDer = SIGNING_KEY.publicKey.slice('rsa-v1_5-sha256:'.length);
      const [iosPublicKey] = ConfigurationSchema.parse(
        readResourceFile('ios/App/App/hotcodepush.json'),
      ).publicKeys;
      expect(iosPublicKey?.keyId).toBe(SIGNING_KEY.fingerprint);
      // PKCS #1 is the key inside the SPKI wrapper: shorter, and the tail of the same bytes
      expect(Buffer.from(spkiDer, 'base64').subarray(-64).toString('hex')).toBe(
        Buffer.from(iosPublicKey?.der ?? '', 'base64')
          .subarray(-64)
          .toString('hex'),
      );
      expect(iosPublicKey?.der).not.toBe(spkiDer);
      expect(
        ConfigurationSchema.parse(
          readResourceFile('android/app/src/main/assets/hotcodepush.json'),
        ).publicKeys,
      ).toEqual([{ der: spkiDer, keyId: SIGNING_KEY.fingerprint }]);
    });

    it('should keep a channel given by id under HOTCODEPUSH_OFFLINE', async () => {
      vi.stubEnv('HOTCODEPUSH_OFFLINE', '1');

      await createIosBinary(writeChannelById());

      expect(harness.requests).toEqual([]);
      expect(readResourceFile('ios/App/App/hotcodepush.json')).toMatchObject({
        channelId: PRODUCTION_CHANNEL.id,
      });
      expect(stderrWrite).toHaveBeenCalledWith(
        'Warning: HOTCODEPUSH_OFFLINE is set, so the build was made offline and no binary was created.\n',
      );
    });

    it('should write the same resource file when not logged in locally, the warning naming the login and HOTCODEPUSH_TOKEN', async () => {
      stubNoToken();

      await createIosBinary();

      expect(harness.requests).toEqual([]);
      expect(readResourceFile('ios/App/App/hotcodepush.json')).toMatchObject({
        channelId: null,
        embeddedBundleId: null,
      });
      expect(stderrWrite.mock.calls).toEqual([
        [
          `Warning: not logged in, so the build was made offline: ${NO_CHANNEL_TEXT}; run "hotcodepush login" or set HOTCODEPUSH_TOKEN.\n`,
        ],
      ]);
    });

    it('should fail with E_NOT_LOGGED_IN in CI without a token, naming HOTCODEPUSH_TOKEN and HOTCODEPUSH_OFFLINE, before writing anything', async () => {
      stubNoToken();
      vi.stubEnv('CI', 'true');

      await expect(createIosBinary(writeChannelById())).rejects.toMatchObject({
        code: 'E_NOT_LOGGED_IN',
        exitCode: 3,
        fix: 'set HOTCODEPUSH_TOKEN in the pipeline, or HOTCODEPUSH_OFFLINE=1 for a build that is never shipped.',
      });
      expect(
        existsSync(
          join(projectDirectoryPath, 'ios', 'App', 'App', 'hotcodepush.json'),
        ),
      ).toBe(false);
    });

    it('should write the resource file without a channel and create no binary when the API refuses to resolve the name, and fail only in CI', async () => {
      harness.routes[`GET ${CHANNELS_PATH}`] = () =>
        respondWithApiError(403, 'E_FORBIDDEN', 'You are not a member.');

      await createIosBinary();

      expect(readResourceFile('ios/App/App/hotcodepush.json')).toMatchObject({
        channelId: null,
        embeddedBundleId: null,
      });
      expect(stderrWrite.mock.calls).toEqual([
        [
          'Warning: the channel could not be resolved, so the build names none and takes no updates, and no binary was created: E_FORBIDDEN You are not a member.\n',
        ],
      ]);
      expect(
        harness.requests.filter(({ method }) => method === 'POST'),
      ).toEqual([]);

      vi.stubEnv('CI', 'true');
      await expect(createIosBinary()).rejects.toMatchObject({
        code: 'E_FORBIDDEN',
      });
    });

    it('should take a channel given by id without asking the API for it', async () => {
      harness.routes[`POST ${BINARIES_PATH}`] = () =>
        Response.json(BINARY, { status: 201 });

      await createIosBinary(writeChannelById());

      expect(
        harness.requests.filter(
          ({ url }) => new URL(url).pathname === CHANNELS_PATH,
        ),
      ).toEqual([]);
      expect(readResourceFile('ios/App/App/hotcodepush.json')).toMatchObject({
        channelId: PRODUCTION_CHANNEL.id,
        embeddedBundleId: BINARY.bundleId,
      });
    });
  });

  it('should still write the resource file and warn when creating the binary fails, and fail only in CI', async () => {
    harness.routes[`POST ${BINARIES_PATH}`] = () => {
      throw new TypeError('fetch failed');
    };

    await binaryCreateCommand.action(
      {
        config: join(projectDirectoryPath, 'hotcodepush.json'),
        platform: 'ios',
      },
      undefined,
    );

    expect(readResourceFile('ios/App/App/hotcodepush.json')).toMatchObject({
      channelId: PRODUCTION_CHANNEL.id,
      embeddedBundleId: null,
    });
    expect(stderrWrite).toHaveBeenCalledWith(
      'Warning: the binary was not created: fetch failed\n',
    );

    vi.stubEnv('CI', 'true');
    await expect(
      binaryCreateCommand.action(
        {
          config: join(projectDirectoryPath, 'hotcodepush.json'),
          platform: 'ios',
        },
        undefined,
      ),
    ).rejects.toThrow('fetch failed');
  });

  it('should warn and skip a conflicting registration locally, and fail with it in CI', async () => {
    harness.routes[`POST ${BINARIES_PATH}`] = () =>
      respondWithApiError(
        409,
        'E_BINARY_CONFLICT',
        'The build is registered with another fingerprint.',
      );
    const options = {
      binaryBuild: '57',
      binaryVersion: '2.4.1',
      config: join(projectDirectoryPath, 'hotcodepush.json'),
      platform: 'ios' as const,
    };

    await binaryCreateCommand.action(options, undefined);
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('E_BINARY_CONFLICT'),
    );
    expect(readResourceFile('ios/App/App/hotcodepush.json')).toMatchObject({
      embeddedBundleId: null,
      embeddedBundleManifest: { bundleVersion: '2.4.1' },
    });

    vi.stubEnv('CI', 'true');
    await expect(
      binaryCreateCommand.action(options, undefined),
    ).rejects.toMatchObject({
      code: 'E_BINARY_CONFLICT',
    });
  });

  describe('in a React Native build', () => {
    const BUNDLE = 'bytecode';
    const BUNDLE_SHA256 = createHash('sha256').update(BUNDLE).digest('hex');
    const LOGO = 'png';
    const LOGO_SHA256 = createHash('sha256').update(LOGO).digest('hex');

    let appDirectoryPath = '';

    beforeEach(() => {
      writeFileSync(
        join(projectDirectoryPath, 'package.json'),
        JSON.stringify({
          dependencies: { 'react-native': '0.82.1' },
          name: 'demo',
          version: '1.0.0',
        }),
      );
      writeFileSync(
        join(projectDirectoryPath, 'hotcodepush.json'),
        JSON.stringify({
          appId: DEMO_APP.id,
          channel: PRODUCTION_CHANNEL.name,
        }),
      );
      rmSync(join(projectDirectoryPath, 'capacitor.config.json'));
      appDirectoryPath = join(projectDirectoryPath, 'build', 'Demo.app');
      mkdirSync(join(appDirectoryPath, 'assets'), { recursive: true });
      writeFileSync(join(appDirectoryPath, 'Info.plist'), '<plist />');
      harness.routes[`POST ${BINARIES_PATH}`] = () =>
        Response.json(BINARY, { status: 201 });
    });

    function writeBundledJavaScript(): void {
      writeFileSync(join(appDirectoryPath, 'main.jsbundle'), BUNDLE);
      writeFileSync(join(appDirectoryPath, 'assets', 'logo.png'), LOGO);
    }

    async function createBinary(
      options: { binaryVersion?: string; out?: string } = {},
    ): Promise<void> {
      await binaryCreateCommand.action(
        {
          binaryBuild: '57',
          binaryVersion: '2.4.1',
          config: join(projectDirectoryPath, 'hotcodepush.json'),
          out: join(appDirectoryPath, 'hotcodepush.json'),
          path: appDirectoryPath,
          platform: 'ios',
          ...options,
        },
        undefined,
      );
    }

    it('should hash the JavaScript and its assets out of the app, with the identity the build passes in, into the place --out names', async () => {
      writeBundledJavaScript();

      await createBinary();

      const files = [
        { path: 'assets/logo.png', sha256: LOGO_SHA256, sizeBytes: 3 },
        { path: 'main.jsbundle', sha256: BUNDLE_SHA256, sizeBytes: 8 },
      ];
      const createRequest = harness.requests.find(
        ({ method, url }) => method === 'POST' && url.endsWith('/binaries'),
      );
      expect(await createRequest?.json()).toEqual({
        build: '57',
        version: '2.4.1',
        files,
        fingerprint: CAPACITOR_FINGERPRINT,
        force: false,
        platform: 'ios',
      });
      expect(
        ConfigurationSchema.parse(
          readResourceFile('build/Demo.app/hotcodepush.json'),
        ),
      ).toMatchObject({
        appId: DEMO_APP.id,
        channelId: PRODUCTION_CHANNEL.id,
        embeddedBundleId: BINARY.bundleId,
        embeddedBundleManifest: { bundleVersion: '2.4.1', files },
      });
    });

    it('should create nothing and ask the API nothing when the build bundled no JavaScript', async () => {
      await createBinary();

      expect(harness.requests).toEqual([]);
      expect(existsSync(join(appDirectoryPath, 'hotcodepush.json'))).toBe(
        false,
      );
      expect(stderrWrite).toHaveBeenCalledWith(
        'No binary created: the ios build bundled no JavaScript, as a debug build served by the development server does.\n',
      );
    });

    it('should name --out when the build does not say where the resource file goes', async () => {
      writeBundledJavaScript();

      await expect(createBinary({ out: undefined })).rejects.toThrow(
        new MissingParameterError('--out'),
      );
      expect(
        harness.requests.filter(({ method }) => method === 'POST'),
      ).toEqual([]);
    });

    it('should name --binary-version when the build does not pass its identity in', async () => {
      writeBundledJavaScript();

      await expect(createBinary({ binaryVersion: undefined })).rejects.toThrow(
        new MissingParameterError('--binary-version'),
      );
    });
  });
});

/**
 * A temporary directory of the running test's own, removed when the test finishes however it finishes.
 */
function createTemporaryDirectory(prefix: string): string {
  const directoryPath = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });
  return directoryPath;
}
