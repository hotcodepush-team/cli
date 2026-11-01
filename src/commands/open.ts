import { fetchAppId } from '../resources/app.js';
import {
  channelOptionShape,
  fetchChannel,
} from '../resources/channel/fetch.js';
import { createApiClient } from '../utils/api-client.js';
import { openBrowser } from '../utils/browser.js';
import { defineCommand } from '../utils/command.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { resolveConsoleBaseUrl } from '../utils/hosts.js';
import { printJson } from '../utils/output.js';
import {
  assertProjectConfigAppId,
  readProjectConfig,
} from '../utils/project-config.js';
import { readApiUrl } from '../utils/user-config.js';

export default defineCommand({
  description:
    "Open the app's console page in the browser, or the channel's, from hotcodepush.json.",
  examples: ['hotcodepush open', 'hotcodepush open --channel staging'],
  options: defineCommandOptions(channelOptionShape),
  action: async options => {
    const url = await fetchConsolePageUrl(options);
    if (options.json) {
      printJson({ url });
      return;
    }
    console.log(`Opening ${url}`);
    await openBrowser(url);
  },
});

async function fetchConsolePageUrl(options: {
  app?: string;
  channel?: string;
  config?: string;
  organization?: string;
}): Promise<string> {
  const consoleBaseUrl = resolveConsoleBaseUrl(readApiUrl());
  if (options.channel !== undefined) {
    const channel = await fetchChannel(createApiClient(), options);
    return `${consoleBaseUrl}/apps/${channel.appId}/channels/${channel.id}`;
  }
  const projectConfig = readProjectConfig(options.config);
  if (options.app === undefined && projectConfig?.appId !== undefined) {
    assertProjectConfigAppId(projectConfig.appId);
    return `${consoleBaseUrl}/apps/${projectConfig.appId}`;
  }
  const appId = await fetchAppId(createApiClient(), options, projectConfig);
  return `${consoleBaseUrl}/apps/${appId}`;
}
