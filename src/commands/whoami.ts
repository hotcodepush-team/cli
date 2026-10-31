import { defineCommand } from 'zodline';
import { DEFAULT_API_URL } from '../config/consts.js';
import {
  fetchCurrentUser,
  resolveCredentialText,
} from '../utils/credential.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { printJson } from '../utils/output.js';
import { isEnvironmentToken } from '../utils/token-store.js';
import { readApiUrl } from '../utils/user-config.js';

export default defineCommand({
  description:
    'Print the user you are logged in as, or the one HOTCODEPUSH_TOKEN stands for.',
  examples: ['hotcodepush whoami', 'hotcodepush whoami --json'],
  options: defineCommandOptions({}),
  action: async options => {
    const user = await fetchCurrentUser();
    const apiUrl = readApiUrl();
    if (options.json) {
      printJson({ apiUrl, user });
      return;
    }
    console.log(resolveCredentialText(user, isEnvironmentToken()));
    if (apiUrl !== DEFAULT_API_URL) {
      console.log(`API: ${apiUrl}`);
    }
  },
});
