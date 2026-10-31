import { readFileSync } from 'node:fs';
import type {
  App,
  AuditLog,
  Binary,
  Bundle,
  BundleDelta,
  Channel,
  Device,
  FleetStatistics,
  Invitation,
  Limits,
  Member,
  Organization,
  Release,
  SigningKey,
  SsoProvider,
  User,
  Webhook,
  WebhookDelivery,
} from '@hotcodepush/node';
import type {
  CompletionCommand,
  CompletionOption,
} from '../src/utils/completion/command-tree.js';

export const ACME_ORGANIZATION: Organization = {
  appCountLimit: null,
  cappedAt: null,
  channelCountPerAppLimit: null,
  countryAllowlist: null,
  createdAt: '2026-09-01T08:00:00.000Z',
  currentPeriodEndsAt: null,
  dataTransferBytesPerMonthlyActiveDeviceLimit: null,
  deletedAt: null,
  enterpriseMonthlyActiveDeviceCountLimit: null,
  fileCountPerBundleLimit: null,
  finalPeriodEndsAt: null,
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  ipAllowlist: null,
  isTwoFactorRequired: false,
  lastSpendingCapReachedSentAt: null,
  lastSpendingCapWarningSentAt: null,
  lastStorageLimitReachedSentAt: null,
  lastStorageWarningSentAt: null,
  memberCountLimit: null,
  name: 'Acme',
  pastDueAt: null,
  plan: 'free',
  region: 'eu',
  releaseCountPerAppPerDayLimit: null,
  reportedBillableDeviceCount: 0,
  reportedBillableDeviceCountHour: null,
  reportedBillableDeviceCountMonth: null,
  retentionDays: null,
  spendingCapCents: 0,
  storageBytes: 0,
  storageBytesLimit: null,
  subscriptionProvider: null,
  subscriptionStatus: null,
  unsentBillableDeviceCount: 0,
  updatedAt: '2026-09-01T08:00:00.000Z',
};

// Pay-as-you-go with a $50 cap, under its ceiling, with an active subscription.
export const GLOBEX_ORGANIZATION: Organization = {
  ...ACME_ORGANIZATION,
  createdAt: '2026-09-02T08:00:00.000Z',
  currentPeriodEndsAt: '2026-10-02T08:00:00.000Z',
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  name: 'Globex',
  plan: 'pay_as_you_go',
  spendingCapCents: 5000,
  subscriptionProvider: 'polar',
  subscriptionStatus: 'active',
  updatedAt: '2026-09-02T08:00:00.000Z',
};

// One of the two limits is raised for Globex.
export const GLOBEX_LIMITS: Limits = {
  appCountLimit: { default: 10, isOverridden: true, value: 25 },
  memberCountLimit: { default: 20, isOverridden: false, value: 20 },
};

export const PRODUCTION_CHANNEL: Channel = {
  appId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  createdAt: '2026-09-03T08:00:00.000Z',
  expiresAt: null,
  failureAction: null,
  failureMinimumUpdateCount: null,
  failureThresholdPercent: null,
  id: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
  isDiscoverable: false,
  isProtected: true,
  name: 'production',
  nextReleaseNumber: 1,
  pausedAt: null,
  updatedAt: '2026-09-03T08:00:00.000Z',
};

export const DEMO_APP: App = {
  channelLinkTemplate: null,
  createdAt: '2026-09-03T08:00:00.000Z',
  defaultChannelId: PRODUCTION_CHANNEL.id,
  deletedAt: null,
  framework: 'capacitor',
  id: PRODUCTION_CHANNEL.appId,
  name: 'Demo',
  nextBundleNumber: 18,
  organizationId: ACME_ORGANIZATION.id,
  updatedAt: '2026-09-03T08:00:00.000Z',
};

export const STAGING_CHANNEL: Channel = {
  ...PRODUCTION_CHANNEL,
  createdAt: '2026-09-04T08:00:00.000Z',
  failureAction: 'pause',
  failureMinimumUpdateCount: 20,
  failureThresholdPercent: 10,
  id: '9b2f4d1e-3c5a-4e6f-8a7b-1c2d3e4f5a6b',
  isProtected: false,
  name: 'staging',
  nextReleaseNumber: 44,
  updatedAt: '2026-09-04T08:00:00.000Z',
};

