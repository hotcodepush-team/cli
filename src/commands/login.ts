import { z } from 'zod';
import { defineCommand } from '../utils/command.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { logIn } from '../utils/login.js';
import { printJson } from '../utils/output.js';
import { readUserConfig, writeUserConfig } from '../utils/user-config.js';

export default defineCommand({
  description: 'Log in by approving a one-time code in the browser.',
  authentication: 'optional',
  examples: [
    'hotcodepush login',
    'hotcodepush login --api-url https://api.example.com --json',
  ],
  options: defineCommandOptions({
    apiUrl: z
      .url({
        error:
          'Expected an absolute http or https URL such as https://api.example.com',
        protocol: z.regexes.httpProtocol,
      })
      .transform(apiUrl => apiUrl.replace(/\/+$/, ''))
      .optional()
      .describe(
        'The API to log in to, kept in config.json for every later command. Defaults to the one kept there.',
      ),
  }),
  action: async options => {
    if (options.apiUrl !== undefined) {
      writeUserConfig({ ...readUserConfig(), apiUrl: options.apiUrl });
    }
    const user = await logIn(options);
    if (options.json) {
      printJson({ user });
    } else {
      console.log(`Logged in as ${user.name} (${user.email}).`);
    }
  },
});
