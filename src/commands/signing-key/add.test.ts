import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  DEMO_APP,
  PRODUCTION_CHANNEL,
  resolveProtocolSigningKey,
  SIGNING_KEY,
} from '../../../test/fixtures.js';
import type { ProjectConfig } from '../../utils/project-config.js';
import signingKeyAddCommand from './add.js';

const CREATED_AT = '2026-10-08T08:00:00.000Z';

const SIGNING_KEY_ID = '5c2d4f6b-9a0e-4d4c-8b2a-3f5e7d4c1b2a';

const SIGNING_KEYS_PATH = `/v1/apps/${DEMO_APP.id}/signing-keys`;

const KEY_PAIR = resolveProtocolSigningKey('rsa-4096-b');

describe('signing-key add', () => {
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
          fingerprint: KEY_PAIR.fingerprint,
          id: SIGNING_KEY_ID,
          publicKey,
        },
        { status: 201 },
      );
    };
  }

  /**
   * The private key of a pair as a PEM file the person already has, in the encoding named; its path.
   */
  function writeKeyFile(
    privateKey: string,
    type: 'pkcs1' | 'pkcs8' = 'pkcs8',
  ): string {
    const filePath = join(workingDirectoryPath, 'my-app-private-key.pem');
    writeFileSync(
      filePath,
      createPrivateKey({
        format: 'der',
        key: Buffer.from(privateKey, 'base64'),
        type: 'pkcs8',
      }).export({ format: 'pem', type }),
    );
    return filePath;
  }

  function readProjectConfig(configPath: string): ProjectConfig {
    return JSON.parse(readFileSync(configPath, 'utf8')) as ProjectConfig;
  }

  it.each(['pkcs8', 'pkcs1'] as const)(
    'should register the public key derived from a %s private key file and add it to publicKeys after the keys there, leaving the file where it is',
    async type => {
      respondWithRegistration();
      const keyFilePath = writeKeyFile(KEY_PAIR.privateKey, type);
      const keyFileText = readFileSync(keyFilePath, 'utf8');
      const configPath = harness.writeProjectConfig({
        appId: DEMO_APP.id,
        channel: PRODUCTION_CHANNEL.name,
        publicKeys: [SIGNING_KEY.publicKey],
      });

      await signingKeyAddCommand.action(
        { config: configPath, privateKeyPath: 'my-app-private-key.pem' },
        undefined,
      );

      expect(await harness.requests.at(-1)?.json()).toEqual({
        publicKey: KEY_PAIR.publicKey,
      });
      expect(readProjectConfig(configPath)).toEqual({
        appId: DEMO_APP.id,
        channel: PRODUCTION_CHANNEL.name,
        publicKeys: [SIGNING_KEY.publicKey, KEY_PAIR.publicKey],
      });
      expect(harness.readLines()).toEqual([
        `Added signing key ${KEY_PAIR.fingerprint} (${SIGNING_KEY_ID}).`,
        'Added to publicKeys in hotcodepush.json.',
        "Uploads sign with it through --private-key-path; in CI, set HOTCODEPUSH_SIGNING_KEY to the file's content.",
      ]);
      expect(readFileSync(keyFilePath, 'utf8')).toBe(keyFileText);
      expect(readdirSync(workingDirectoryPath)).toEqual([
        'my-app-private-key.pem',
      ]);
    },
  );

  it("should print the registered key as JSON, create's shape without a file, never the private key", async () => {
    respondWithRegistration();
    const keyFilePath = writeKeyFile(KEY_PAIR.privateKey);

    await signingKeyAddCommand.action(
      {
        config: harness.writeProjectConfig({ appId: DEMO_APP.id }),
        json: true,
        privateKeyPath: keyFilePath,
      },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      appId: DEMO_APP.id,
      createdAt: CREATED_AT,
      fingerprint: KEY_PAIR.fingerprint,
      id: SIGNING_KEY_ID,
      publicKey: KEY_PAIR.publicKey,
    });
    expect(JSON.stringify(harness.readJson())).not.toContain(
      KEY_PAIR.privateKey.slice(0, 64),
    );
  });

  it('should keep publicKeys as it is when hotcodepush.json lists the key already', async () => {
    respondWithRegistration();
    const configPath = harness.writeProjectConfig({
      appId: DEMO_APP.id,
      publicKeys: [KEY_PAIR.publicKey],
    });

    await signingKeyAddCommand.action(
      { config: configPath, privateKeyPath: writeKeyFile(KEY_PAIR.privateKey) },
      undefined,
    );

    expect(readProjectConfig(configPath).publicKeys).toEqual([
      KEY_PAIR.publicKey,
    ]);
  });

  it.each([
    [
      'is under 2048 bits',
      () => writeKeyFile(resolveProtocolSigningKey('rsa-1024').privateKey),
    ],
    [
      'is no RSA key',
      () => {
        const filePath = join(workingDirectoryPath, 'my-app-private-key.pem');
        writeFileSync(
          filePath,
          generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
            format: 'pem',
            type: 'pkcs8',
          }),
        );
        return filePath;
      },
    ],
  ])(
    'should refuse a private key that %s before any request',
    async (_condition, writeRefusedKeyFile) => {
      respondWithRegistration();
      const configPath = harness.writeProjectConfig({ appId: DEMO_APP.id });

      await expect(
        signingKeyAddCommand.action(
          { config: configPath, privateKeyPath: writeRefusedKeyFile() },
          undefined,
        ),
      ).rejects.toMatchObject({
        code: 'E_INVALID_PARAMETER',
        message: '--private-key-path: no RSA private key of 2048 bits or more',
      });

      expect(harness.requests).toHaveLength(0);
      expect(readProjectConfig(configPath)).toEqual({ appId: DEMO_APP.id });
    },
  );

  it("should pass the API's refusal of the public key through and leave hotcodepush.json alone", async () => {
    harness.routes[`POST ${SIGNING_KEYS_PATH}`] = () =>
      Response.json(
        {
          code: 'E_VALIDATION',
          details: {
            field: 'publicKey',
            rule: 'rsa_public_key',
            target: 'json',
          },
          message: 'The request is invalid.',
        },
        { status: 400 },
      );
    const configPath = harness.writeProjectConfig({ appId: DEMO_APP.id });

    await expect(
      signingKeyAddCommand.action(
        {
          config: configPath,
          privateKeyPath: writeKeyFile(KEY_PAIR.privateKey),
        },
        undefined,
      ),
    ).rejects.toMatchObject({
      code: 'E_VALIDATION',
      details: { rule: 'rsa_public_key' },
    });

    expect(readProjectConfig(configPath)).toEqual({ appId: DEMO_APP.id });
  });

  it('should name --private-key-path when it is missing and nobody can be asked, before any request', async () => {
    await expect(
      signingKeyAddCommand.action({ app: DEMO_APP.id }, undefined),
    ).rejects.toMatchObject({
      code: 'E_MISSING_PARAMETER',
      message: '--private-key-path is missing',
    });

    expect(harness.requests).toHaveLength(0);
  });
});
