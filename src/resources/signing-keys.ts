import type { HotCodePush, SigningKey } from '@hotcodepush/node';
import { PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';
import { printNotice } from '../utils/diagnostics.js';
import type { InteractivityOptions } from '../utils/environment.js';
import type { Detail } from '../utils/output.js';
import { fetchAllPages } from '../utils/pagination.js';
import type { ProjectConfigLocation } from '../utils/project-config.js';
import { writeProjectConfig } from '../utils/project-config.js';
import { promptResourceId, resolveResource } from '../utils/resources.js';

interface SigningKeyOptions extends InteractivityOptions {
  signingKey?: string;
}

// Keys already listed stay, so the next builds keep trusting them.
// A file of another app, or no file, is left alone.
export function addPublicKeyToProjectConfig(
  { filePath, projectConfig }: ProjectConfigLocation,
  { appId, publicKey }: { appId: string; publicKey: string },
): boolean {
  if (filePath === undefined || projectConfig?.appId !== appId) {
    return false;
  }
  if (projectConfig.publicKeys?.includes(publicKey)) {
    return true;
  }
  writeProjectConfig(filePath, {
    ...projectConfig,
    publicKeys: [...(projectConfig.publicKeys ?? []), publicKey],
  });
  return true;
}

// An app with a signing key releases only signed bundles.
export async function fetchHasSigningKey(
  hotCodePush: HotCodePush,
  appId: string,
): Promise<boolean> {
  const { count } = await hotCodePush.apps.signingKeys.count({ appId });
  return count > 0;
}

// A signing key is named by its key id.
export async function fetchSigningKey(
  hotCodePush: HotCodePush,
  { appId, options }: { appId: string; options: SigningKeyOptions },
): Promise<SigningKey> {
  const namedSigningKeys = (await fetchSigningKeys(hotCodePush, appId)).map(
    signingKey => ({ ...signingKey, name: signingKey.keyId }),
  );
  const reference =
    options.signingKey ??
    (await promptResourceId(options, {
      noun: 'signing-key',
      resources: namedSigningKeys,
    }));
  return resolveResource(namedSigningKeys, { noun: 'signing-key', reference });
}

export function fetchSigningKeys(
  hotCodePush: HotCodePush,
  appId: string,
): Promise<SigningKey[]> {
  return fetchAllPages(page =>
    hotCodePush.apps.signingKeys.list({ appId, ...page }),
  );
}

// The key itself is shown only where no project file of the app took it.
export function printSigningKeyAdvice({
  isConfigured,
}: {
  isConfigured: boolean;
}): void {
  if (!isConfigured) {
    printNotice(
      `Add the public key to publicKeys in the app's ${PROJECT_CONFIG_FILE_NAME}.`,
    );
  }
  printNotice(
    "Uploads sign with the private key through --private-key-path. In CI, set HOTCODEPUSH_SIGNING_KEY to the file's content.",
  );
}

export function resolvePublicKeyRow({
  isConfigured,
  publicKey,
}: {
  isConfigured: boolean;
  publicKey: string;
}): Detail {
  return [
    'Public key',
    isConfigured
      ? `added to publicKeys in ${PROJECT_CONFIG_FILE_NAME}`
      : publicKey,
  ];
}
