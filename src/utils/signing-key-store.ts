import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { resolvePublicKeyOfPrivateKey } from '@hotcodepush/protocol';
import type { SigningKeyPair } from '@hotcodepush/protocol';
import { SIGNING_KEY_DIRECTORY_NAME } from '../config/consts.js';
import { InvalidParameterError, SigningKeyUnavailableError } from './errors.js';
import { resolveConfigDirectoryPath } from './user-config.js';

// One key per line in the file; a comma separates them as well, the form `HOTCODEPUSH_SIGNING_KEY` holds on its one line
const PRIVATE_KEY_SEPARATOR_PATTERN = /[\s,]+/;

/**
 * The private keys at hand for an app, self-describing as `<scheme>:<base64>`: `HOTCODEPUSH_SIGNING_KEY` when set, the secret
 * a CI holds, otherwise `keys/{appId}.key` in the config directory, where `signing-key create` stores them outside CI.
 */
export function readSigningPrivateKeys(appId: string): string[] {
  const privateKeysText =
    process.env.HOTCODEPUSH_SIGNING_KEY || readSigningKeyFile(appId);
  return privateKeysText
    .split(PRIVATE_KEY_SEPARATOR_PATTERN)
    .filter(privateKey => privateKey !== '');
}

export function resolveSigningKeyFilePath(appId: string): string {
  return join(
    resolveConfigDirectoryPath(),
    SIGNING_KEY_DIRECTORY_NAME,
    `${appId}.key`,
  );
}

/**
 * The key pair an upload signs with: the first public key `hotcodepush.json` lists whose private half is at hand,
 * so the file's order decides while a binary accepts two keys. None at hand stops the upload, since the app
 * would refuse the unsigned bundle.
 */
export async function resolveSigningKeyPair(
  appId: string,
  publicKeys: readonly string[],
): Promise<SigningKeyPair> {
  const privateKeysByPublicKey = new Map<string, string>();
  for (const privateKey of readSigningPrivateKeys(appId)) {
    privateKeysByPublicKey.set(await resolvePublicKey(privateKey), privateKey);
  }
  for (const publicKey of publicKeys) {
    const privateKey = privateKeysByPublicKey.get(publicKey);
    if (privateKey !== undefined) {
      return { privateKey, publicKey };
    }
  }
  throw new SigningKeyUnavailableError(resolveSigningKeyFilePath(appId));
}

/**
 * Adds private keys to the app's key file, one per line, readable by its owner alone; the keys already there stay,
 * so the key a store build still trusts keeps signing after a second one is made. Answers the file's path.
 */
export function writeSigningPrivateKeys(
  appId: string,
  privateKeys: readonly string[],
): string {
  const filePath = resolveSigningKeyFilePath(appId);
  mkdirSync(dirname(filePath), { mode: 0o700, recursive: true });
  const storedPrivateKeys = readSigningKeyFile(appId)
    .split(PRIVATE_KEY_SEPARATOR_PATTERN)
    .filter(privateKey => privateKey !== '');
  writeFileSync(
    filePath,
    `${[...storedPrivateKeys, ...privateKeys].join('\n')}\n`,
    { mode: 0o600 },
  );
  // the mode covers a new file, chmod an existing one
  chmodSync(filePath, 0o600);
  return filePath;
}

function readSigningKeyFile(appId: string): string {
  const filePath = resolveSigningKeyFilePath(appId);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

/**
 * The public half of a private key at hand; the key itself never reaches a message.
 */
async function resolvePublicKey(privateKey: string): Promise<string> {
  try {
    return await resolvePublicKeyOfPrivateKey(privateKey);
  } catch (error) {
    throw new InvalidParameterError(
      'a signing private key is not one the CLI can read',
      error,
      'set HOTCODEPUSH_SIGNING_KEY, or the key file, to the value "hotcodepush signing-key create" printed.',
    );
  }
}
