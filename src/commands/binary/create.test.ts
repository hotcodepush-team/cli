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
import type { LockedPackage } from '@hotcodepush/protocol/fingerprint';
import { computeFingerprint } from '@hotcodepush/protocol/fingerprint';
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
import {
  writeCordovaProject,
  writeNativeGlue,
} from '../../../test/cordova-project.js';
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
      }),
    );
    writeFileSync(
      join(projectDirectoryPath, 'capacitor.config.json'),
      JSON.stringify({ appId: 'com.example.demo', webDir: 'dist' }),
    );
    mkdirSync(join(projectDirectoryPath, 'dist'));
    writeFileSync(join(projectDirectoryPath, 'dist', 'index.html'), INDEX_HTML);
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

  /**
   * What the native build passes in: the platform, its identity and where the resource file goes in the app it builds.
   */
  function resolveBuildOptions(platform: 'android' | 'ios') {
    return {
      binaryBuild: '1',
      binaryVersion: '1.0',
      resourceFilePath: join(
        projectDirectoryPath,
        'build',
        platform,
        'hotcodepush.json',
      ),
      platform,
    };
  }

  function readResourceFile(relativePath: string): unknown {
    return JSON.parse(
      readFileSync(join(projectDirectoryPath, relativePath), 'utf8'),
    );
  }

  it('should create the binary under the identity passed in, uploading what the app lacks, and write the resource file where --resource-file-path names with its bundle', async () => {
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
        ...resolveBuildOptions('ios'),
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
    const resourceFile = readResourceFile('build/ios/hotcodepush.json');
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
      `Wrote ${join(projectDirectoryPath, 'build', 'ios', 'hotcodepush.json')} for ios.`,
      `Created the binary ios 1.0 (1): 1 files uploaded, ${uploadedByteCount} B.`,
    ]);
  });

  it("should hash a Cordova platform's www without the native glue it carries, with the identity and the place its native build passes in", async () => {
    const cordovaDirectoryPath = writeCordovaProject({
      isPluginInstalled: true,
      projectConfig: {
        appId: DEMO_APP.id,
        channel: PRODUCTION_CHANNEL.name,
      },
    });
    onTestFinished(() => {
      rmSync(cordovaDirectoryPath, { force: true, recursive: true });
    });
    writeNativeGlue(join(cordovaDirectoryPath, 'www'));
    const outFilePath = join(
      createTemporaryDirectory('hotcodepush-out-'),
      'hotcodepush.json',
    );
    harness.routes[`POST ${BINARIES_PATH}`] = () =>
      Response.json(BINARY, { status: 201 });

    await binaryCreateCommand.action(
      {
        binaryBuild: '20401',
        binaryVersion: '2.4.1',
        config: join(cordovaDirectoryPath, 'hotcodepush.json'),
        embeddedBundlePath: join(cordovaDirectoryPath, 'www'),
        resourceFilePath: outFilePath,
        platform: 'android',
      },
      undefined,
    );

    const createRequest = harness.requests.find(
      ({ method, url }) => method === 'POST' && url.endsWith('/binaries'),
    );
    expect(await createRequest?.json()).toMatchObject({
      build: '20401',
      files: [{ path: 'index.html', sha256: INDEX_SHA256, sizeBytes: 11 }],
      version: '2.4.1',
      platform: 'android',
    });
    expect(
      ConfigurationSchema.parse(JSON.parse(readFileSync(outFilePath, 'utf8')))
        .embeddedBundleManifest,
    ).toMatchObject({
      bundleVersion: '2.4.1',
      files: [{ path: 'index.html', sha256: INDEX_SHA256, sizeBytes: 11 }],
    });
  });

  it('should fail the build naming hotcodepush.json when the app has no channel of its name, before writing or creating anything', async () => {
    const configPath = join(projectDirectoryPath, 'hotcodepush.json');
    writeFileSync(
      configPath,
      JSON.stringify({ appId: DEMO_APP.id, channel: 'beta' }),
    );

    await expect(
      binaryCreateCommand.action(
        { ...resolveBuildOptions('ios'), config: configPath },
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
        join(projectDirectoryPath, 'build', 'ios', 'hotcodepush.json'),
      ),
    ).toBe(false);
  });

  it('should fail the build with E_FINGERPRINT_UNAVAILABLE when the project has no lockfile, before writing or creating anything', async () => {
    rmSync(join(projectDirectoryPath, 'package-lock.json'));

    await expect(
      binaryCreateCommand.action(
        {
          config: join(projectDirectoryPath, 'hotcodepush.json'),
          ...resolveBuildOptions('ios'),
        },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'E_FINGERPRINT_UNAVAILABLE' });
    expect(harness.requests.filter(({ method }) => method === 'POST')).toEqual(
      [],
    );
    expect(
      existsSync(
        join(projectDirectoryPath, 'build', 'ios', 'hotcodepush.json'),
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
        ...resolveBuildOptions('ios'),
      },
      undefined,
    );

    expect(readResourceFile('build/ios/hotcodepush.json')).toMatchObject({
      channelId: STAGING_CHANNEL.id,
    });
  });

  it('should print the binary and where the resource file went with --json', async () => {
    harness.routes[`POST ${BINARIES_PATH}`] = () =>
      Response.json({ ...BINARY, platform: 'android' });
    const buildOptions = resolveBuildOptions('android');

    await binaryCreateCommand.action(
      {
        ...buildOptions,
        config: join(projectDirectoryPath, 'hotcodepush.json'),
        json: true,
      },
      undefined,
    );

    expect(existsSync(buildOptions.resourceFilePath)).toBe(true);
    expect(harness.readJson()).toEqual({
      binary: { ...BINARY, platform: 'android' },
      resourceFilePath: buildOptions.resourceFilePath,
      uploadedBytes: 0,
      uploadedFileCount: 0,
    });
  });

  it('should name --binary-build when the build passes the version alone', async () => {
    await expect(
      binaryCreateCommand.action(
        {
          ...resolveBuildOptions('ios'),
          binaryBuild: undefined,
          config: join(projectDirectoryPath, 'hotcodepush.json'),
        },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--binary-build'));
  });

  describe('when the build does not reach the API', () => {
    const NO_CHANNEL_TEXT =
      'it names no channel and takes no updates until it is built with a token, and no binary was created';

    function writeChannelById(): string {
      const configPath = join(projectDirectoryPath, 'hotcodepush.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          appId: DEMO_APP.id,
          channel: PRODUCTION_CHANNEL.id,
        }),
      );
      return configPath;
    }

    async function createIosBinary(configPath?: string): Promise<void> {
      await binaryCreateCommand.action(
        {
          config: configPath ?? join(projectDirectoryPath, 'hotcodepush.json'),
          ...resolveBuildOptions('ios'),
        },
        undefined,
      );
    }

    it('should write the resource file without a channel and ask the API nothing under HOTCODEPUSH_OFFLINE, also in CI', async () => {
      vi.stubEnv('HOTCODEPUSH_OFFLINE', '1');
      vi.stubEnv('CI', 'true');

      await createIosBinary();

      expect(harness.requests).toEqual([]);
      expect(readResourceFile('build/ios/hotcodepush.json')).toMatchObject({
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
          publicKeys: [SIGNING_KEY.publicKey],
        }),
      );

      await createIosBinary(configPath);
      await binaryCreateCommand.action(
        { ...resolveBuildOptions('android'), config: configPath },
        undefined,
      );

      const spkiDer = SIGNING_KEY.publicKey.slice('rsa-v1_5-sha256:'.length);
      const [iosPublicKey] = ConfigurationSchema.parse(
        readResourceFile('build/ios/hotcodepush.json'),
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
          readResourceFile('build/android/hotcodepush.json'),
        ).publicKeys,
      ).toEqual([{ der: spkiDer, keyId: SIGNING_KEY.fingerprint }]);
    });

    it('should keep a channel given by id under HOTCODEPUSH_OFFLINE', async () => {
      vi.stubEnv('HOTCODEPUSH_OFFLINE', '1');

      await createIosBinary(writeChannelById());

      expect(harness.requests).toEqual([]);
      expect(readResourceFile('build/ios/hotcodepush.json')).toMatchObject({
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
      expect(readResourceFile('build/ios/hotcodepush.json')).toMatchObject({
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
          join(projectDirectoryPath, 'build', 'ios', 'hotcodepush.json'),
        ),
      ).toBe(false);
    });

    it('should write the resource file without a channel and create no binary when the API refuses to resolve the name, and fail only in CI', async () => {
      harness.routes[`GET ${CHANNELS_PATH}`] = () =>
        respondWithApiError(403, 'E_FORBIDDEN', 'You are not a member.');

      await createIosBinary();

      expect(readResourceFile('build/ios/hotcodepush.json')).toMatchObject({
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
      expect(readResourceFile('build/ios/hotcodepush.json')).toMatchObject({
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
        ...resolveBuildOptions('ios'),
      },
      undefined,
    );

    expect(readResourceFile('build/ios/hotcodepush.json')).toMatchObject({
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
          ...resolveBuildOptions('ios'),
        },
        undefined,
      ),
    ).rejects.toThrow('fetch failed');
  });

  it('should warn and create no binary when it conflicts locally, and fail with the conflict in CI', async () => {
    harness.routes[`POST ${BINARIES_PATH}`] = () =>
      respondWithApiError(
        409,
        'E_BINARY_CONFLICT',
        'A binary with this version and build carries another fingerprint.',
      );
    const options = {
      ...resolveBuildOptions('ios'),
      binaryBuild: '57',
      binaryVersion: '2.4.1',
      config: join(projectDirectoryPath, 'hotcodepush.json'),
    };

    await binaryCreateCommand.action(options, undefined);
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('E_BINARY_CONFLICT'),
    );
    expect(readResourceFile('build/ios/hotcodepush.json')).toMatchObject({
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
    const REACT_NATIVE_PACKAGE: LockedPackage = {
      integrity: 'sha512-reactnative0821invented==',
      name: 'react-native',
      version: '0.82.1',
    };
    const REACT_NATIVE_FINGERPRINT = computeFingerprint({
      extraFingerprintPaths: [],
      packages: [REACT_NATIVE_PACKAGE],
    });

    let appDirectoryPath = '';

    beforeEach(() => {
      const dependencies = { 'react-native': REACT_NATIVE_PACKAGE.version };
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
              integrity: REACT_NATIVE_PACKAGE.integrity,
              version: REACT_NATIVE_PACKAGE.version,
            },
          },
        }),
      );
      mkdirSync(join(projectDirectoryPath, 'node_modules', 'react-native'));
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
      options: {
        binaryVersion?: string;
        json?: boolean;
        resourceFilePath?: string;
      } = {},
    ): Promise<void> {
      await binaryCreateCommand.action(
        {
          binaryBuild: '57',
          binaryVersion: '2.4.1',
          config: join(projectDirectoryPath, 'hotcodepush.json'),
          embeddedBundlePath: appDirectoryPath,
          resourceFilePath: join(appDirectoryPath, 'hotcodepush.json'),
          platform: 'ios',
          ...options,
        },
        undefined,
      );
    }

    it('should hash the JavaScript and its assets out of the app, with the identity the build passes in, into the place --resource-file-path names', async () => {
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
        fingerprint: REACT_NATIVE_FINGERPRINT,
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

    describe('when the build bundled no JavaScript', () => {
      function readAppResourceFile(): unknown {
        return ConfigurationSchema.parse(
          readResourceFile('build/Demo.app/hotcodepush.json'),
        );
      }

      it('should write the resource file without an embedded bundle or the channel it names by name, and ask the API nothing', async () => {
        await createBinary();

        expect(harness.requests).toEqual([]);
        expect(readAppResourceFile()).toMatchObject({
          appId: DEMO_APP.id,
          builtAt: expect.any(String),
          channelId: null,
          embeddedBundleId: null,
          embeddedBundleManifest: null,
          fingerprint: REACT_NATIVE_FINGERPRINT,
        });
        expect(stderrWrite.mock.calls).toEqual([
          [
            `No binary created: the ios build bundled no JavaScript, as a debug build served by the development server does. Wrote ${join(appDirectoryPath, 'hotcodepush.json')} without an embedded bundle: live updates are off in this build.\n`,
          ],
        ]);
      });

      it('should name the channel in it when the project names it by id', async () => {
        writeFileSync(
          join(projectDirectoryPath, 'hotcodepush.json'),
          JSON.stringify({
            appId: DEMO_APP.id,
            channel: PRODUCTION_CHANNEL.id,
          }),
        );

        await createBinary();

        expect(harness.requests).toEqual([]);
        expect(readAppResourceFile()).toMatchObject({
          channelId: PRODUCTION_CHANNEL.id,
          embeddedBundleManifest: null,
        });
      });

      it('should write it without a token when CI is set', async () => {
        stubNoToken();
        vi.stubEnv('CI', 'true');

        await createBinary();

        expect(harness.requests).toEqual([]);
        expect(readAppResourceFile()).toMatchObject({
          embeddedBundleManifest: null,
        });
      });

      it('should print the binary as null with --json', async () => {
        await createBinary({ json: true });

        expect(harness.readJson()).toEqual({
          binary: null,
          resourceFilePath: join(appDirectoryPath, 'hotcodepush.json'),
          uploadedBytes: 0,
          uploadedFileCount: 0,
        });
      });
    });

    it('should name --resource-file-path when the build does not say where the resource file goes', async () => {
      writeBundledJavaScript();

      await expect(
        createBinary({ resourceFilePath: undefined }),
      ).rejects.toThrow(new MissingParameterError('--resource-file-path'));
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
 * No token anywhere: none in the environment, and a config home of the test's own.
 */
function stubNoToken(): void {
  const configHomePath = createTemporaryDirectory('hotcodepush-nohome-');
  vi.stubEnv('APPDATA', configHomePath);
  vi.stubEnv('HOTCODEPUSH_TOKEN', undefined);
  vi.stubEnv('XDG_CONFIG_HOME', configHomePath);
}

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