export const READY_BUNDLE: Bundle = {
  appId: DEMO_APP.id,
  version: '1.4.2',
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
  signatureKeyId: null,
  sizeBytes: 812331,
  source: 'upload',
  status: 'ready',
  unusedSince: '2026-09-05T08:05:00.000Z',
  updatedAt: '2026-09-05T08:05:00.000Z',
};

export const PREVIOUS_BUNDLE: Bundle = {
  ...READY_BUNDLE,
  version: '1.4.1',
  createdAt: '2026-09-04T08:00:00.000Z',
  id: '2f1e0d9c-8b7a-4695-a483-72615049382a',
  number: 16,
  updatedAt: '2026-09-04T08:05:00.000Z',
};

export const BINARY: Binary = {
  appId: DEMO_APP.id,
  build: '1',
  bundleId: '4d3c2b1a-0f9e-4d8c-b7a6-59483726150e',
  createdAt: '2026-09-06T08:00:00.000Z',
  fingerprint: null,
  id: '8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5968',
  platform: 'ios',
  updatedAt: '2026-09-06T08:00:00.000Z',
  version: '1.0',
};

// One delta is built against the previous bundle, one is requested against the binary.
export const READY_BUNDLE_DELTAS: BundleDelta[] = [
  {
    baseBundle: PREVIOUS_BUNDLE,
    baseBundleId: PREVIOUS_BUNDLE.id,
    bundleId: READY_BUNDLE.id,
    createdAt: '2026-09-07T08:00:01.000Z',
    patchCount: 2,
    requestedAt: '2026-09-07T08:00:01.000Z',
    sizeBytes: 48213,
    status: 'built',
    updatedAt: '2026-09-07T08:00:04.000Z',
  },
  {
    baseBundle: {
      ...PREVIOUS_BUNDLE,
      fingerprint: null,
      id: BINARY.bundleId,
      number: null,
      source: 'binary',
    },
    baseBundleId: BINARY.bundleId,
    bundleId: READY_BUNDLE.id,
    createdAt: '2026-09-07T08:00:01.000Z',
    patchCount: null,
    requestedAt: '2026-09-07T08:00:01.000Z',
    sizeBytes: null,
    status: 'requested',
    updatedAt: '2026-09-07T08:00:01.000Z',
  },
];

export const LIVE_RELEASE: Release = {
  autoPausedAt: null,
  bundleId: READY_BUNDLE.id,
  channelId: STAGING_CHANNEL.id,
  conditions: [],
  createdAt: '2026-09-07T08:00:00.000Z',
  createdFromReleaseId: null,
  failureAction: null,
  failureMinimumUpdateCount: null,
  failureNotifiedAt: null,
  failureThresholdPercent: null,
  id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  isMandatory: false,
  liveAt: '2026-09-07T08:00:05.000Z',
  notes: 'cart fix',
  number: 43,
  pausedAt: null,
  progression: null,
  progressionStepStartedAt: null,
  purgedAt: '2026-09-07T08:00:06.000Z',
  rolledBackFromReleaseId: null,
  rolloutPercentage: 100,
  status: 'active',
  stepStartAppliedUpdateCount: 0,
  updatedAt: '2026-09-07T08:00:06.000Z',
  windowStartAppliedUpdateCount: 0,
  windowStartFailureCount: 0,
};

export const PREVIOUS_RELEASE: Release = {
  ...LIVE_RELEASE,
  bundleId: PREVIOUS_BUNDLE.id,
  createdAt: '2026-09-06T08:00:00.000Z',
  id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  liveAt: '2026-09-06T08:00:05.000Z',
  notes: null,
  number: 42,
  purgedAt: '2026-09-06T08:00:06.000Z',
  updatedAt: '2026-09-06T08:00:06.000Z',
};

