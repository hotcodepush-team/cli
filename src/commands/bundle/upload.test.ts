import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { text } from '@clack/prompts';
import { stringifyCanonicalJson } from '@hotcodepush/protocol';
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
import {
  DEMO_APP,
  PREVIOUS_BUNDLE,
  READY_BUNDLE,
} from '../../../test/fixtures.js';
import { PACKAGE_JSON } from '../../config/consts.js';
import { runCli } from '../../utils/cli.js';
import {
  UnknownFrameworkError,
  UnsupportedFrameworkError,
} from '../../utils/errors.js';
import bundleUploadCommand from './upload.js';

vi.mock('@clack/prompts');

const BUNDLES_PATH = `/v1/apps/${DEMO_APP.id}/bundles`;

const INDEX_HTML = '<h1>v1</h1>';
const APP_JS = 'console.log(1)';
const INDEX_SHA256 = createHash('sha256').update(INDEX_HTML).digest('hex');
const APP_JS_SHA256 = createHash('sha256').update(APP_JS).digest('hex');

describe('bundle upload', () => {
  const harness = useCommandHarness();
  let projectDirectoryPath = '';
  let uploadedFileBytes: Promise<ArrayBuffer> | undefined;

  beforeEach(() => {
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
    const configPath = join(projectDirectoryPath, 'hotcodepush.json');
    writeFileSync(
      configPath,
      JSON.stringify({ appId: DEMO_APP.id, dir: 'dist' }),
    );
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
  ): void {
    harness.routes[`GET ${BUNDLES_PATH}?limit=1&state=ready`] = () =>
      Response.json(previousBundles);
    harness.routes[`POST ${BUNDLES_PATH}`] = () =>
      Response.json(
        {
          ...READY_BUNDLE,
          state: 'uploading',
          uploads: {
            files: [
              {
                sha256: APP_JS_SHA256,
                sizeBytes: 14,
                url: `${API_URL}/v1/apps/${DEMO_APP.id}/files/${APP_JS_SHA256}`,
              },
            ],
            pack: `${API_URL}${BUNDLES_PATH}/${READY_BUNDLE.id}/pack`,
          },
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
    harness.routes[
      `PUT ${BUNDLES_PATH}/${READY_BUNDLE.id}/deltas/${PREVIOUS_BUNDLE.id}`
    ] = () => Response.json({ sizeBytes: 512 });
    harness.routes[`POST ${BUNDLES_PATH}/${READY_BUNDLE.id}/complete`] = () =>
      Response.json(READY_BUNDLE);
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
      bundleVersion: '1.4.2',
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

  it('should upload a delta pack of the changed files against the previous bundle when its manifest is reachable', async () => {
    respondWithUploadRoutes([PREVIOUS_BUNDLE]);
    harness.routes[
      `GET /files/apps/${DEMO_APP.id}/bundles/${PREVIOUS_BUNDLE.id}/manifest.json`
    ] = () =>
      Response.json({
        bundleId: PREVIOUS_BUNDLE.id,
        createdAt: PREVIOUS_BUNDLE.createdAt,
        deltas: [],
        encryption: null,
        manifest: stringifyCanonicalJson({
          appId: DEMO_APP.id,
          bundleVersion: '1.4.1',
          files: [{ path: 'index.html', sha256: INDEX_SHA256, sizeBytes: 11 }],
          fingerprint: CAPACITOR_FINGERPRINT,
          keyId: null,
          patches: [],
          platforms: ['android', 'ios'],
        }),
        pack: { sizeBytes: 1024, url: `${API_URL}/files/pack` },
        patches: [],
        signature: null,
      });

    await bundleUploadCommand.action(
      {
        config: join(projectDirectoryPath, 'hotcodepush.json'),
        json: true,
        noGit: true,
      },
      undefined,
    );

    const deltaRequest = readRequest('PUT', `/deltas/${PREVIOUS_BUNDLE.id}`);
    expect(deltaRequest).toBeDefined();
    expect(Number(deltaRequest?.headers.get('content-length'))).toBeLessThan(
      Number(readRequest('PUT', '/pack')?.headers.get('content-length')),
    );
    expect(harness.readJson()).toEqual({
      ...READY_BUNDLE,
      upload: {
        deltaBaseBundleId: PREVIOUS_BUNDLE.id,
        uploadedBytes: 34,
        uploadedFileCount: 1,
      },
    });
  });

  it('should skip the delta pack when the previous manifest is unreachable', async () => {
    respondWithUploadRoutes([PREVIOUS_BUNDLE]);

    await bundleUploadCommand.action(
      { config: join(projectDirectoryPath, 'hotcodepush.json'), noGit: true },
      undefined,
    );

    expect(readRequest('PUT', `/deltas/${PREVIOUS_BUNDLE.id}`)).toBeUndefined();
    expect(readRequest('POST', '/complete')).toBeDefined();
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
      bundleVersion: '2.0.0',
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

  it('should refuse a React Native project until its packaging arrives', async () => {
    writeProject({ 'react-native': '0.82.0' });

    await expect(
      bundleUploadCommand.action(
        { config: join(projectDirectoryPath, 'hotcodepush.json') },
        undefined,
      ),
    ).rejects.toThrow(UnsupportedFrameworkError);
    expect(harness.requests).toEqual([]);
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
