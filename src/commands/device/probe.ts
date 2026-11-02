import type {
  Binary,
  Channel,
  Device,
  HotCodePush,
  ReleaseDeviceEvent,
} from '@hotcodepush/node';
import type {
  ChannelIndex,
  ChannelIndexEvaluation,
  DeviceInfo,
  IndexRelease,
  ReleaseVerdict,
} from '@hotcodepush/protocol';
import {
  ChannelIndexSchema,
  evaluateChannelIndex,
} from '@hotcodepush/protocol';
import { z } from 'zod';
import { fetchAppId } from '../../resources/apps.js';
import type { ChannelOptions } from '../../resources/channels/fetch.js';
import {
  channelOptionShape,
  fetchChannelId,
} from '../../resources/channels/fetch.js';
import { deviceOptionShape } from '../../resources/devices.js';
import { resolveAttributePairs } from '../../resources/releases/conditions.js';
import type { Platform } from '../../upload/upload.js';
import { PLATFORMS } from '../../upload/upload.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { printNotice } from '../../utils/diagnostics.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { resolveFilesBaseUrl } from '../../utils/hosts.js';
import { printDetails, printJson, printTable } from '../../utils/output.js';
import { fetchAllPages } from '../../utils/pagination.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { promptSelect, promptText } from '../../utils/prompts.js';
import { readApiUrl } from '../../utils/user-config.js';

interface BinaryIdentity {
  binaryBuild: string;
  binaryVersion: string;
  platform: Platform;
}

interface Probe {
  builtAt: string | null;
  channel: Channel;
  device: DeviceInfo;
  evaluation: ChannelIndexEvaluation | null;
  platform: Platform;
  servedIndex: ServedIndex;
  unknownFacts: UnknownFact[];
}

interface ProbeOptions extends ChannelOptions {
  attribute?: string[];
  binaryBuild?: string;
  binaryVersion?: string;
  device?: string;
  platform?: Platform;
}

interface ProbeTarget {
  appId: string;
  channel: Channel;
  fetchedDevice: Device | undefined;
}

interface ServedIndex {
  index: ChannelIndex | null;
  status: number;
  url: string;
}

// Without `--device`, the rollout bucket and OS version are unknown.
// The fingerprint is unknown when no binary was created with that identity.
type UnknownFact = 'fingerprint' | 'os' | 'rollout';

const INDEX_FETCH_TIMEOUT_MS = 30_000;

// No release is older than the binary, so a device without a created binary has no floor.
const NO_FLOOR = new Date(0).toISOString();

