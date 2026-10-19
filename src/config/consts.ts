import { createRequire } from 'node:module';
import type { CliMeta } from '../utils/cli.js';

/**
 * The CLI's package.json: the meta zodline prints, and the telemetry keys the release build writes from the repository's
 * variables, empty in every other build, so telemetry is off there.
 */
interface CliPackageJson extends CliMeta {
  telemetry?: {
    posthogProjectKey?: string;
    sentryDsn?: string;
  };
}

// An SDK is installed from the pkg.pr.new build of one commit until its package is published; a bump is one edit of the sha
export const CAPACITOR_PACKAGE_NAME = '@hotcodepush/capacitor-live-updates';
export const CAPACITOR_PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/capacitor-live-updates/@hotcodepush/capacitor-live-updates@6a114c3';
export const CLI_CLIENT_ID = 'hotcodepush-cli';
export const CORDOVA_PACKAGE_NAME = '@hotcodepush/cordova-code-push';
export const CORDOVA_PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/cordova-code-push/@hotcodepush/cordova-code-push@1ac0ad5';
export const CLIENT_HEADER_NAME = 'X-HotCodePush-Client';
export const CONFIG_DIRECTORY_NAME = 'hotcodepush';
export const CONFIG_FILE_NAME = 'config.json';
export const DEFAULT_API_URL = 'https://api.hotcodepush.com';
export const DOCS_URL = 'https://hotcodepush.com/docs';
export const ERRORS_DOCS_URL = 'https://hotcodepush.com/docs/cli/errors';
export const EXPO_PACKAGE_NAME = '@hotcodepush/expo-ota-updates';
export const EXPO_PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/expo-ota-updates/@hotcodepush/expo-ota-updates@131e739';
export const INIT_MANUAL_STEP = 'Run "hotcodepush init".';
export const ISSUES_URL = 'https://github.com/hotcodepush-team/cli/issues';
export const KEYRING_ACCOUNT_NAME = 'token';
export const KEYRING_SERVICE_NAME = 'hotcodepush-cli';
export const PACKAGE_JSON: CliPackageJson = createRequire(import.meta.url)(
  '../../package.json',
);
// our reverse proxy to PostHog's EU host
export const POSTHOG_HOST = 'https://hotcodepush.com/ingest';
export const POSTHOG_PROJECT_KEY =
  PACKAGE_JSON.telemetry?.posthogProjectKey ?? '';
export const PROJECT_CONFIG_FILE_NAME = 'hotcodepush.json';
export const REACT_NATIVE_PACKAGE_NAME = '@hotcodepush/react-native-code-push';
export const REACT_NATIVE_PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/react-native-code-push/@hotcodepush/react-native-code-push@0e0a90b';
export const SENTRY_DSN = PACKAGE_JSON.telemetry?.sentryDsn ?? '';
export const SIGNING_PRIVATE_KEY_FILE_NAME = 'hotcodepush-private-key.pem';
export const USER_AGENT = `hotcodepush-cli/${PACKAGE_JSON.version}`;
