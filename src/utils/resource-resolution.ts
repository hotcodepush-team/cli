import type {
  App,
  Channel,
  ChannelWithDeviceCounts,
  HotCodePush,
  Organization,
} from '@hotcodepush/node';
import { z } from 'zod';
import type { InteractivityOptions } from './environment.js';
import { isInteractive } from './environment.js';
import {
  AmbiguousNameError,
  MissingParameterError,
  UnknownNameError,
} from './errors.js';
import { fetchAllPages } from './pagination.js';
import type { ProjectConfig } from './project-config.js';
import { assertProjectConfigId, readProjectConfig } from './project-config.js';
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

const ID_SCHEMA = z.guid();

export const channelOptionShape = {
  channel: z
    .string()
    .optional()
    .describe(
      "The channel, by id or name; hotcodepush.json's channelId by default.",
    ),
};

/**
 * The app a command acts on: `--app`, otherwise `hotcodepush.json`'s, otherwise a picker when interactive.
 * A name is looked up among the apps of `--organization` when it is given, otherwise of every organization of the user's.
 */
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
    assertProjectConfigId('appId', projectConfig.appId);
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

/**
 * The channel a command acts on, with its app and the header numbers, from `--app`, `--channel` and `hotcodepush.json`.
 */
export async function fetchChannel(
  hotCodePush: HotCodePush,
  options: ChannelOptions,
): Promise<ChannelWithDeviceCounts> {
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

export function fetchChannels(
  hotCodePush: HotCodePush,
  appId: string,
): Promise<Channel[]> {
  return fetchAllPages(page =>
    hotCodePush.apps.channels.list({ appId, ...page }),
  );
}

/**
 * The organization a command runs in: `--organization`, otherwise the user's only one, otherwise a picker when interactive.
 */
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

/**
 * A resource named in its flag, told apart by shape: a UUID is its id, anything else a name looked up in the list.
 */
export async function fetchResourceId(
  noun: string,
  reference: string,
  fetchResources: () => Promise<NamedResource[]>,
): Promise<string> {
  if (ID_SCHEMA.safeParse(reference).success) {
    return reference;
  }
  return resolveNamedResource(noun, reference, await fetchResources()).id;
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

/**
 * The resource carrying the name, compared case-insensitively as the API keeps app and channel names unique.
 */
export function resolveNamedResource<TResource extends NamedResource>(
  noun: string,
  name: string,
  resources: TResource[],
): TResource {
  const namedResources = resources.filter(
    resource => resource.name.toLowerCase() === name.toLowerCase(),
  );
  const [namedResource] = namedResources;
  if (namedResource === undefined) {
    throw new UnknownNameError(noun, name);
  }
  if (namedResources.length > 1) {
    throw new AmbiguousNameError(noun, name);
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

/**
 * The channel of `--channel`, otherwise `hotcodepush.json`'s when the app is the file's too, otherwise a picker when interactive.
 */
async function fetchChannelId(
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
  if (projectConfig?.channelId !== undefined && projectConfig.appId === appId) {
    assertProjectConfigId('channelId', projectConfig.channelId);
    return projectConfig.channelId;
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
