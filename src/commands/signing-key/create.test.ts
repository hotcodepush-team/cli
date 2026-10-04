import { createPrivateKey } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolvePublicKeyOfPrivateKey,
  resolveSigningKeyFingerprint,
} from '@hotcodepush/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  respondWithApiError,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  DEMO_APP,
  PRODUCTION_CHANNEL,
  SIGNING_KEY,
} from '../../../test/fixtures.js';
import type { ProjectConfig } from '../../utils/project-config.js';
import signingKeyCreateCommand from './create.js';

const CREATED_AT = '2026-10-04T08:00:00.000Z';

const SIGNING_KEY_ID = '7d4c1b2a-3f5e-4b1f-8e7a-5c2d4f6b9a0e';

const SIGNING_KEYS_PATH = `/v1/apps/${DEMO_APP.id}/signing-keys`;

describe('signing-key create', () => {
  const harness = useCommandHarness();
  let workingDirectoryPath = '';

  beforeEach(() => {
    workingDirectoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-'));
    vi.spyOn(process, 'cwd').mockReturnValue(workingDirectoryPath);
  });

  afterEach(() => {
    rmSync(workingDirectoryPath, { force: true, recursive: true });
  });

  // The API as it answers a registration: the key it was sent, with its fingerprint
  function respondWithRegistration(): void {
    harness.routes[`POST ${SIGNING_KEYS_PATH}`] = async request => {
      const { publicKey } = (await request.json()) as { publicKey: string };
      return Response.json(
        {
          appId: DEMO_APP.id,
          createdAt: CREATED_AT,
          fingerprint: resolveSigningKeyFingerprint(publicKey),
          id: SIGNING_KEY_ID,
          publicKey,
        },
        { status: 201 },
      );
    };
  }

  function readProjectConfig(configPath: string): ProjectConfig {
    return JSON.parse(readFileSync(configPath, 'utf8')) as ProjectConfig;
  }

  // The key file's private key as the protocol signs with it, and the PEM body no output may repeat
  async function readKeyFile(
    filePath: string,
  ): Promise<{ pemBody: string; publicKey: string }> {
    const pem = readFileSync(filePath, 'utf8');
    const privateKey = createPrivateKey(pem)
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64');
    return {
      pemBody: pem.split('\n')[1] ?? '',
      publicKey: await resolvePublicKeyOfPrivateKey(privateKey),
    };
  }

  it('should write the private key to hotcodepush-private-key.pem in the working directory, register its public key and add it to publicKeys after the keys there', async () => {
    respondWithRegistration();
    const configPath = harness.writeProjectConfig({
      appId: DEMO_APP.id,
      channel: PRODUCTION_CHANNEL.name,
      publicKeys: [SIGNING_KEY.publicKey],
    });

    await signingKeyCreateCommand.action({ config: configPath }, undefined);

    const keyFilePath = join(
      workingDirectoryPath,
      'hotcodepush-private-key.pem',
    );
    const { pemBody, publicKey } = await readKeyFile(keyFilePath);
    expect(publicKey).toMatch(/^rsa-v1_5-sha256:/);
    expect(await harness.requests.at(-1)?.json()).toEqual({ publicKey });
    expect(readProjectConfig(configPath)).toEqual({
      appId: DEMO_APP.id,
      channel: PRODUCTION_CHANNEL.name,
      publicKeys: [SIGNING_KEY.publicKey, publicKey],
    });
    expect(harness.readLines()).toEqual([
      `Created signing key ${resolveSigningKeyFingerprint(publicKey)} (${SIGNING_KEY_ID}).`,
      'Added to publicKeys in hotcodepush.json.',
      `Wrote the private key to ${keyFilePath}.`,
      "Keep the file out of version control: whoever holds it can sign the app's bundles.",
      "Uploads sign with it through --private-key-path; in CI, set HOTCODEPUSH_SIGNING_KEY to the file's content.",
    ]);
    expect(harness.readLines().join('\n')).not.toContain(pemBody);
  });

  it('should write the private key to the file --private-key-path names', async () => {
    respondWithRegistration();
    const keyFilePath = join(workingDirectoryPath, 'demo-private-key.pem');

    await signingKeyCreateCommand.action(
      {
        config: harness.writeProjectConfig({ appId: DEMO_APP.id }),
        privateKeyPath: 'demo-private-key.pem',
      },
      undefined,
    );

    const { publicKey } = await readKeyFile(keyFilePath);
    expect(await harness.requests.at(-1)?.json()).toEqual({ publicKey });
    expect(harness.readLines()).toContain(
      `Wrote the private key to ${keyFilePath}.`,
    );
  });

  it("should print the registered key with the private key file's path as JSON, never the key", async () => {
    respondWithRegistration();
    const configPath = harness.writeProjectConfig({ appId: DEMO_APP.id });

    await signingKeyCreateCommand.action(
      { config: configPath, json: true },
      undefined,
    );

    const keyFilePath = join(
      workingDirectoryPath,
      'hotcodepush-private-key.pem',
    );
    const { pemBody, publicKey } = await readKeyFile(keyFilePath);
    expect(harness.readJson()).toEqual({
      appId: DEMO_APP.id,
      createdAt: CREATED_AT,
      fingerprint: resolveSigningKeyFingerprint(publicKey),
      id: SIGNING_KEY_ID,
      privateKeyPath: keyFilePath,
      publicKey,
    });
    expect(JSON.stringify(harness.readJson())).not.toContain(pemBody);
    expect(readProjectConfig(configPath).publicKeys).toEqual([publicKey]);
  });

  it('should refuse a file that exists at the path before any request', async () => {
    respondWithRegistration();
    const keyFilePath = join(
      workingDirectoryPath,
      'hotcodepush-private-key.pem',
    );
    writeFileSync(keyFilePath, 'kept');

    await expect(
      signingKeyCreateCommand.action({ app: 'Demo' }, undefined),
    ).rejects.toMatchObject({
      code: 'E_INVALID_PARAMETER',
      message: `--private-key-path: ${keyFilePath} already exists`,
    });

    expect(harness.requests).toHaveLength(0);
    expect(readFileSync(keyFilePath, 'utf8')).toBe('kept');
  });

  it('should remove the private key file and leave hotcodepush.json alone when the registration fails', async () => {
    harness.routes[`POST ${SIGNING_KEYS_PATH}`] = () =>
      respondWithApiError(403, 'E_FORBIDDEN', 'Your role is too low.');
    const configPath = harness.writeProjectConfig({ appId: DEMO_APP.id });

    await expect(
      signingKeyCreateCommand.action({ config: configPath }, undefined),
    ).rejects.toThrow('Your role is too low.');

    expect(
      existsSync(join(workingDirectoryPath, 'hotcodepush-private-key.pem')),
    ).toBe(false);
    expect(readProjectConfig(configPath)).toEqual({ appId: DEMO_APP.id });
  });

  it('should leave a hotcodepush.json of another app alone and print the public key to add', async () => {
    respondWithRegistration();
    const configPath = harness.writeProjectConfig({
      appId: PRODUCTION_CHANNEL.id,
    });

    await signingKeyCreateCommand.action(
      { app: DEMO_APP.id, config: configPath },
      undefined,
    );

    expect(readProjectConfig(configPath)).toEqual({
      appId: PRODUCTION_CHANNEL.id,
    });
    expect(harness.readLines().slice(0, 2)).toEqual([
      expect.stringMatching(/^Created signing key sha256:/),
      expect.stringMatching(
        /^Add it to publicKeys in the app's hotcodepush\.json: rsa-v1_5-sha256:/,
      ),
    ]);
  });
});
