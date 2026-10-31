import type {
  App,
  Channel,
  HotCodePush,
  Organization,
  SigningKey,
} from '@hotcodepush/node';
import { z } from 'zod';
import { PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';
import type { InteractivityOptions } from './environment.js';
import { isInteractive } from './environment.js';
import {
  AmbiguousNameError,
  MissingParameterError,
  UnknownNameError,
} from './errors.js';
import { fetchAllPages } from './pagination.js';
import type { ProjectConfig } from './project-config.js';
import {
  assertProjectConfigAppId,
  ID_SCHEMA,
  readProjectConfig,
  resolveProjectChannel,
} from './project-config.js';
import { promptSelect } from './prompts.js';

interface AppOptions extends OrganizationOptions {
  app?: string;
}

export interface ChannelOptions extends AppOptions {
  channel?: string;
  config?: string;
}

interface NamedResource {
  id: string;
  name: string;
}

interface OrganizationOptions extends InteractivityOptions {
  organization?: string;
}

export const channelOptionShape = {
  channel: z
    .string()
    .optional()
    .describe(
      "The channel, by id or name; hotcodepush.json's channel by default.",
    ),
};

// A name is looked up in `--organization` when given, otherwise in every organization of the user.
export async function fetchAppId(
  hotCodePush: HotCodePush,
  options: AppOptions,
  projectConfig: ProjectConfig | undefined,
): Promise<string> {
  if (options.app !== undefined) {
    return fetchResourceId('app', options.app, () =>
      fetchAppsInScope(hotCodePush, options.organization),
    );
  }
  if (projectConfig?.appId !== undefined) {
    assertProjectConfigAppId(projectConfig.appId);
    return projectConfig.appId;
  }
  if (!isInteractive(options)) {
    throw new MissingParameterError('--app');
  }
  const organizationId = await fetchOrganizationId(hotCodePush, options);
  return promptResourceId(
    'app',
    await fetchApps(hotCodePush, organizationId),
    options,
  );
}

export function fetchApps(
  hotCodePush: HotCodePush,
  organizationId: string,
): Promise<App[]> {
  return fetchAllPages(page =>
    hotCodePush.organizations.apps.list({ organizationId, ...page }),
  );
}

export async function fetchChannel(
  hotCodePush: HotCodePush,
  options: ChannelOptions,
): Promise<Channel> {
  const projectConfig = readProjectConfig(options.config);
  const appId = await fetchAppId(hotCodePush, options, projectConfig);
  const channelId = await fetchChannelId(
    hotCodePush,
    appId,
    options,
    projectConfig,
  );
  return hotCodePush.apps.channels.get({ appId, channelId });
}

// The channel of hotcodepush.json counts only when the app is the one of the file too.
export async function fetchChannelId(
  hotCodePush: HotCodePush,
  appId: string,
  options: ChannelOptions,
  projectConfig: ProjectConfig | undefined,
): Promise<string> {
  if (options.channel !== undefined) {
    return fetchResourceId('channel', options.channel, () =>
      fetchChannels(hotCodePush, appId),
    );
  }
  if (projectConfig !== undefined && projectConfig.appId === appId) {
    return fetchResourceId(
      'channel',
      resolveProjectChannel(projectConfig),
      () => fetchChannels(hotCodePush, appId),
      PROJECT_CONFIG_FILE_NAME,
    );
  }
  if (!isInteractive(options)) {
    throw new MissingParameterError('--channel');
  }
  return promptResourceId(
    'channel',
    await fetchChannels(hotCodePush, appId),
    options,
  );
}

export function fetchChannels(
  hotCodePush: HotCodePush,
  appId: string,
): Promise<Channel[]> {
  return fetchAllPages(page =>
    hotCodePush.apps.channels.list({ appId, ...page }),
  );
}

export async function fetchOrganizationId(
  hotCodePush: HotCodePush,
  options: OrganizationOptions,
): Promise<string> {
  if (options.organization !== undefined) {
    return fetchResourceId('organization', options.organization, () =>
      fetchOrganizations(hotCodePush),
    );
  }
  const fetchedOrganizations = await fetchOrganizations(hotCodePush);
  const [onlyOrganization] = fetchedOrganizations;
  if (onlyOrganization !== undefined && fetchedOrganizations.length === 1) {
    return onlyOrganization.id;
  }
  return promptResourceId('organization', fetchedOrganizations, options);
}

export function fetchOrganizations(
  hotCodePush: HotCodePush,
): Promise<Organization[]> {
  return fetchAllPages(page => hotCodePush.organizations.list(page));
}

// A UUID is an id, and anything else is a name looked up in the list.
export async function fetchResourceId(
  noun: string,
  reference: string,
  fetchResources: () => Promise<NamedResource[]>,
  source = `--${noun}`,
): Promise<string> {
  if (ID_SCHEMA.safeParse(reference).success) {
    return reference;
  }
  return resolveNamedResource(noun, reference, await fetchResources(), source)
    .id;
}

// An app with a signing key releases only signed bundles.
export async function fetchHasSigningKey(
  hotCodePush: HotCodePush,
  appId: string,
): Promise<boolean> {
  const { count } = await hotCodePush.apps.signingKeys.count({ appId });
  return count > 0;
}

export function fetchSigningKeys(
  hotCodePush: HotCodePush,
  appId: string,
): Promise<SigningKey[]> {
  return fetchAllPages(page =>
    hotCodePush.apps.signingKeys.list({ appId, ...page }),
  );
}

export function promptResourceId(
  noun: string,
  resources: NamedResource[],
  options: InteractivityOptions,
): Promise<string> {
  return promptSelect(
    `--${noun}`,
    `Which ${noun}?`,
    resources.map(({ id, name }) => ({ label: name, value: id })),
    options,
  );
}

// Case-insensitive, as the API keeps app and channel names unique that way.
export function resolveNamedResource<TResource extends NamedResource>(
  noun: string,
  name: string,
  resources: TResource[],
  source = `--${noun}`,
): TResource {
  const namedResources = resources.filter(
    resource => resource.name.toLowerCase() === name.toLowerCase(),
  );
  const [namedResource] = namedResources;
  if (namedResource === undefined) {
    throw new UnknownNameError(noun, name, source);
  }
  if (namedResources.length > 1) {
    throw new AmbiguousNameError(noun, name, source);
  }
  return namedResource;
}

async function fetchAppsInScope(
  hotCodePush: HotCodePush,
  organization: string | undefined,
): Promise<App[]> {
  const organizationIds =
    organization === undefined
      ? (await fetchOrganizations(hotCodePush)).map(({ id }) => id)
      : [
          await fetchResourceId('organization', organization, () =>
            fetchOrganizations(hotCodePush),
          ),
        ];
  const fetchedApps = await Promise.all(
    organizationIds.map(organizationId =>
      fetchApps(hotCodePush, organizationId),
    ),
  );
  return fetchedApps.flat();
}
