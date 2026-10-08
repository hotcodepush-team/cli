import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { text } from '@clack/prompts';
import {
  readPack,
  stringifyCanonicalJson,
  verifyManifestSignature,
} from '@hotcodepush/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAPACITOR_FINGERPRINT,
  writeFingerprintInputs,
} from '../../../test/capacitor-project.js';
import {
  API_URL,
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { writeNativeGlue } from '../../../test/cordova-project.js';
import {
  BINARY,
  DEMO_APP,
  PREVIOUS_BUNDLE,
  READY_BUNDLE,
  SIGNING_KEY,
  SIGNING_PRIVATE_KEY,
} from '../../../test/fixtures.js';
import { PACKAGE_JSON } from '../../config/consts.js';
import { createApiClient } from '../../utils/api-client.js';
import { applyBsdiffPatch } from '../../utils/bsdiff.js';
import { runCli } from '../../utils/cli.js';
import {
  InvalidParameterError,
  SigningKeyUnavailableError,
  UnknownFrameworkError,
} from '../../utils/errors.js';
import type * as packageManagerModule from '../../utils/package-manager.js';
import { runCommandLineVisibly } from '../../utils/package-manager.js';
import { writeSigningPrivateKeyFile } from '../../utils/signing-private-key.js';
import bundleUploadCommand, { resolveUploadBundleOptions } from './upload.js';

vi.mock('@clack/prompts');
vi.mock('../../utils/package-manager.js', async importOriginal => ({
  ...(await importOriginal<typeof packageManagerModule>()),
  runCommandLineVisibly: vi.fn(),
}));

const BUNDLES_PATH = `/v1/apps/${DEMO_APP.id}/bundles`;

const BINARIES_PATH = `/v1/apps/${DEMO_APP.id}/binaries`;

const INDEX_HTML = '<h1>v1</h1>';
const APP_JS = 'console.log(1)';
const INDEX_SHA256 = computeSha256(INDEX_HTML);
const APP_JS_SHA256 = computeSha256(APP_JS);

/**
 * A pack's entries as their names, `{hash}` or `patches/{from}/{to}`, with their bodies.
 */
async function readPackEntries(
  packBytes: ArrayBuffer,
): Promise<Map<string, Buffer>> {
  const entries = new Map<string, Buffer>();
  for await (const entry of readPack(
    new Blob([packBytes]).stream() as ReadableStream<Uint8Array>,
  )) {
    const body = Buffer.from(await new Response(entry.body).arrayBuffer());
    entries.set(
      entry.type === 'file'
        ? entry.sha256
        : `patches/${entry.fromSha256}/${entry.toSha256}`,
      body,
    );
  }
  return entries;
}

function computeSha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('bundle upload', () => {
  const harness = useCommandHarness();
  let projectDirectoryPath = '';
  let uploadedFileBytes: Promise<ArrayBuffer> | undefined;
  let uploadedDeltaPacks = new Map<string, Promise<ArrayBuffer>>();

  beforeEach(() => {
    uploadedDeltaPacks = new Map();
    projectDirectoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-project-'));
    writeProject({ '@capacitor/core': '8.0.0' });
    writeFingerprintInputs(projectDirectoryPath);
  });

  afterEach(() => {
    rmSync(projectDirectoryPath, { force: true, recursive: true });
  });

  function writeProject(dependencies: Record<string, string>): string {
    writeFileSync(
      join(projectDirectoryPath, 'package.json'),
      JSON.stringify({ dependencies, name: 'demo', version: '1.4.2' }),
    );
    writeFileSync(
      join(projectDirectoryPath, 'capacitor.config.json'),
      JSON.stringify({ webDir: 'dist' }),
    );
    const configPath = join(projectDirectoryPath, 'hotcodepush.json');
    writeFileSync(configPath, JSON.stringify({ appId: DEMO_APP.id }));
    mkdirSync(join(projectDirectoryPath, 'dist', 'assets'), {
      recursive: true,
    });
    writeFileSync(join(projectDirectoryPath, 'dist', 'index.html'), INDEX_HTML);
    writeFileSync(
      join(projectDirectoryPath, 'dist', 'assets', 'app.js'),
      APP_JS,
    );
    writeFileSync(
      join(projectDirectoryPath, 'dist', 'assets', 'app.js.map'),
      '{}',
    );
    return configPath;
  }

  function respondWithUploadRoutes(
    previousBundles = [] as (typeof READY_BUNDLE)[],
    warnings = [] as { code: string; details: unknown; message: string }[],
    missingSha256s = [APP_JS_SHA256],
  ): void {
    harness.routes[`GET ${BUNDLES_PATH}`] = () =>
      Response.json(previousBundles);
    harness.routes[`GET ${BINARIES_PATH}`] = () => Response.json([]);
    harness.routes[`POST ${BUNDLES_PATH}`] = () =>
      Response.json(
        {
          ...READY_BUNDLE,
          state: 'uploading',
          uploads: {
            files: missingSha256s.map(sha256 => ({
              sha256,
              sizeBytes: 14,
              url: `${API_URL}/v1/apps/${DEMO_APP.id}/files/${sha256}`,
            })),
            pack: `${API_URL}${BUNDLES_PATH}/${READY_BUNDLE.id}/pack`,
            patches: [],
          },
          warnings,
        },
        { status: 201 },
      );
    harness.routes[`PUT /v1/apps/${DEMO_APP.id}/files/${APP_JS_SHA256}`] =
      request => {
        // The gzip bytes come from a temporary file the upload removes when it ends, so they are read as the request arrives
        uploadedFileBytes = request.arrayBuffer();
        return Response.json(
          {
            appId: DEMO_APP.id,
            createdAt: READY_BUNDLE.createdAt,
            sha256: APP_JS_SHA256,
            sizeBytes: 34,
          },
          { status: 201 },
        );
      };
    harness.routes[`PUT ${BUNDLES_PATH}/${READY_BUNDLE.id}/pack`] = () =>
      Response.json({ sizeBytes: 1536 });
    harness.routes[`POST ${BUNDLES_PATH}/${READY_BUNDLE.id}/complete`] = () =>
      Response.json(READY_BUNDLE);
  }

  /**
   * A base's files as the API lists them, and the delta pack against it accepted and kept.
   */
  function respondWithBaseFiles(
    bundleId: string,
    files: { path: string; sha256: string; sizeBytes: number }[],
  ): void {
    harness.routes[`GET ${BUNDLES_PATH}/${bundleId}/files`] = () =>
      Response.json(files);
    harness.routes[
      `PUT ${BUNDLES_PATH}/${READY_BUNDLE.id}/deltas/${bundleId}`
    ] = request => {
      // The pack comes from a temporary file the upload removes when it ends, so it is read as the request arrives
      uploadedDeltaPacks.set(bundleId, request.arrayBuffer());
      return Response.json({ sizeBytes: 512 });
    };
  }

  async function readDeltaPackEntries(
    baseBundleId: string,
  ): Promise<Map<string, Buffer> | undefined> {
    const packBytes = await uploadedDeltaPacks.get(baseBundleId);
    return packBytes && readPackEntries(packBytes);
  }

  function readRequest(
    method: string,
    pathSuffix: string,
  ): Request | undefined {
    return harness.requests.find(
      request =>
        request.method === method &&
        new URL(request.url).pathname.endsWith(pathSuffix),
    );
  }

  it('should post the manifest without source maps, upload only the files the app lacks as gzip, the pack, and complete', async () => {
    respondWithUploadRoutes();

    await bundleUploadCommand.action(
      {
        config: join(projectDirectoryPath, 'hotcodepush.json'),
        noGit: true,
        platform: ['ios'],
      },
      undefined,
    );

    const createRequest = readRequest('POST', '/bundles');
    expect(await createRequest?.json()).toEqual({
      version: '1.4.2',
      files: [
        { path: 'assets/app.js', sha256: APP_JS_SHA256, sizeBytes: 14 },
        { path: 'index.html', sha256: INDEX_SHA256, sizeBytes: 11 },
      ],
      fingerprint: CAPACITOR_FINGERPRINT,
      gitMessage: null,
      gitRef: null,
      gitRemote: null,
      gitSha: null,
      isGitDirty: null,
      platforms: ['ios'],
      signature: null,
    });
    const fileRequest = readRequest('PUT', `/files/${APP_JS_SHA256}`);
    expect(fileRequest).toBeDefined();
    expect(fileRequest?.headers.get('content-type')).toBe('application/gzip');
    expect(Number(fileRequest?.headers.get('content-length'))).toBeGreaterThan(
      0,
    );
    expect(
      gunzipSync(
        Buffer.from((await uploadedFileBytes) ?? new ArrayBuffer(0)),
      ).toString(),
    ).toBe(APP_JS);
    expect(readRequest('PUT', `/files/${INDEX_SHA256}`)).toBeUndefined();
    const packRequest = readRequest('PUT', '/pack');
    expect(Number(packRequest?.headers.get('content-length'))).toBeGreaterThan(
      1024,
    );
    expect(readRequest('POST', '/complete')).toBeDefined();
    expect(harness.readLines()).toEqual([
      `Uploaded bundle #17 · 1.4.2 (${READY_BUNDLE.id}): 1 files moved, 34 B.`,
    ]);
  });

  it('should leave the native glue the build carries out of the files it uploads', async () => {
    writeNativeGlue(join(projectDirectoryPath, 'dist'));
    respondWithUploadRoutes();

    await bundleUploadCommand.action(
      {
        config: join(projectDirectoryPath, 'hotcodepush.json'),
        json: true,
        noGit: true,
      },
      undefined,
    );

    expect(await readRequest('POST', '/bundles')?.json()).toMatchObject({
      files: [
        { path: 'assets/app.js', sha256: APP_JS_SHA256, sizeBytes: 14 },
        { path: 'index.html', sha256: INDEX_SHA256, sizeBytes: 11 },
      ],
    });
  });

  it('should print the warnings the API answers beside the created bundle on stderr', async () => {
    const message = `No binary of the app is registered with the fingerprint ${CAPACITOR_FINGERPRINT}; a release of this bundle reaches no device until a store build with it is registered.`;
    respondWithUploadRoutes(
      [],
      [
        {
          code: 'FINGERPRINT_UNREGISTERED',
          details: { fingerprint: CAPACITOR_FINGERPRINT },
          message,
        },
      ],
    );
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    await bundleUploadCommand.action(
      {
        config: join(projectDirectoryPath, 'hotcodepush.json'),
        json: true,
        noGit: true,
      },
      undefined,
    );

    expect(stderrWrite).toHaveBeenCalledWith(`Warning: ${message}\n`);
  });

  it('should upload a delta pack of the files the previous bundle lacks', async () => {
    respondWithUploadRoutes([PREVIOUS_BUNDLE]);
    respondWithBaseFiles(PREVIOUS_BUNDLE.id, [
      { path: 'index.html', sha256: INDEX_SHA256, sizeBytes: 11 },
    ]);

    await bundleUploadCommand.action(
      {
        config: join(projectDirectoryPath, 'hotcodepush.json'),
        json: true,
        noGit: true,
      },
      undefined,
    );

    expect([
      ...((await readDeltaPackEntries(PREVIOUS_BUNDLE.id))?.keys() ?? []),
    ]).toEqual([APP_JS_SHA256]);
    expect(harness.readJson()).toEqual([
      {
        ...READY_BUNDLE,
        upload: {
          deltaBaseBundleIds: [PREVIOUS_BUNDLE.id],
          patchCount: 0,
          uploadedBytes: 34,
          uploadedFileCount: 1,
        },
      },
    ]);
  });

  it('should carry a large changed file whole in the delta pack when the framework has no main bundle', async () => {
    const baseScript = Array.from(
      { length: 2000 },
      (_, line) => `console.log(${line});\n`,
    ).join('');
    const nextScript = baseScript.replace('console.log(1000);', 'v2');
    writeFileSync(
      join(projectDirectoryPath, 'dist', 'assets', 'app.js'),
      nextScript,
    );
    respondWithUploadRoutes([PREVIOUS_BUNDLE], [], []);
    respondWithBaseFiles(PREVIOUS_BUNDLE.id, [
      {
        path: 'assets/app.js',
        sha256: computeSha256(baseScript),
        sizeBytes: 1,
      },
      { path: 'index.html', sha256: INDEX_SHA256, sizeBytes: 11 },
    ]);

    await bundleUploadCommand.action(
      { config: join(projectDirectoryPath, 'hotcodepush.json'), noGit: true },
      undefined,
    );

    expect([
      ...((await readDeltaPackEntries(PREVIOUS_BUNDLE.id))?.keys() ?? []),
    ]).toEqual([computeSha256(nextScript)]);
    expect(harness.readLines()).toEqual([
      `Uploaded bundle #17 · 1.4.2 (${READY_BUNDLE.id}): 0 files moved, 0 B, with 1 delta pack.`,
    ]);
  });

  it('should make no delta pack against a base that shares no file with the bundle', async () => {
    respondWithUploadRoutes([PREVIOUS_BUNDLE]);
    respondWithBaseFiles(PREVIOUS_BUNDLE.id, [
      { path: 'index.html', sha256: 'f'.repeat(64), sizeBytes: 11 },
    ]);

    await bundleUploadCommand.action(
      { config: join(projectDirectoryPath, 'hotcodepush.json'), noGit: true },
      undefined,
    );

    expect(uploadedDeltaPacks.size).toBe(0);
    expect(readRequest('POST', '/complete')).toBeDefined();
  });

  function listPublicKey(): string {
    const configPath = join(projectDirectoryPath, 'hotcodepush.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        appId: DEMO_APP.id,
        publicKeys: [SIGNING_KEY.publicKey],
      }),
    );
    return configPath;
  }

  it('should sign the manifest the API rebuilds, the platforms sorted, when HOTCODEPUSH_SIGNING_KEY holds the private key of a listed public key', async () => {
    respondWithUploadRoutes();
    vi.stubEnv('HOTCODEPUSH_SIGNING_KEY', SIGNING_PRIVATE_KEY);

    await bundleUploadCommand.action(
      {
        config: listPublicKey(),
        json: true,
        noGit: true,
        platform: ['ios', 'android'],
      },
      undefined,
    );

    const { files, fingerprint, platforms, signature, version } =
      (await readRequest('POST', '/bundles')?.json()) as {
        files: object[];
        fingerprint: string;
        platforms: string[];
        signature: { keyId: string; value: string };
        version: string;
      };
    expect(platforms).toEqual(['android', 'ios']);
    expect(signature.keyId).toBe(SIGNING_KEY.fingerprint);
    expect(
      await verifyManifestSignature(
        {
          manifest: stringifyCanonicalJson({
            appId: DEMO_APP.id,
            bundleVersion: version,
            files,
            fingerprint,
            keyId: signature.keyId,
            platforms,
          }),
          signature,
        },
        [SIGNING_KEY.publicKey],
      ),
    ).toBe(true);
  });

  it('should sign the manifest with the private key file --private-key-path names', async () => {
    respondWithUploadRoutes();
    const privateKeyPath = join(projectDirectoryPath, 'private-key.pem');
    writeSigningPrivateKeyFile(privateKeyPath, SIGNING_PRIVATE_KEY);

    await bundleUploadCommand.action(
      { config: listPublicKey(), json: true, noGit: true, privateKeyPath },
      undefined,
    );

    const { signature } = (await readRequest('POST', '/bundles')?.json()) as {
      signature: { keyId: string };
    };
    expect(signature.keyId).toBe(SIGNING_KEY.fingerprint);
  });

  it('should stop with E_SIGNING_KEY_UNAVAILABLE before any request when hotcodepush.json lists a public key and no private key is given', async () => {
    respondWithUploadRoutes();

    await expect(
      bundleUploadCommand.action(
        { config: listPublicKey(), noGit: true },
        undefined,
      ),
    ).rejects.toBeInstanceOf(SigningKeyUnavailableError);

    expect(harness.requests).toHaveLength(0);
  });

  it('should stop with E_INVALID_PARAMETER before any request when a private key is given and hotcodepush.json lists no public key', async () => {
    respondWithUploadRoutes();
    vi.stubEnv('HOTCODEPUSH_SIGNING_KEY', SIGNING_PRIVATE_KEY);

    await expect(
      bundleUploadCommand.action(
        { config: join(projectDirectoryPath, 'hotcodepush.json'), noGit: true },
        undefined,
      ),
    ).rejects.toBeInstanceOf(InvalidParameterError);

    expect(harness.requests).toHaveLength(0);
  });

  it('should resolve a dry run without a private key when hotcodepush.json lists a public key', async () => {
    const [uploadBundleOptions] = await resolveUploadBundleOptions(
      createApiClient(),
      { config: listPublicKey(), noGit: true },
      projectDirectoryPath,
      { isDryRun: true },
    );

    expect(uploadBundleOptions?.signingPrivateKey).toBeNull();
    expect(harness.requests).toHaveLength(0);
  });

  it('should check the private key a dry run is given', async () => {
    await expect(
      resolveUploadBundleOptions(
        createApiClient(),
        {
          config: listPublicKey(),
          noGit: true,
          privateKeyPath: join(projectDirectoryPath, 'missing-key.pem'),
        },
        projectDirectoryPath,
        { isDryRun: true },
      ),
    ).rejects.toMatchObject({
      code: 'E_INVALID_PARAMETER',
      message: expect.stringMatching(/^--private-key-path: /),
    });
  });

  it('should ask for the version label when package.json has none and someone can answer', async () => {
    stubInteractiveTerminal();
    vi.mocked(text).mockResolvedValue('2.0.0');
    writeFileSync(
      join(projectDirectoryPath, 'package.json'),
      JSON.stringify({ dependencies: { '@capacitor/core': '8.0.0' } }),
    );
    respondWithUploadRoutes();

    await bundleUploadCommand.action(
      { config: join(projectDirectoryPath, 'hotcodepush.json'), noGit: true },
      undefined,
    );

    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Which version label does the bundle carry?',
      }),
    );
    expect(await readRequest('POST', '/bundles')?.json()).toMatchObject({
      version: '2.0.0',
    });
  });

  it('should name --platform when a platform is not ios or android', async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    const exitCode = await runCli(
      { 'bundle upload': () => import('./upload.js') },
      [
        'bundle',
        'upload',
        '--platform',
        'web',
        '--config',
        join(projectDirectoryPath, 'hotcodepush.json'),
      ],
      PACKAGE_JSON,
    );

    expect(exitCode).toBe(2);
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringMatching(/^E_INVALID_PARAMETER --platform: /),
    );
  });

  describe('in a React Native project', () => {
    beforeEach(() => {
      writeFileSync(
        join(projectDirectoryPath, 'package.json'),
        JSON.stringify({
          dependencies: { 'react-native': '0.82.1' },
          name: 'demo',
          version: '1.4.2',
        }),
      );
      writeFileSync(
        join(projectDirectoryPath, 'hotcodepush.json'),
        JSON.stringify({ appId: DEMO_APP.id }),
      );
      // without Hermes the bundler's output is the bundle, so the test needs no compiler
      mkdirSync(join(projectDirectoryPath, 'android'));
      writeFileSync(
        join(projectDirectoryPath, 'android', 'gradle.properties'),
        'hermesEnabled=false\n',
      );
      mkdirSync(join(projectDirectoryPath, 'ios'));
      writeFileSync(
        join(projectDirectoryPath, 'ios', 'Podfile'),
        'use_react_native!(:hermes_enabled => false)\n',
      );
      vi.mocked(runCommandLineVisibly).mockImplementation(({ args }) => {
        const bundleFilePath = args[args.indexOf('--bundle-output') + 1];
        if (bundleFilePath !== undefined) {
          writeFileSync(bundleFilePath, `bundle of ${bundleFilePath}`);
        }
      });
      harness.routes[`GET ${BUNDLES_PATH}`] = () => Response.json([]);
      harness.routes[`GET ${BINARIES_PATH}`] = () => Response.json([]);
      harness.routes[`POST ${BUNDLES_PATH}`] = () =>
        Response.json(
          {
            ...READY_BUNDLE,
            state: 'uploading',
            uploads: {
              files: [],
              pack: `${API_URL}${BUNDLES_PATH}/${READY_BUNDLE.id}/pack`,
              patches: [],
            },
            warnings: [],
          },
          { status: 201 },
        );
      harness.routes[`PUT ${BUNDLES_PATH}/${READY_BUNDLE.id}/pack`] = () =>
        Response.json({ sizeBytes: 1536 });
      harness.routes[`POST ${BUNDLES_PATH}/${READY_BUNDLE.id}/complete`] = () =>
        Response.json(READY_BUNDLE);
    });

    afterEach(() => {
      vi.mocked(runCommandLineVisibly).mockReset();
    });

    it('should bundle each platform and upload one bundle per platform, printing the list as JSON', async () => {
      await bundleUploadCommand.action(
        {
          config: join(projectDirectoryPath, 'hotcodepush.json'),
          json: true,
          noGit: true,
        },
        undefined,
      );

      const createBodies = await Promise.all(
        harness.requests
          .filter(
            ({ method, url }) => method === 'POST' && url.endsWith('/bundles'),
          )
          .map(
            request =>
              request.json() as Promise<{
                files: { path: string }[];
                platforms: string[];
              }>,
          ),
      );
      expect(
        createBodies.map(({ files, platforms }) => ({
          paths: files.map(({ path }) => path),
          platforms,
        })),
      ).toEqual([
        { paths: ['index.android.bundle'], platforms: ['android'] },
        { paths: ['main.jsbundle'], platforms: ['ios'] },
      ]);
      expect(harness.readJson()).toEqual([
        expect.objectContaining({ id: READY_BUNDLE.id }),
        expect.objectContaining({ id: READY_BUNDLE.id }),
      ]);
    });

    it('should upload --path as the prepared bundle of the one platform named, bundling nothing', async () => {
      const exportDirectoryPath = join(projectDirectoryPath, 'export');
      mkdirSync(exportDirectoryPath);
      writeFileSync(join(exportDirectoryPath, 'main.jsbundle'), 'prepared');

      await bundleUploadCommand.action(
        {
          config: join(projectDirectoryPath, 'hotcodepush.json'),
          json: true,
          noGit: true,
          path: exportDirectoryPath,
          platform: ['ios'],
        },
        undefined,
      );

      expect(runCommandLineVisibly).not.toHaveBeenCalled();
      expect(await readRequest('POST', '/bundles')?.json()).toMatchObject({
        files: [expect.objectContaining({ path: 'main.jsbundle' })],
        platforms: ['ios'],
      });
      expect(harness.readJson()).toMatchObject([{ id: READY_BUNDLE.id }]);
    });

    describe('with earlier bundles and a binary of the fingerprint', () => {
      // A main bundle of 2,000 lines, and each base's with another line changed
      const NEXT_SCRIPT = Array.from(
        { length: 2000 },
        (_, line) => `console.log(${line});\n`,
      ).join('');
      const PREVIOUS_SCRIPT = NEXT_SCRIPT.replace('console.log(1);', 'v1');
      const OLDER_SCRIPT = NEXT_SCRIPT.replace('console.log(2);', 'v0');
      const EMBEDDED_SCRIPT = NEXT_SCRIPT.replace('console.log(3);', 'e1');
      const OLDER_BUNDLE = {
        ...PREVIOUS_BUNDLE,
        id: '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d',
        number: 15,
      };
      let exportDirectoryPath = '';

      beforeEach(() => {
        exportDirectoryPath = join(projectDirectoryPath, 'export');
        mkdirSync(join(exportDirectoryPath, 'assets'), { recursive: true });
        writeFileSync(join(exportDirectoryPath, 'main.jsbundle'), NEXT_SCRIPT);
        writeFileSync(join(exportDirectoryPath, 'assets', 'logo.png'), 'logo');
        harness.routes[`GET ${BUNDLES_PATH}`] = () =>
          Response.json([PREVIOUS_BUNDLE, OLDER_BUNDLE]);
        harness.routes[`GET ${BINARIES_PATH}`] = () => Response.json([BINARY]);
        for (const [bundleId, script] of [
          [PREVIOUS_BUNDLE.id, PREVIOUS_SCRIPT],
          [OLDER_BUNDLE.id, OLDER_SCRIPT],
          [BINARY.bundleId, EMBEDDED_SCRIPT],
        ] as const) {
          respondWithBaseFiles(bundleId, [
            {
              path: 'assets/logo.png',
              sha256: computeSha256('logo'),
              sizeBytes: 4,
            },
            {
              path: 'main.jsbundle',
              sha256: computeSha256(script),
              sizeBytes: 1,
            },
          ]);
        }
        for (const script of [PREVIOUS_SCRIPT, EMBEDDED_SCRIPT]) {
          harness.routes[
            `GET /files/apps/${DEMO_APP.id}/files/${computeSha256(script)}`
          ] = () => new Response(script);
        }
      });

      async function uploadExport(isJson: boolean): Promise<void> {
        await bundleUploadCommand.action(
          {
            config: join(projectDirectoryPath, 'hotcodepush.json'),
            json: isJson,
            noGit: true,
            path: exportDirectoryPath,
            platform: ['ios'],
          },
          undefined,
        );
      }

      it('should carry the main bundle as a patch against the newest earlier bundle and the binary, and whole against an older bundle', async () => {
        await uploadExport(true);

        const nextSha256 = computeSha256(NEXT_SCRIPT);
        for (const [bundleId, script] of [
          [PREVIOUS_BUNDLE.id, PREVIOUS_SCRIPT],
          [BINARY.bundleId, EMBEDDED_SCRIPT],
        ] as const) {
          const entries = await readDeltaPackEntries(bundleId);
          const patchName = `patches/${computeSha256(script)}/${nextSha256}`;
          expect([...(entries?.keys() ?? [])]).toEqual([patchName]);
          expect(
            applyBsdiffPatch(
              Buffer.from(script),
              entries?.get(patchName) ?? Buffer.alloc(0),
            ),
          ).toEqual(new Uint8Array(Buffer.from(NEXT_SCRIPT)));
        }
        expect([
          ...((await readDeltaPackEntries(OLDER_BUNDLE.id))?.keys() ?? []),
        ]).toEqual([nextSha256]);
        expect(harness.readJson()).toMatchObject([
          {
            upload: {
              deltaBaseBundleIds: [
                PREVIOUS_BUNDLE.id,
                OLDER_BUNDLE.id,
                BINARY.bundleId,
              ],
              patchCount: 2,
            },
          },
        ]);
      });

      it('should carry the main bundle whole against a base whose patch cannot be made', async () => {
        delete harness.routes[
          `GET /files/apps/${DEMO_APP.id}/files/${computeSha256(PREVIOUS_SCRIPT)}`
        ];

        await uploadExport(false);

        expect([
          ...((await readDeltaPackEntries(PREVIOUS_BUNDLE.id))?.keys() ?? []),
        ]).toEqual([computeSha256(NEXT_SCRIPT)]);
        expect(harness.readLines()).toEqual([
          `Uploaded bundle #17 · 1.4.2 (${READY_BUNDLE.id}): 0 files moved, 0 B, with 3 delta packs and 1 patch.`,
        ]);
      });
    });
  });

  it('should refuse a project without a known framework', async () => {
    writeProject({});

    await expect(
      bundleUploadCommand.action(
        { config: join(projectDirectoryPath, 'hotcodepush.json') },
        undefined,
      ),
    ).rejects.toThrow(UnknownFrameworkError);
  });
});
