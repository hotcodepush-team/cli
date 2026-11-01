import type { App, HotCodePush } from '@hotcodepush/node';
import { fetchAllPages } from '../utils/pagination.js';
import type { ProjectConfig } from '../utils/project-config.js';
import { assertProjectConfigAppId } from '../utils/project-config.js';
import {
  fetchOrPromptResourceId,
  fetchResourceId,
} from '../utils/resources.js';
import type { OrganizationOptions } from './organizations.js';
import { fetchOrganizationId, fetchOrganizations } from './organizations.js';

export interface AppOptions extends OrganizationOptions {
  app?: string;
}

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
