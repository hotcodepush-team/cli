import type {
  App,
  Bundle,
  Channel,
  EmbeddedBundle,
  ChannelWithDeviceCounts,
  Organization,
} from '@hotcodepush/node';

export const ACME_ORGANIZATION: Organization = {
  createdAt: '2026-09-01T08:00:00.000Z',
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'Acme',
  plan: 'free',
  region: 'eu',
  role: 'owner',
  updatedAt: '2026-09-01T08:00:00.000Z',
};

export const GLOBEX_ORGANIZATION: Organization = {
  createdAt: '2026-09-02T08:00:00.000Z',
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Globex',
  plan: 'pay_as_you_go',
  region: 'eu',
  role: 'admin',
  updatedAt: '2026-09-02T08:00:00.000Z',
};

export const PRODUCTION_CHANNEL: Channel = {
  appId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  createdAt: '2026-09-03T08:00:00.000Z',
  expiresAt: null,
  failureAction: null,
  failureMinSample: null,
  failureThresholdPercent: null,
  id: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
  isDiscoverable: false,
  isProtected: true,
  name: 'production',
  pausedAt: null,
  updatedAt: '2026-09-03T08:00:00.000Z',
};

export const DEMO_APP: App = {
  channelLinkTemplate: null,
  createdAt: '2026-09-03T08:00:00.000Z',
  defaultChannelId: PRODUCTION_CHANNEL.id,
  framework: 'capacitor',
  id: PRODUCTION_CHANNEL.appId,
  name: 'Demo',
  organizationId: ACME_ORGANIZATION.id,
  updatedAt: '2026-09-03T08:00:00.000Z',
};

export const STAGING_CHANNEL: Channel = {
  ...PRODUCTION_CHANNEL,
  createdAt: '2026-09-04T08:00:00.000Z',
  failureAction: 'pause',
  failureMinSample: 20,
  failureThresholdPercent: 10,
  id: '9b2f4d1e-3c5a-4e6f-8a7b-1c2d3e4f5a6b',
  isProtected: false,
  name: 'staging',
  updatedAt: '2026-09-04T08:00:00.000Z',
};

export const STAGING_CHANNEL_WITH_DEVICE_COUNTS: ChannelWithDeviceCounts = {
  ...STAGING_CHANNEL,
  activeDeviceCount: 120,
  currentDeviceCount: 100,
  embeddedDeviceCount: 20,
};

export const READY_BUNDLE: Bundle = {
  appId: DEMO_APP.id,
  bundleVersion: '1.4.2',
  createdAt: '2026-09-05T08:00:00.000Z',
  expiresAt: null,
  fingerprint: null,
  framework: 'capacitor',
  gitMessage: 'fix: cart crash',
  gitRef: 'main',
  gitRemote: 'github.com/acme/shop',
  gitSha: 'ab12c3f4ab12c3f4ab12c3f4ab12c3f4ab12c3f4',
  id: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
  isGitDirty: false,
  manifestSha256:
    '9c1f2e3d4c5b6a798877665544332211aabbccddeeff00112233445566778899',
  number: 17,
  platforms: ['android', 'ios'],
  signature: null,
  sizeBytes: 812331,
  state: 'ready',
  unusedSince: '2026-09-05T08:05:00.000Z',
  updatedAt: '2026-09-05T08:05:00.000Z',
};

export const PREVIOUS_BUNDLE: Bundle = {
  ...READY_BUNDLE,
  bundleVersion: '1.4.1',
  createdAt: '2026-09-04T08:00:00.000Z',
  id: '2f1e0d9c-8b7a-4695-a483-72615049382a',
  number: 16,
  updatedAt: '2026-09-04T08:05:00.000Z',
};

export const EMBEDDED_BUNDLE: EmbeddedBundle = {
  appId: DEMO_APP.id,
  binaryBuild: '1',
  binaryVersion: '1.0',
  bundleId: '4d3c2b1a-0f9e-4d8c-b7a6-59483726150e',
  createdAt: '2026-09-06T08:00:00.000Z',
  fingerprint: null,
  id: '8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5968',
  platform: 'ios',
  updatedAt: '2026-09-06T08:00:00.000Z',
};