// 120 devices: 80 on release #43, 20 on #42 and 20 on the embedded bundle, 12 of them on the binary.
// Served for the app and the staging channel alike.
export const FLEET: FleetStatistics = {
  binary: [
    {
      deviceCount: 108,
      lastSeenAt: '2026-09-08T09:00:00.000Z',
      platform: null,
      value: null,
      version: null,
    },
    {
      deviceCount: 12,
      lastSeenAt: '2026-09-08T08:00:00.000Z',
      platform: BINARY.platform,
      value: BINARY.id,
      version: BINARY.version,
    },
  ],
  binaryVersion: [{ deviceCount: 120, value: '2.4.1' }],
  channel: [{ deviceCount: 120, value: STAGING_CHANNEL.id }],
  country: [{ deviceCount: 120, value: 'DE' }],
  currentDeviceCount: 100,
  deviceCount: 120,
  osVersion: [{ deviceCount: 120, platform: 'ios', value: '17.4' }],
  platform: [{ deviceCount: 120, value: 'ios' }],
  release: [
    {
      channelId: STAGING_CHANNEL.id,
      deviceCount: 80,
      number: LIVE_RELEASE.number,
      value: LIVE_RELEASE.id,
    },
    {
      channelId: STAGING_CHANNEL.id,
      deviceCount: 20,
      number: PREVIOUS_RELEASE.number,
      value: PREVIOUS_RELEASE.id,
    },
    { channelId: null, deviceCount: 20, number: null, value: null },
  ],
  sdkVersion: [{ deviceCount: 120, value: '0.1.0' }],
};

// At the first step of the default schedule, which started at 88 applied updates.
export const PROGRESSING_RELEASE: Release = {
  ...LIVE_RELEASE,
  progression: {
    percentages: [10, 50, 100],
    stepMinimumSeconds: 3600,
    stepMinimumUpdateCount: 50,
  },
  progressionStepStartedAt: LIVE_RELEASE.liveAt,
  rolloutPercentage: 10,
  stepStartAppliedUpdateCount: 88,
};

export const RUNNER_USER: User = {
  bannedAt: null,
  createdAt: '2026-09-01T08:00:00.000Z',
  deletedAt: null,
  discoverySource: null,
  email: 'anna@example.com',
  emailVerified: true,
  id: 'user-1',
  image: null,
  intendedFramework: null,
  jobRole: null,
  lastSeenAt: '2026-09-08T08:00:00.000Z',
  locale: null,
  name: 'Anna Example',
  timeFormat: null,
  timeZone: null,
  twoFactorEnabled: false,
  updatedAt: '2026-09-01T08:00:00.000Z',
};

// The owner of Acme and an admin of Globex.
export const RUNNER_USER_WITH_MEMBERS: User = {
  ...RUNNER_USER,
  members: [
    {
      createdAt: '2026-09-02T08:00:00.000Z',
      id: '6f1c3a8e-9b2d-4e57-a0c4-1d8b5e3f7a92',
      lastSeenAt: '2026-09-08T08:00:00.000Z',
      organizationId: GLOBEX_ORGANIZATION.id,
      role: 'admin',
      updatedAt: '2026-09-02T08:00:00.000Z',
      userId: RUNNER_USER.id,
    },
    {
      createdAt: '2026-09-01T08:00:00.000Z',
      id: '0b7e4d2a-6c9f-4a13-8e5b-2f4a9c1d7e36',
      lastSeenAt: '2026-09-08T08:00:00.000Z',
      organizationId: ACME_ORGANIZATION.id,
      role: 'owner',
      updatedAt: '2026-09-01T08:00:00.000Z',
      userId: RUNNER_USER.id,
    },
  ],
};

interface ProtocolSigningKey {
  fingerprint: string;
  name: string;
  privateKey: string;
  publicKey: string;
}

