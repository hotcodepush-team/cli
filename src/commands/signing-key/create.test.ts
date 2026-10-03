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
  privateKey: string;
  signingKeys: { fingerprint: string; id: string; publicKey: string }[];
}

const SIGNING_KEYS_PATH = `/v1/apps/${DEMO_APP.id}/signing-keys`;

const SIGNING_KEY_IDS = [
  SIGNING_KEY.id,
  '7d4c1b2a-3f5e-4b1f-8e7a-5c2d4f6b9a0e',
];

describe('signing-key create', () => {
  const harness = useCommandHarness();

  // The API as it answers a registration: the key it was sent, with its fingerprint
  function respondWithRegistrations(): void {
    let registrationCount = 0;
    harness.routes[`POST ${SIGNING_KEYS_PATH}`] = async request => {
      const { publicKey } = (await request.json()) as { publicKey: string };
      return Response.json(
        {
          appId: DEMO_APP.id,
          createdAt: SIGNING_KEY.createdAt,
          fingerprint: resolveSigningKeyFingerprint(publicKey),
          id: SIGNING_KEY_IDS[registrationCount++],
          publicKey,
        },
        { status: 201 },
      );
    };
  }

  function readProjectConfig(configPath: string): ProjectConfig {
    return JSON.parse(readFileSync(configPath, 'utf8')) as ProjectConfig;
  }

  it('should register the public key, add it to publicKeys in hotcodepush.json after the keys there, store the private key and print it once', async () => {
    respondWithRegistrations();
    const configPath = harness.writeProjectConfig({
      appId: DEMO_APP.id,
      channel: PRODUCTION_CHANNEL.name,
      publicKeys: [SIGNING_KEY.publicKey],
    });

    await signingKeyCreateCommand.action({ config: configPath }, undefined);

    const keyFilePath = resolveSigningKeyFilePath(DEMO_APP.id);
    const privateKey = readFileSync(keyFilePath, 'utf8').trim();
    const publicKey = await resolvePublicKeyOfPrivateKey(privateKey);
    expect(await harness.requests.at(-1)?.json()).toEqual({ publicKey });
    expect(readProjectConfig(configPath)).toEqual({
      appId: DEMO_APP.id,
      channel: PRODUCTION_CHANNEL.name,
      publicKeys: [SIGNING_KEY.publicKey, publicKey],
    });
    expect(harness.readLines()).toEqual([
      `Created signing key ${resolveSigningKeyFingerprint(publicKey)} (${SIGNING_KEY.id}).`,
      'Added to publicKeys in hotcodepush.json.',
      'The private key, shown once; set it as HOTCODEPUSH_SIGNING_KEY in CI:',
      privateKey,
      `Stored in ${keyFilePath}.`,
    ]);
  });

  it('should register the RSA pair beside the ed25519 one with --expo-bridge and print one value for the secret', async () => {
    respondWithRegistrations();
    const configPath = harness.writeProjectConfig({ appId: DEMO_APP.id });

    await signingKeyCreateCommand.action(
      { config: configPath, expoBridge: true, json: true },
      undefined,
    );

    const result = harness.readJson() as CreateResult;
    expect(result.signingKeys.map(({ id }) => id)).toEqual(SIGNING_KEY_IDS);
    expect(result.privateKey).toMatch(/^ed25519:[^,]+,rsa-v1_5-sha256:[^,]+$/);
    expect(result.signingKeys.map(({ publicKey }) => publicKey)).toEqual(
      await Promise.all(
        result.privateKey.split(',').map(resolvePublicKeyOfPrivateKey),
      ),
    );
    expect(readProjectConfig(configPath).publicKeys).toEqual(
      result.signingKeys.map(({ publicKey }) => publicKey),
    );
    expect(readFileSync(resolveSigningKeyFilePath(DEMO_APP.id), 'utf8')).toBe(
      `${result.privateKey.split(',').join('\n')}\n`,
    );
  });

  it('should store no key file in CI, where the key lives in a secret', async () => {
    vi.stubEnv('CI', 'true');
    respondWithRegistrations();

    await signingKeyCreateCommand.action(
      { config: harness.writeProjectConfig({ appId: DEMO_APP.id }) },
      undefined,
    );

    expect(existsSync(resolveSigningKeyFilePath(DEMO_APP.id))).toBe(false);
    expect(harness.readLines()).toEqual([
      expect.stringMatching(/^Created signing key sha256:/),
      'Added to publicKeys in hotcodepush.json.',
      'The private key, shown once; set it as HOTCODEPUSH_SIGNING_KEY in CI:',
      expect.stringMatching(/^ed25519:/),
    ]);
  });

  it('should leave a hotcodepush.json of another app alone and print the public key to add', async () => {
    respondWithRegistrations();
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
        /^Add it to publicKeys in the app's hotcodepush\.json: ed25519:/,
      ),
    ]);
  });
});
