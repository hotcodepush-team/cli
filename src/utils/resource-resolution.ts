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

interface SigningKeyOptions extends InteractivityOptions {
  signingKey?: string;
}

export const channelOptionShape = {
  channel: z
    .string()
    .optional()
    .describe(
      "The channel, by id or name. Defaults to hotcodepush.json's channel.",
    ),
};

// A name is looked up in `--organization` when given, otherwise in every organization of the user.
export async function fetchAppId(
  hotCodePush: HotCodePush,
  options: AppOptions,
  projectConfig: ProjectConfig | undefined,
): Promise<string> {
  if (options.app === undefined && projectConfig?.appId !== undefined) {
    assertProjectConfigAppId(projectConfig.appId);
    return projectConfig.appId;
  }
  return fetchOrPromptResourceId({
    fetchResources:
      options.app === undefined
        ? async () =>
            fetchApps(
              hotCodePush,
              await fetchOrganizationId(hotCodePush, options),
            )
        : () => fetchAppsInScope(hotCodePush, options.organization),
    noun: 'app',
    options,
    reference: options.app,
  });
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
  if (options.channel === undefined && projectConfig?.appId === appId) {
    return fetchResourceId(
      'channel',
      resolveProjectChannel(projectConfig),
      () => fetchChannels(hotCodePush, appId),
      PROJECT_CONFIG_FILE_NAME,
    );
  }
  return fetchOrPromptResourceId({
    fetchResources: () => fetchChannels(hotCodePush, appId),
    noun: 'channel',
    options,
    reference: options.channel,
  });
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

// Without a reference, a person picks from the list, and a pipeline fails on the missing flag.
export async function fetchOrPromptResourceId({
  fetchResources,
  noun,
  options,
  reference,
}: {
  fetchResources: () => Promise<NamedResource[]>;
  noun: string;
  options: InteractivityOptions;
  reference: string | undefined;
}): Promise<string> {
  if (reference !== undefined) {
    return fetchResourceId(noun, reference, fetchResources);
  }
  if (!isInteractive(options)) {
    throw new MissingParameterError(`--${noun}`);
  }
  return promptResourceId(noun, await fetchResources(), options);
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

// A signing key is named by its key id.
export async function fetchSigningKey(
  hotCodePush: HotCodePush,
  appId: string,
  options: SigningKeyOptions,
): Promise<SigningKey> {
  const namedSigningKeys = (await fetchSigningKeys(hotCodePush, appId)).map(
    signingKey => ({ ...signingKey, name: signingKey.keyId }),
  );
  const reference =
    options.signingKey ??
    (await promptResourceId('signing-key', namedSigningKeys, options));
  return resolveResource('signing-key', reference, namedSigningKeys);
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

// A UUID is an id and anything else a name, both looked up in the list.
export function findResource<TResource extends NamedResource>(
  noun: string,
  reference: string,
  resources: TResource[],
): TResource | undefined {
  return ID_SCHEMA.safeParse(reference).success
    ? resources.find(({ id }) => id === reference)
    : findNamedResource(noun, reference, resources, `--${noun}`);
}

export function resolveNamedResource<TResource extends NamedResource>(
  noun: string,
  name: string,
  resources: TResource[],
  source = `--${noun}`,
): TResource {
  const namedResource = findNamedResource(noun, name, resources, source);
  if (namedResource === undefined) {
    throw new UnknownNameError(noun, name, source);
  }
  return namedResource;
}

export function resolveResource<TResource extends NamedResource>(
  noun: string,
  reference: string,
  resources: TResource[],
): TResource {
  const resource = findResource(noun, reference, resources);
  if (resource === undefined) {
    throw new UnknownNameError(noun, reference);
  }
  return resource;
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

// Case-insensitive, as the API keeps app and channel names unique that way.
function findNamedResource<TResource extends NamedResource>(
  noun: string,
  name: string,
  resources: TResource[],
  source: string,
): TResource | undefined {
  const namedResources = resources.filter(
    resource => resource.name.toLowerCase() === name.toLowerCase(),
  );
  if (namedResources.length > 1) {
    throw new AmbiguousNameError(noun, name, source);
  }
  return namedResources[0];
}
