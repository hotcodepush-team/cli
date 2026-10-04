import { existsSync, readFileSync } from 'node:fs';
import {
  resolvePublicKeyOfPrivateKey,
  resolveSigningKeyFingerprint,
} from '@hotcodepush/protocol';
import { describe, expect, it, vi } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  DEMO_APP,
  PRODUCTION_CHANNEL,
  SIGNING_KEY,
} from '../../../test/fixtures.js';
import type { ProjectConfig } from '../../utils/project-config.js';
import { resolveSigningKeyFilePath } from '../../utils/signing-key-store.js';
import signingKeyCreateCommand from './create.js';

interface CreateResult {
  fingerprint: string;
  id: string;
  privateKey: string;
  publicKey: string;
}

const CREATED_AT = '2026-10-04T08:00:00.000Z';

const SIGNING_KEY_ID = '7d4c1b2a-3f5e-4b1f-8e7a-5c2d4f6b9a0e';

const SIGNING_KEYS_PATH = `/v1/apps/${DEMO_APP.id}/signing-keys`;

// One line of base64, the PKCS #8 DER of an RSA key
const PRIVATE_KEY_PATTERN = /^[A-Za-z0-9+/]{1000,}=*$/;

describe('signing-key create', () => {
  const harness = useCommandHarness();

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

  it('should register the public key of an RSA pair, add it to publicKeys in hotcodepush.json after the keys there, store the private key and print it once', async () => {
    respondWithRegistration();
    const configPath = harness.writeProjectConfig({
      appId: DEMO_APP.id,
      channel: PRODUCTION_CHANNEL.name,
      publicKeys: [SIGNING_KEY.publicKey],
    });

    await signingKeyCreateCommand.action({ config: configPath }, undefined);

    const keyFilePath = resolveSigningKeyFilePath(DEMO_APP.id);
    const privateKey = readFileSync(keyFilePath, 'utf8').trim();
    const publicKey = await resolvePublicKeyOfPrivateKey(privateKey);
    expect(privateKey).toMatch(PRIVATE_KEY_PATTERN);
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
      'The private key, shown once; set it as HOTCODEPUSH_SIGNING_KEY in CI:',
      privateKey,
      `Stored in ${keyFilePath}.`,
    ]);
  });

  it('should print the registered key with its private half as JSON', async () => {
    respondWithRegistration();
    const configPath = harness.writeProjectConfig({ appId: DEMO_APP.id });

    await signingKeyCreateCommand.action(
      { config: configPath, json: true },
      undefined,
    );

    const result = harness.readJson() as CreateResult;
    expect(result).toEqual({
      appId: DEMO_APP.id,
      createdAt: CREATED_AT,
      fingerprint: resolveSigningKeyFingerprint(result.publicKey),
      id: SIGNING_KEY_ID,
      privateKey: expect.stringMatching(PRIVATE_KEY_PATTERN),
      publicKey: await resolvePublicKeyOfPrivateKey(result.privateKey),
    });
    expect(readProjectConfig(configPath).publicKeys).toEqual([
      result.publicKey,
    ]);
  });

  it('should store no key file in CI, where the key lives in a secret', async () => {
    vi.stubEnv('CI', 'true');
    respondWithRegistration();

    await signingKeyCreateCommand.action(
      { config: harness.writeProjectConfig({ appId: DEMO_APP.id }) },
      undefined,
    );

    expect(existsSync(resolveSigningKeyFilePath(DEMO_APP.id))).toBe(false);
    expect(harness.readLines()).toEqual([
      expect.stringMatching(/^Created signing key sha256:/),
      'Added to publicKeys in hotcodepush.json.',
      'The private key, shown once; set it as HOTCODEPUSH_SIGNING_KEY in CI:',
      expect.stringMatching(PRIVATE_KEY_PATTERN),
    ]);
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
