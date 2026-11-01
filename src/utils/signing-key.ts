import { PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';
import type { ProjectConfigLocation } from './project-config.js';
import { writeProjectConfig } from './project-config.js';

export const UPLOAD_SIGNING_TEXT =
  "Uploads sign with it through --private-key-path. In CI, set HOTCODEPUSH_SIGNING_KEY to the file's content.";

// Keys already listed stay, so the next builds keep trusting them.
// A file of another app, or no file, is left alone.
export function addPublicKeyToProjectConfig(
  { filePath, projectConfig }: ProjectConfigLocation,
  appId: string,
  publicKey: string,
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

export function resolvePublicKeyListingText(
  isConfigured: boolean,
  publicKey: string,
): string {
  return isConfigured
    ? `Added to publicKeys in ${PROJECT_CONFIG_FILE_NAME}.`
    : `Add it to publicKeys in the app's ${PROJECT_CONFIG_FILE_NAME}: ${publicKey}`;
}
