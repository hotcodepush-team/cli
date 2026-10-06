import type { Binary, DeviceWithMarks, HotCodePush } from '@hotcodepush/node';
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
  stringifyCanonicalJson,
} from '@hotcodepush/protocol';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { deviceOptionShape } from '../../utils/device-resolution.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { resolveFilesBaseUrl } from '../../utils/hosts.js';
import { printDetails, printJson, printTable } from '../../utils/output.js';
import { fetchAllPages } from '../../utils/pagination.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { promptSelect, promptText } from '../../utils/prompts.js';
import { resolveAttributePairs } from '../../utils/release-conditions.js';
import {
  channelOptionShape,
  fetchAppId,
  fetchChannel,
} from '../../utils/resource-resolution.js';
import type { Platform } from '../../utils/upload.js';
import { readApiUrl } from '../../utils/user-config.js';

/**
 * The index the files host serves, as a device fetches it: its status and ETag, and the index when it serves one.
 */
interface ServedIndex {
  etag: string | null;
  index: ChannelIndex | null;
  status: number;
  url: string;
}

/**
 * The facts a device without `--device` cannot supply: its rollout bucket and OS version always,
 * its fingerprint when no store build is registered with its identity.
 */
type UnknownFact = 'fingerprint' | 'os' | 'rollout';

const INDEX_FETCH_TIMEOUT_MS = 30_000;

/** The floor a device without a registered store build evaluates from: no release is older than its binary. */
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
      .enum(['android', 'ios'])
      .optional()
      .describe('The platform, ios or android.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const appId = await fetchAppId(
      hotCodePush,
      options,
      readProjectConfig(options.config),
    );
    const registryDevice =
      options.device === undefined
        ? undefined
        : await hotCodePush.apps.devices.get({
            appId,
            deviceId: options.device,
          });
    const channel = await fetchChannel(hotCodePush, {
      ...options,
      channel: options.channel ?? registryDevice?.channelId ?? undefined,
    });
    const platform =
      options.platform ??
      registryDevice?.platform ??
      (await promptSelect<Platform>(
        '--platform',
        'Which platform?',
        [
          { label: 'iOS', value: 'ios' },
          { label: 'Android', value: 'android' },
        ],
        options,
      ));
    const binaryVersion =
      options.binaryVersion ??
      registryDevice?.binaryVersion ??
      (await promptText('--binary-version', 'Which app version?', options));
    const binaryBuild =
      options.binaryBuild ??
      registryDevice?.binaryBuild ??
      (await promptText('--binary-build', 'Which build number?', options));
    const binary = (
      await fetchAllPages(page =>
        hotCodePush.apps.binaries.list({ appId, ...page }),
      )
    ).find(
      candidate =>
        candidate.platform === platform &&
        candidate.version === binaryVersion &&
        candidate.build === binaryBuild,
    );
    const [servedIndex, databaseIndex] = await Promise.all([
      fetchServedIndex(appId, channel.id, platform),
      hotCodePush.apps.channels.indexes.get({
        appId,
        channelId: channel.id,
        platform,
      }),
    ]);
    const isServedIndexCurrent =
      servedIndex.index !== null &&
      stringifyCanonicalJson(servedIndex.index) ===
        stringifyCanonicalJson(databaseIndex);
    const unknownFacts = resolveUnknownFacts(registryDevice, binary);
    const device: DeviceInfo = {
      appliedIndexSequence: null,
      attributes: {
        ...registryDevice?.attributes,
        ...Object.fromEntries(
          resolveAttributePairs(options.attribute).map(({ key, value }) => [
            key,
            value,
          ]),
        ),
      },
      binaryBuild,
      binaryVersion,
      builtAt: binary?.createdAt ?? NO_FLOOR,
      currentRelease:
        registryDevice === undefined
          ? null
          : await fetchCurrentRelease(hotCodePush, registryDevice, servedIndex),
      deviceId: registryDevice?.id ?? '',
      failedBundleIds:
        registryDevice === undefined
          ? []
          : resolveFailedBundleIds(registryDevice, servedIndex.index),
      fingerprint: registryDevice?.fingerprint ?? binary?.fingerprint ?? null,
      osVersion: registryDevice?.osVersion ?? '',
      reportedAt: registryDevice?.lastSeenAt ?? null,
    };
    const evaluation =
      servedIndex.index === null
        ? null
        : evaluateKnownFacts(servedIndex.index, device, unknownFacts);
    if (options.json) {
      printJson({
        channelId: channel.id,
        device,
        etag: servedIndex.etag,
        isServedIndexCurrent,
        outcome: evaluation?.outcome ?? null,
        platform,
        sequence: servedIndex.index?.sequence ?? null,
        status: servedIndex.status,
        unknownFacts,
        url: servedIndex.url,
        verdicts: evaluation?.verdicts ?? [],
      });
      return;
    }
    printDetails([
      ['Channel', `${channel.name}, ${platform}`],
      ['Index', resolveServedIndexText(servedIndex)],
      [
        'Database',
        resolveDatabaseText(isServedIndexCurrent, databaseIndex.sequence),
      ],
      [
        'Outcome',
        evaluation === null ? 'none' : resolveOutcomeText(evaluation),
      ],
      [
        'Unknown',
        unknownFacts.length === 0
          ? 'nothing'
          : `${unknownFacts.join(', ')}, treated as passing; pass --device for the facts of a real device`,
      ],
    ]);
    if (evaluation !== null && servedIndex.index !== null) {
      printTable({
        emptyText: 'The index offers no release.',
        headers: ['RELEASE', 'ROLLOUT', 'CONDITIONS', 'VERDICT'],
        nextOffset: null,
        rows: evaluation.verdicts.map(verdict => [
          `#${verdict.release.number}`,
          `${verdict.release.rollout}%`,
          resolveConditionsText(verdict, unknownFacts),
          verdict.isEligible
            ? 'eligible'
            : `${verdict.reason ?? 'skipped'}${verdict.condition === undefined ? '' : ` (${verdict.condition})`}`,
        ]),
      });
    }
  },
});