export default defineCommand({
  description:
    'Answer why a device did not update: fetch the live index as a device would, evaluate it and mark every condition of every release.',
  examples: [
    'hotcodepush device probe --platform ios --binary-version 2.4.1 --binary-build 57',
    'hotcodepush device probe --device 6b1e9d37-2f5c-4a80-9c46-d8e3a1f7b259 --json',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    ...deviceOptionShape,
    attribute: z
      .array(z.string())
      .optional()
      .describe('An attribute the app sets, key=value, repeatable.'),
    binaryBuild: z
      .string()
      .optional()
      .describe(
        "The store build's build number, CFBundleVersion or versionCode.",
      ),
    binaryVersion: z
      .string()
      .optional()
      .describe(
        "The store build's version, CFBundleShortVersionString or versionName.",
      ),
    platform: z
      .enum(PLATFORMS)
      .optional()
      .describe('The platform, ios or android.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const target = await fetchProbeTarget(hotCodePush, options);
    const identity = await promptBinaryIdentity(options, target.fetchedDevice);
    const binary = await fetchBinary(hotCodePush, {
      appId: target.appId,
      identity,
    });
    const servedIndex = await fetchServedIndex({
      appId: target.appId,
      channelId: target.channel.id,
      platform: identity.platform,
    });
    const unknownFacts = resolveUnknownFacts(target.fetchedDevice, binary);
    const device = await fetchDeviceInfo(hotCodePush, {
      binary,
      identity,
      options,
      servedIndex,
      target,
    });
    const probe: Probe = {
      builtAt: binary?.createdAt ?? null,
      channel: target.channel,
      device,
      evaluation:
        servedIndex.index === null
          ? null
          : evaluateKnownFacts(servedIndex.index, { device, unknownFacts }),
      platform: identity.platform,
      servedIndex,
      unknownFacts,
    };
    if (options.json) {
      printProbeJson(probe);
      return;
    }
    printProbe(probe);
  },
});

// Rollouts count as reached and conditions on unknown facts as passing, so only known facts decide.
function evaluateKnownFacts(
  index: ChannelIndex,
  { device, unknownFacts }: { device: DeviceInfo; unknownFacts: UnknownFact[] },
): ChannelIndexEvaluation {
  const releasesById = new Map(
    index.releases.map(release => [release.id, release]),
  );
  const knownIndex: ChannelIndex = {
    ...index,
    releases: index.releases.map(release => ({
      ...release,
      conditions: release.conditions.filter(
        ({ type }) => !(unknownFacts as string[]).includes(type),
      ),
      rolloutPercent: unknownFacts.includes('rollout')
        ? 100
        : release.rolloutPercent,
    })),
  };
  const { outcome, verdicts } = evaluateChannelIndex(knownIndex, device);
  const resolveServedRelease = (release: IndexRelease): IndexRelease =>
    releasesById.get(release.id) ?? release;
  return {
    outcome:
      outcome.release === null
        ? outcome
        : { ...outcome, release: resolveServedRelease(outcome.release) },
    verdicts: verdicts.map(verdict => ({
      ...verdict,
      release: resolveServedRelease(verdict.release),
    })),
  };
}

async function fetchBinary(
  hotCodePush: HotCodePush,
  { appId, identity }: { appId: string; identity: BinaryIdentity },
): Promise<Binary | undefined> {
  const binaries = await fetchAllPages(page =>
    hotCodePush.apps.binaries.list({ appId, ...page }),
  );
  return binaries.find(
    candidate =>
      candidate.platform === identity.platform &&
      candidate.version === identity.binaryVersion &&
      candidate.build === identity.binaryBuild,
  );
}

// The index may no longer carry the release, so its number then comes from the API.
async function fetchCurrentRelease(
  hotCodePush: HotCodePush,
  {
    fetchedDevice,
    servedIndex,
  }: { fetchedDevice: Device; servedIndex: ServedIndex },
): Promise<DeviceInfo['currentRelease']> {
  const releaseId = fetchedDevice.currentReleaseId;
  if (releaseId === null) {
    return null;
  }
  const indexRelease = servedIndex.index?.releases.find(
    ({ id }) => id === releaseId,
  );
  const number =
    indexRelease?.number ??
    (
      await hotCodePush.apps.releases.get({
        appId: fetchedDevice.appId,
        releaseId,
      })
    ).number;
  return { id: releaseId, number };
}

async function fetchDeviceHistory(
  hotCodePush: HotCodePush,
  {
    fetchedDevice,
    servedIndex,
  }: { fetchedDevice: Device; servedIndex: ServedIndex },
): Promise<Pick<DeviceInfo, 'currentRelease' | 'failedBundleIds'>> {
  return {
    currentRelease: await fetchCurrentRelease(hotCodePush, {
      fetchedDevice,
      servedIndex,
    }),
    failedBundleIds: await fetchFailedBundleIds(hotCodePush, {
      fetchedDevice,
      servedIndex,
    }),
  };
}

async function fetchDeviceInfo(
  hotCodePush: HotCodePush,
  {
    binary,
    identity,
    options,
    servedIndex,
    target: { fetchedDevice },
  }: {
    binary: Binary | undefined;
    identity: BinaryIdentity;
    options: ProbeOptions;
    servedIndex: ServedIndex;
    target: ProbeTarget;
  },
): Promise<DeviceInfo> {
  return {
    attributes: resolveDeviceAttributes(fetchedDevice, options.attribute),
    binaryBuild: identity.binaryBuild,
    binaryVersion: identity.binaryVersion,
    builtAt: binary?.createdAt ?? NO_FLOOR,
    ...(fetchedDevice === undefined
      ? { currentRelease: null, failedBundleIds: [] }
      : await fetchDeviceHistory(hotCodePush, { fetchedDevice, servedIndex })),
    ...resolveReportedFacts(fetchedDevice, binary),
  };
}

async function fetchFailedBundleIds(
  hotCodePush: HotCodePush,
  {
    fetchedDevice,
    servedIndex,
  }: { fetchedDevice: Device; servedIndex: ServedIndex },
): Promise<string[]> {
  const events = await fetchAllPages(page =>
    hotCodePush.apps.devices.events.list({
      appId: fetchedDevice.appId,
      deviceId: fetchedDevice.deviceId,
      ...page,
    }),
  );
  return resolveFailedBundleIds(events, servedIndex.index);
}

async function fetchProbeTarget(
  hotCodePush: HotCodePush,
  options: ProbeOptions,
): Promise<ProbeTarget> {
  const projectConfig = readProjectConfig(options.config);
  const appId = await fetchAppId(hotCodePush, { options, projectConfig });
  const fetchedDevice =
    options.device === undefined
      ? undefined
      : await hotCodePush.apps.devices.get({
          appId,
          deviceId: options.device,
        });
  const channel = await hotCodePush.apps.channels.get({
    appId,
    channelId: await fetchChannelId(hotCodePush, {
      appId,
      options: {
        ...options,
        channel: options.channel ?? fetchedDevice?.channelId ?? undefined,
      },
      projectConfig,
    }),
  });
  return { appId, channel, fetchedDevice };
}

// The same request a device makes.
async function fetchServedIndex({
  appId,
  channelId,
  platform,
}: {
  appId: string;
  channelId: string;
  platform: Platform;
}): Promise<ServedIndex> {
  const url = `${resolveFilesBaseUrl(readApiUrl())}/apps/${appId}/channels/${channelId}/${platform}/v1/index.json`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(INDEX_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    return { index: null, status: response.status, url };
  }
  return {
    index: ChannelIndexSchema.parse(await response.json()),
    status: response.status,
    url,
  };
}

function printProbe({
  channel,
  evaluation,
  platform,
  servedIndex,
  unknownFacts,
}: Probe): void {
  printDetails([
    ['Channel', `${channel.name}, ${platform}`],
    ['Index', resolveServedIndexText(servedIndex)],
    ['Outcome', evaluation === null ? 'none' : resolveOutcomeText(evaluation)],
    [
      'Unknown',
      unknownFacts.length === 0
        ? 'nothing'
        : `${unknownFacts.join(', ')}, treated as passing`,
    ],
  ]);
  if (evaluation !== null && servedIndex.index !== null) {
    console.log('');
    printTable({
      emptyText: 'The index offers no release.',
      headers: ['RELEASE', 'ROLLOUT', 'CONDITIONS', 'VERDICT'],
      nextOffset: null,
      rows: evaluation.verdicts.map(verdict => [
        `#${verdict.release.number}`,
        `${verdict.release.rolloutPercent}%`,
        resolveConditionsText(verdict, unknownFacts),
        resolveVerdictText(verdict),
      ]),
    });
  }
  if (unknownFacts.length > 0) {
    printNotice('Pass --device for the facts of a real device.');
  }
}

function printProbeJson({
  builtAt,
  channel,
  device,
  evaluation,
  platform,
  servedIndex,
  unknownFacts,
}: Probe): void {
  printJson({
    channelId: channel.id,
    device: { ...device, builtAt },
    outcome: evaluation?.outcome ?? null,
    platform,
    sequence: servedIndex.index?.sequence ?? null,
    status: servedIndex.status,
    unknownFacts,
    url: servedIndex.url,
    verdicts: evaluation?.verdicts ?? [],
  });
}

// A flag wins over the probed device, and a missing fact is asked for.
async function promptBinaryIdentity(
  options: ProbeOptions,
  fetchedDevice: Device | undefined,
): Promise<BinaryIdentity> {
  const platform =
    options.platform ??
    fetchedDevice?.platform ??
    (await promptSelect<Platform>(options, {
      choices: [
        { label: 'iOS', value: 'ios' },
        { label: 'Android', value: 'android' },
      ],
      flag: '--platform',
      message: 'Which platform?',
    }));
  const binaryVersion =
    options.binaryVersion ??
    fetchedDevice?.binaryVersion ??
    (await promptText(options, {
      flag: '--binary-version',
      message: 'Which app version?',
    }));
  const binaryBuild =
    options.binaryBuild ??
    fetchedDevice?.binaryBuild ??
    (await promptText(options, {
      flag: '--binary-build',
      message: 'Which build number?',
    }));
  return { binaryBuild, binaryVersion, platform };
}

function resolveConditionsText(
  verdict: ReleaseVerdict,
  unknownFacts: UnknownFact[],
): string {
  const knownVerdicts = [...verdict.conditions];
  const conditionTexts = verdict.release.conditions.map(({ type }) => {
    if ((unknownFacts as string[]).includes(type)) {
      return `${type} unknown`;
    }
    const conditionVerdict = knownVerdicts.shift();
    return `${type} ${conditionVerdict?.isSatisfied ? 'pass' : 'fail'}`;
  });
  return conditionTexts.join(', ') || 'none';
}

function resolveDeviceAttributes(
  fetchedDevice: Device | undefined,
  attribute: string[] | undefined,
): DeviceInfo['attributes'] {
  return {
    ...fetchedDevice?.attributes,
    ...Object.fromEntries(
      resolveAttributePairs(attribute).map(({ key, value }) => [key, value]),
    ),
  };
}

function resolveFailedBundleIds(
  events: readonly ReleaseDeviceEvent[],
  index: ChannelIndex | null,
): string[] {
  const failedReleaseIds = new Set(
    events
      .filter(({ type }) => type === 'failed')
      .map(({ releaseId }) => releaseId),
  );
  return (index?.releases ?? [])
    .filter(({ id }) => failedReleaseIds.has(id))
    .map(({ bundleId }) => bundleId);
}

function resolveOutcomeText({ outcome }: ChannelIndexEvaluation): string {
  const releaseText =
    outcome.release === null
      ? 'the embedded bundle'
      : `release #${outcome.release.number}`;
  switch (outcome.status) {
    case 'available':
      return `available, ${releaseText}${outcome.isMandatory ? ', mandatory' : ''}`;
    case 'skipped':
      return `skipped, ${outcome.reason}${outcome.conditionType === undefined ? '' : ` (${outcome.conditionType})`}, ${releaseText}`;
    case 'up_to_date':
      return `up_to_date, ${releaseText}`;
  }
}

// Without a probed device, the binary's fingerprint stands in for the device's.
function resolveReportedFacts(
  fetchedDevice: Device | undefined,
  binary: Binary | undefined,
): Pick<DeviceInfo, 'deviceId' | 'fingerprint' | 'osVersion' | 'reportedAt'> {
  const binaryFingerprint = binary?.fingerprint ?? null;
  if (fetchedDevice === undefined) {
    return {
      deviceId: '',
      fingerprint: binaryFingerprint,
      osVersion: '',
      reportedAt: null,
    };
  }
  return {
    deviceId: fetchedDevice.deviceId,
    fingerprint: fetchedDevice.fingerprint ?? binaryFingerprint,
    osVersion: fetchedDevice.osVersion,
    reportedAt: fetchedDevice.lastSeenAt,
  };
}

// The index sequence is the publish time in milliseconds.
function resolveServedIndexText({ index, status, url }: ServedIndex): string {
  return index === null
    ? `none: HTTP ${status} at ${url}, so a device gets no release`
    : `published ${new Date(index.sequence).toISOString()}`;
}

function resolveUnknownFacts(
  fetchedDevice: Device | undefined,
  binary: Binary | undefined,
): UnknownFact[] {
  if (fetchedDevice !== undefined) {
    return [];
  }
  return binary?.fingerprint === undefined || binary.fingerprint === null
    ? ['fingerprint', 'os', 'rollout']
    : ['os', 'rollout'];
}

function resolveVerdictText(verdict: ReleaseVerdict): string {
  if (verdict.isEligible) {
    return 'eligible';
  }
  return `${verdict.reason ?? 'skipped'}${verdict.conditionType === undefined ? '' : ` (${verdict.conditionType})`}`;
}
