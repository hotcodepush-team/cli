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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAPACITOR_FINGERPRINT,
  writeFingerprintInputs,
} from '../../../test/capacitor-project.js';
import {
  respondWithApiError,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  DEMO_APP,
  EMBEDDED_BUNDLE,
  PRODUCTION_CHANNEL,
  STAGING_CHANNEL,
} from '../../../test/fixtures.js';
import { respondWithChannels } from '../../../test/release-routes.js';
import bundleEmbedCommand from './embed.js';

// the not-logged-in case must not find a token in the machine's keyring
vi.mock('@napi-rs/keyring', () => ({
  Entry: vi.fn(function () {
    return { getPassword: () => null };
  }),
}));

const EMBEDDED_BUNDLES_PATH = `/v1/apps/${DEMO_APP.id}/embedded-bundles`;
const INDEX_HTML = '<h1>v1</h1>';
const INDEX_SHA256 = createHash('sha256').update(INDEX_HTML).digest('hex');

describe('bundle embed', () => {
  const harness = useCommandHarness();
  let projectDirectoryPath = '';
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    projectDirectoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-embed-'));
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

  it('should write the resource file into the iOS project and register the embedded bundle, uploading what the app lacks', async () => {
    let createCount = 0;
    harness.routes[`POST ${EMBEDDED_BUNDLES_PATH}`] = () => {
      createCount += 1;
      return createCount === 1
        ? respondWithApiError(
            409,
            'E_UPLOAD_INCOMPLETE',
            'Objects are missing.',
          )
        : Response.json(EMBEDDED_BUNDLE, { status: 201 });
    };
    harness.routes[`POST ${EMBEDDED_BUNDLES_PATH}`] = () => {
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
      return Response.json(EMBEDDED_BUNDLE, { status: 201 });
    };
    let uploadedByteCount = 0;
    harness.routes[`PUT /v1/apps/${DEMO_APP.id}/files/${INDEX_SHA256}`] =
      async request => {
        // the gzip stream differs by platform, so the count printed is read back from the upload
        uploadedByteCount = (await request.arrayBuffer()).byteLength;
        return Response.json(
          {
            appId: DEMO_APP.id,
            createdAt: EMBEDDED_BUNDLE.createdAt,
            sha256: INDEX_SHA256,
            sizeBytes: 31,
          },
          { status: 201 },
        );
      };

    await bundleEmbedCommand.action(
      {
        config: join(projectDirectoryPath, 'hotcodepush.json'),
        platform: 'ios',
      },
      undefined,
    );

    const createRequests = harness.requests.filter(
      ({ method, url }) =>
        method === 'POST' && url.endsWith('/embedded-bundles'),
    );
    expect(createRequests).toHaveLength(2);
    expect(await createRequests[0]?.json()).toEqual({
      binaryBuild: '1',
      binaryVersion: '1.0',
      files: [{ path: 'index.html', sha256: INDEX_SHA256, sizeBytes: 11 }],
      fingerprint: CAPACITOR_FINGERPRINT,
      force: false,
      platform: 'ios',
    });
    const resourceFile = readResourceFile('ios/App/App/hotcodepush.json');
    expect(ConfigurationSchema.parse(resourceFile)).toMatchObject({
      appId: DEMO_APP.id,
      channelId: PRODUCTION_CHANNEL.id,
      embeddedBundleId: EMBEDDED_BUNDLE.bundleId,
      embeddedBundleManifest: {
        bundleId: EMBEDDED_BUNDLE.bundleId,
        version: '1.0',
      },
      filesBaseUrl: 'https://api.example.com/files',
      fingerprint: CAPACITOR_FINGERPRINT,
      updatesBaseUrl: 'https://api.example.com/updates',
    });
    expect(harness.readLines()).toEqual([
      `Wrote ${join(projectDirectoryPath, 'ios', 'App', 'App', 'hotcodepush.json')} for ios.`,
      `Registered the embedded bundle of ios 1.0 (1): 1 files uploaded, ${uploadedByteCount} B.`,
    ]);
  });

  it('should do nothing when the hook runs for the web platform', async () => {
    vi.stubEnv('CAPACITOR_PLATFORM_NAME', 'web');

    await bundleEmbedCommand.action(
      { config: join(projectDirectoryPath, 'hotcodepush.json') },
      undefined,
    );

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
      bundleEmbedCommand.action(
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
      bundleEmbedCommand.action(
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
    harness.routes[`POST ${EMBEDDED_BUNDLES_PATH}`] = () =>
      Response.json(EMBEDDED_BUNDLE, { status: 201 });

    await bundleEmbedCommand.action(
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
    harness.routes[`POST ${EMBEDDED_BUNDLES_PATH}`] = () =>
      Response.json({ ...EMBEDDED_BUNDLE, platform: 'android' });

    await bundleEmbedCommand.action(
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
      embeddedBundle: { ...EMBEDDED_BUNDLE, platform: 'android' },
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
    const outDirectoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-out-'));
    const outFilePath = join(outDirectoryPath, 'hotcodepush.json');
    harness.routes[`POST ${EMBEDDED_BUNDLES_PATH}`] = () =>
      Response.json(EMBEDDED_BUNDLE, { status: 201 });

    await bundleEmbedCommand.action(
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
    rmSync(outDirectoryPath, { force: true, recursive: true });
  });

  it('should still write the resource file and warn when not logged in and hotcodepush.json still names the channel by id', async () => {
    vi.stubEnv('HOTCODEPUSH_TOKEN', undefined);
    vi.stubEnv(
      'XDG_CONFIG_HOME',
      mkdtempSync(join(tmpdir(), 'hotcodepush-nohome-')),
    );
    const configPath = join(projectDirectoryPath, 'hotcodepush.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        appId: DEMO_APP.id,
        channelId: PRODUCTION_CHANNEL.id,
        dir: 'dist',
      }),
    );

    await bundleEmbedCommand.action(
      { config: configPath, platform: 'ios' },
      undefined,
    );

    expect(harness.requests).toEqual([]);
    expect(readResourceFile('ios/App/App/hotcodepush.json')).toMatchObject({
      channelId: PRODUCTION_CHANNEL.id,
      embeddedBundleId: null,
      embeddedBundleManifest: { bundleId: 'embedded' },
    });
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('Warning: not logged in'),
    );
  });

  it('should fail with E_NOT_LOGGED_IN when not logged in and the channel is a name only the API resolves', async () => {
    vi.stubEnv('HOTCODEPUSH_TOKEN', undefined);
    vi.stubEnv(
      'XDG_CONFIG_HOME',
      mkdtempSync(join(tmpdir(), 'hotcodepush-nohome-')),
    );

    await expect(
      bundleEmbedCommand.action(
        {
          config: join(projectDirectoryPath, 'hotcodepush.json'),
          platform: 'ios',
        },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'E_NOT_LOGGED_IN' });
    expect(
      existsSync(
        join(projectDirectoryPath, 'ios', 'App', 'App', 'hotcodepush.json'),
      ),
    ).toBe(false);
  });

  it('should still write the resource file and warn when the API is unreachable, and fail only in CI', async () => {
    harness.routes[`POST ${EMBEDDED_BUNDLES_PATH}`] = () => {
      throw new TypeError('fetch failed');
    };

    await bundleEmbedCommand.action(
      {
        config: join(projectDirectoryPath, 'hotcodepush.json'),
        platform: 'ios',
      },
      undefined,
    );

    expect(readResourceFile('ios/App/App/hotcodepush.json')).toMatchObject({
      embeddedBundleId: null,
    });
    expect(stderrWrite).toHaveBeenCalledWith(
      'Warning: the embedded bundle was not registered: fetch failed\n',
    );

    vi.stubEnv('CI', 'true');
    await expect(
      bundleEmbedCommand.action(
        {
          config: join(projectDirectoryPath, 'hotcodepush.json'),
          platform: 'ios',
        },
        undefined,
      ),
    ).rejects.toThrow('fetch failed');
  });

  it('should warn and skip a conflicting registration locally, and fail with it in CI', async () => {
    harness.routes[`POST ${EMBEDDED_BUNDLES_PATH}`] = () =>
      respondWithApiError(
        409,
        'E_EMBED_CONFLICT',
        'The build is registered with another fingerprint.',
      );
    const options = {
      binaryBuild: '57',
      binaryVersion: '2.4.1',
      config: join(projectDirectoryPath, 'hotcodepush.json'),
      platform: 'ios' as const,
    };

    await bundleEmbedCommand.action(options, undefined);
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('E_EMBED_CONFLICT'),
    );
    expect(readResourceFile('ios/App/App/hotcodepush.json')).toMatchObject({
      embeddedBundleId: null,
      embeddedBundleManifest: { version: '2.4.1' },
    });

    vi.stubEnv('CI', 'true');
    await expect(
      bundleEmbedCommand.action(options, undefined),
    ).rejects.toMatchObject({
      code: 'E_EMBED_CONFLICT',
    });
  });
});