/**
 * The release the registry row says the device runs, with its number from the index or, when the index no longer
 * carries it, from the API.
 */
async function fetchCurrentRelease(
  hotCodePush: HotCodePush,
  registryDevice: DeviceWithMarks,
  servedIndex: ServedIndex,
): Promise<DeviceInfo['currentRelease']> {
  const releaseId = registryDevice.currentReleaseId;
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
        appId: registryDevice.appId,
        releaseId,
      })
    ).number;
  return { id: releaseId, number };
}

/**
 * The channel's index from the files host, the request a device makes; a device holding no ETag sends no
 * `If-None-Match`, and the ETag answered is the one it would send next.
 */
async function fetchServedIndex(
  appId: string,
  channelId: string,
  platform: Platform,
): Promise<ServedIndex> {
  const url = `${resolveFilesBaseUrl(readApiUrl())}/apps/${appId}/channels/${channelId}/${platform}/v1/index.json`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(INDEX_FETCH_TIMEOUT_MS),
  });
  const etag = response.headers.get('ETag');
  if (!response.ok) {
    await response.body?.cancel();
    return { etag, index: null, status: response.status, url };
  }
  return {
    etag,
    index: ChannelIndexSchema.parse(await response.json()),
    status: response.status,
    url,
  };
}

/**
 * The evaluator's answer over the facts the probe knows: a release's rollout counts as reached and its conditions
 * of an unknown fact as passing, so only what is known decides; the verdicts carry the releases as served.
 */
function evaluateKnownFacts(
  index: ChannelIndex,
  device: DeviceInfo,
  unknownFacts: UnknownFact[],
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
      rollout: unknownFacts.includes('rollout') ? 100 : release.rollout,
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

/**
 * Every condition of the release, marked pass or fail by the evaluator, or unknown when the probe lacks the fact.
 */
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

/**
 * The bundles the device failed before, from its failed marks of the releases the index carries.
 */
function resolveFailedBundleIds(
  registryDevice: DeviceWithMarks,
  index: ChannelIndex | null,
): string[] {
  const failedReleaseIds = new Set(
    registryDevice.marks
      .filter(({ kind }) => kind === 'failed')
      .map(({ releaseId }) => releaseId),
  );
  return (index?.releases ?? [])
    .filter(({ id }) => failedReleaseIds.has(id))
    .map(({ bundleId }) => bundleId);
}

/**
 * Whether the files host serves what the database yields: a drifted copy is rewritten by the daily verifier.
 */
function resolveDatabaseText(
  isServedIndexCurrent: boolean,
  databaseSequence: number,
): string {
  return isServedIndexCurrent
    ? 'the files host serves the current index'
    : `the files host does not serve the database's index, sequence ${databaseSequence}; the daily verifier rewrites a drifted channel`;
}

function resolveOutcomeText({ outcome }: ChannelIndexEvaluation): string {
  const releaseText =
    outcome.release === null
      ? 'the embedded bundle'
      : `release #${outcome.release.number}`;
  switch (outcome.status) {
    case 'AVAILABLE':
      return `AVAILABLE, ${releaseText}${outcome.isMandatory ? ', mandatory' : ''}`;
    case 'SKIPPED':
      return `SKIPPED, ${outcome.reason}${outcome.condition === undefined ? '' : ` (${outcome.condition})`}, ${releaseText}`;
    case 'UP_TO_DATE':
      return `UP_TO_DATE, ${releaseText}`;
  }
}

function resolveServedIndexText({
  etag,
  index,
  status,
  url,
}: ServedIndex): string {
  return index === null
    ? `the files host answered ${status} at ${url}; a device gets no release`
    : `sequence ${index.sequence}, ETag ${etag ?? 'none'}`;
}

function resolveUnknownFacts(
  registryDevice: DeviceWithMarks | undefined,
  binary: Binary | undefined,
): UnknownFact[] {
  if (registryDevice !== undefined) {
    return [];
  }
  return binary?.fingerprint === undefined || binary.fingerprint === null
    ? ['fingerprint', 'os', 'rollout']
    : ['os', 'rollout'];
}