// The protocol signature fixtures name `rsa-4096-a`, `rsa-4096-b`, `rsa-2048` and `rsa-1024`, which is below the minimum size.
export function resolveProtocolSigningKey(keyName: string): ProtocolSigningKey {
  const { keys } = JSON.parse(
    readFileSync(
      new URL(
        '../node_modules/@hotcodepush/protocol/fixtures/signatures.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { keys: ProtocolSigningKey[] };
  const key = keys.find(({ name }) => name === keyName);
  if (key === undefined) {
    throw new Error(`The protocol's fixtures hold no key named ${keyName}.`);
  }
  return key;
}

const SIGNING_KEY_PAIR = resolveProtocolSigningKey('rsa-4096-a');

export const SIGNING_KEY: SigningKey = {
  appId: DEMO_APP.id,
  createdAt: '2026-09-09T08:00:00.000Z',
  fingerprint: SIGNING_KEY_PAIR.fingerprint,
  id: '3b1f8e7a-5c2d-4f6b-9a0e-7d4c1b2a3f5e',
  publicKey: SIGNING_KEY_PAIR.publicKey,
  updatedAt: '2026-09-09T08:00:00.000Z',
};

export const SIGNING_PRIVATE_KEY = SIGNING_KEY_PAIR.privateKey;

export const DEVICE: Device = {
  appId: DEMO_APP.id,
  attributes: { tier: 'beta' },
  binaryBuild: '57',
  binaryVersion: '2.4.1',
  channelId: STAGING_CHANNEL.id,
  channelSource: 'config',
  country: 'DE',
  createdAt: '2026-09-02T08:00:00.000Z',
  currentReleaseId: null,
  deviceId: '6b1e9d37-2f5c-4a80-9c46-d8e3a1f7b259',
  embeddedBundleId: null,
  fingerprint: null,
  lastSeenAt: '2026-09-08T08:00:00.000Z',
  osVersion: '17.4',
  platform: 'ios',
  sdkVersion: '0.1.0',
  updatedAt: '2026-09-08T08:00:00.000Z',
};

export const AUDIT_LOG: AuditLog = {
  actorType: 'user',
  address: '203.0.113.7',
  apiKeyId: null,
  appId: DEMO_APP.id,
  country: 'DE',
  createdAt: '2026-09-10T08:00:00.000Z',
  dispatchedAt: null,
  id: '1e4d7a2b-9c3f-4b8e-a6d5-0f2c7b9e4a13',
  objectId: STAGING_CHANNEL.id,
  organizationId: ACME_ORGANIZATION.id,
  sessionId: 'a8c3e5f1-2b7d-4e9a-8c6f-3d1b5e7a9c24',
  snapshot: { name: STAGING_CHANNEL.name },
  type: 'channel.created',
  updatedAt: '2026-09-10T08:00:00.000Z',
  userAgent: 'hotcodepush/0.0.0',
  userId: RUNNER_USER.id,
};

// The domain still waits for its TXT record.
export const SSO_PROVIDER: SsoProvider = {
  createdAt: '2026-09-11T08:00:00.000Z',
  domain: 'example.com',
  domainVerificationToken: 'b7Kq2vX9mN4pR8sT1wY6zA3c',
  domainVerified: false,
  id: '5d9e2c7a-4b1f-4e8d-9a3c-6f0b2e8d4a71',
  issuer: 'https://login.example.com',
  organizationId: ACME_ORGANIZATION.id,
  providerId: ACME_ORGANIZATION.id,
  type: 'oidc',
  updatedAt: '2026-09-11T08:00:00.000Z',
  userId: RUNNER_USER.id,
};

export const VERIFIED_SAML_SSO_PROVIDER: SsoProvider = {
  ...SSO_PROVIDER,
  domainVerified: true,
  issuer: 'https://idp.example.com',
  type: 'saml',
};

export const WEBHOOK: Webhook = {
  appId: null,
  consecutiveFailureCount: 0,
  createdAt: '2026-09-12T08:00:00.000Z',
  events: ['release.created', 'release.paused'],
  format: 'raw',
  id: '3c9e7a52-8d14-4b6f-a0e2-5f71c3d8b946',
  isEnabled: true,
  name: 'releases',
  organizationId: ACME_ORGANIZATION.id,
  updatedAt: '2026-09-12T08:00:00.000Z',
  url: 'https://hooks.example.com/hotcodepush',
};

// The receiver answered 500 to every attempt.
export const FAILED_WEBHOOK_DELIVERY: WebhookDelivery = {
  attemptCount: 3,
  auditRowId: '7e1b4d93-2a6c-4f08-b5d1-8c3e9f2a6b70',
  createdAt: '2026-09-12T09:00:00.000Z',
  id: '9a4f2e71-3b8c-4d65-b1e7-0c2d5f8a6e93',
  nextAttemptAt: null,
  responseBody: 'Internal Server Error',
  responseCode: 500,
  status: 'failed',
  type: 'release.created',
  updatedAt: '2026-09-12T09:30:00.000Z',
  webhookId: WEBHOOK.id,
};

export const OWNER_MEMBER: Member = {
  createdAt: '2026-09-01T08:00:00.000Z',
  id: '2a7d4e91-6c3b-4f58-8e0a-9b1c5d3f7e62',
  lastSeenAt: '2026-09-08T08:00:00.000Z',
  organizationId: ACME_ORGANIZATION.id,
  role: 'owner',
  updatedAt: '2026-09-01T08:00:00.000Z',
  user: {
    accounts: [
      {
        createdAt: '2026-09-01T08:00:00.000Z',
        id: '3e9b7c1d-5a2f-4d86-9b0e-6c4a8f2d1e57',
        providerId: 'credential',
        userId: '9c4e1b7a-3f2d-4a65-b8e0-7d1a5c3e9f04',
      },
    ],
    createdAt: '2026-09-01T08:00:00.000Z',
    email: 'anna@example.com',
    emailVerified: true,
    id: '9c4e1b7a-3f2d-4a65-b8e0-7d1a5c3e9f04',
    image: null,
    name: 'Anna Example',
    twoFactorEnabled: true,
    updatedAt: '2026-09-01T08:00:00.000Z',
  },
  userId: '9c4e1b7a-3f2d-4a65-b8e0-7d1a5c3e9f04',
};

export const ADMIN_MEMBER: Member = {
  createdAt: '2026-09-03T08:00:00.000Z',
  id: '5e8a2c71-0b4d-4f39-9a6e-3c1d7b2f8e40',
  lastSeenAt: null,
  organizationId: ACME_ORGANIZATION.id,
  role: 'admin',
  updatedAt: '2026-09-03T08:00:00.000Z',
  user: {
    accounts: [
      {
        createdAt: '2026-09-03T08:00:00.000Z',
        id: '8d2a6f4c-1e7b-4c93-a5d0-2b9e7f3c6a18',
        providerId: 'github',
        userId: '7f3c9a1e-2d5b-4e80-b6a4-0c9e1d3f5a27',
      },
    ],
    createdAt: '2026-09-03T08:00:00.000Z',
    email: 'bob@example.com',
    emailVerified: true,
    id: '7f3c9a1e-2d5b-4e80-b6a4-0c9e1d3f5a27',
    image: null,
    name: 'Bob Example',
    twoFactorEnabled: false,
    updatedAt: '2026-09-03T08:00:00.000Z',
  },
  userId: '7f3c9a1e-2d5b-4e80-b6a4-0c9e1d3f5a27',
};

export const PENDING_INVITATION: Invitation = {
  createdAt: '2026-09-10T08:00:00.000Z',
  email: 'carol@example.com',
  expiresAt: '2026-09-12T08:00:00.000Z',
  id: '4c8e2a6f-1d3b-4e97-a5c0-8f2d6b4a1e93',
  inviterId: OWNER_MEMBER.userId,
  organizationId: ACME_ORGANIZATION.id,
  role: 'member',
  status: 'pending',
  updatedAt: '2026-09-10T08:00:00.000Z',
};

const JSON_COMPLETION_OPTION: CompletionOption = {
  choices: [],
  description: 'Print machine output as JSON.',
  hasValue: false,
  isRepeatable: false,
  name: 'json',
};

// Covers every kind of option and command shape that the completion scripts handle.
export const COMPLETION_COMMANDS: CompletionCommand[] = [
  {
    description: 'create',
    hasArguments: false,
    name: 'channel',
    options: [],
    verbs: [
      {
        description: "Create a channel: the app's [preview] one.",
        hasArguments: false,
        name: 'create',
        options: [
          {
            choices: [],
            description: "The channel's name.",
            hasValue: true,
            isRepeatable: false,
            name: 'name',
          },
          {
            choices: ['none', 'pause'],
            description: 'What auto-pause does.',
            hasValue: true,
            isRepeatable: false,
            name: 'failure-action',
          },
          {
            choices: [],
            description: 'Whether only [Owners] change it.',
            hasValue: false,
            isRepeatable: false,
            name: 'protected',
          },
          {
            choices: [],
            description: 'A label it carries, repeatable.',
            hasValue: true,
            isRepeatable: true,
            name: 'label',
          },
          JSON_COMPLETION_OPTION,
        ],
        verbs: [],
      },
    ],
  },
  {
    description: 'Print the fingerprint.',
    hasArguments: false,
    name: 'fingerprint',
    options: [JSON_COMPLETION_OPTION],
    verbs: [
      {
        description: 'Print what moved.',
        hasArguments: true,
        name: 'diff',
        options: [JSON_COMPLETION_OPTION],
        verbs: [],
      },
    ],
  },
];
