import { readFileSync } from 'node:fs';
import type {
  App,
  AuditLog,
  Billing,
  Binary,
  Bundle,
  Channel,
  ChannelWithDeviceCounts,
  Device,
  Invitation,
  Limits,
  Member,
  Organization,
  Release,
  SigningKey,
  SsoProvider,
  User,
} from '@hotcodepush/node';

export const ACME_ORGANIZATION: Organization = {
  countryAllowlist: null,
  createdAt: '2026-09-01T08:00:00.000Z',
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  ipAllowlist: null,
  isTwoFactorRequired: false,
  name: 'Acme',
  plan: 'free',
  region: 'eu',
  role: 'owner',
  updatedAt: '2026-09-01T08:00:00.000Z',
};

export const GLOBEX_ORGANIZATION: Organization = {
  countryAllowlist: null,
  createdAt: '2026-09-02T08:00:00.000Z',
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  ipAllowlist: null,
  isTwoFactorRequired: false,
  name: 'Globex',
  plan: 'pay_as_you_go',
  region: 'eu',
  role: 'admin',
  updatedAt: '2026-09-02T08:00:00.000Z',
};

/**
 * Globex's billing this month: a $50 cap, under its ceiling, no lower cap waiting, its subscription active.
 */
export const GLOBEX_BILLING: Billing = {
  cancelAtPeriodEnd: false,
  cappedAt: null,
  countedMau: 1234,
  currentPeriodEndsAt: '2026-10-02T08:00:00.000Z',
  mauCap: 5000,
  nextSpendingCapCents: null,
  nextSpendingCapStartsAt: null,
  plan: 'pay_as_you_go',
  spendingCapCents: 5000,
  subscriptionProvider: 'polar',
  subscriptionStatus: 'active',
  suggestedSpendingCapCents: null,
};

/**
 * Two of Globex's limits, one raised for it.
 */
export const GLOBEX_LIMITS: Limits = {
  appsLimit: { default: 10, isOverridden: true, value: 25 },
  membersLimit: { default: 20, isOverridden: false, value: 20 },
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
  hasSigningKey: false,
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
  state: 'ready',
  type: 'uploaded',
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
  deviceCount: 12,
  fingerprint: null,
  id: '8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5968',
  lastSeenAt: '2026-09-08T08:00:00.000Z',
  platform: 'ios',
  updatedAt: '2026-09-06T08:00:00.000Z',
  version: '1.0',
};

export const LIVE_RELEASE: Release = {
  appId: DEMO_APP.id,
  bundleId: READY_BUNDLE.id,
  channelId: STAGING_CHANNEL.id,
  conditions: [],
  createdAt: '2026-09-07T08:00:00.000Z',
  createdFromReleaseId: null,
  deviceCount: 80,
  failureAction: null,
  failureMinSample: null,
  failureThresholdPercent: null,
  id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  isMandatory: false,
  liveAt: '2026-09-07T08:00:05.000Z',
  notes: 'cart fix',
  number: 43,
  pausedAt: null,
  progression: null,
  progressionStep: null,
  purgedAt: '2026-09-07T08:00:06.000Z',
  rolledBackFromReleaseId: null,
  rolloutPercentage: 100,
  state: 'active',
  updatedAt: '2026-09-07T08:00:06.000Z',
  verifier: null,
};

export const PREVIOUS_RELEASE: Release = {
  ...LIVE_RELEASE,
  bundleId: PREVIOUS_BUNDLE.id,
  createdAt: '2026-09-06T08:00:00.000Z',
  deviceCount: 20,
  id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  liveAt: '2026-09-06T08:00:05.000Z',
  notes: null,
  number: 42,
  purgedAt: '2026-09-06T08:00:06.000Z',
  updatedAt: '2026-09-06T08:00:06.000Z',
};

/**
 * Release #43 at the first step of the default schedule, its widening waiting on the step's sample.
 */
export const PROGRESSING_RELEASE: Release = {
  ...LIVE_RELEASE,
  progression: {
    minimumSample: 50,
    minimumSeconds: 3600,
    percentages: [10, 50, 100],
  },
  progressionStep: {
    gate: { attempted: 12, kind: 'sample', required: 50 },
    number: 1,
  },
  rolloutPercentage: 10,
};

export const RUNNER_USER: User = {
  createdAt: '2026-09-01T08:00:00.000Z',
  credential: 'session',
  email: 'anna@example.com',
  id: 'user-1',
  isEmailVerified: true,
  name: 'Anna Example',
};

interface ProtocolSigningKey {
  fingerprint: string;
  name: string;
  privateKey: string;
  publicKey: string;
}

/**
 * A test key pair of the protocol's signature fixtures by its name: `rsa-4096-a`, `rsa-4096-b`, `rsa-2048`,
 * and `rsa-1024`, the one under the minimum size.
 */
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
  embeddedBundleId: null,
  fingerprint: null,
  id: '6b1e9d37-2f5c-4a80-9c46-d8e3a1f7b259',
  lastSeenAt: '2026-09-08T08:00:00.000Z',
  osVersion: '17.4',
  platform: 'ios',
  sdkVersion: '0.1.0',
  updatedAt: '2026-09-08T08:00:00.000Z',
};

export const AUDIT_LOG: AuditLog = {
  address: '203.0.113.7',
  apiKeyId: null,
  appId: DEMO_APP.id,
  country: 'DE',
  createdAt: '2026-09-10T08:00:00.000Z',
  id: '1e4d7a2b-9c3f-4b8e-a6d5-0f2c7b9e4a13',
  objectId: STAGING_CHANNEL.id,
  sessionId: 'a8c3e5f1-2b7d-4e9a-8c6f-3d1b5e7a9c24',
  snapshot: { name: STAGING_CHANNEL.name },
  type: 'channel.created',
  userAgent: 'hotcodepush/0.0.0',
  userId: RUNNER_USER.id,
};

/**
 * An OIDC provider whose domain still waits for its TXT record.
 */
export const SSO_PROVIDER: SsoProvider = {
  createdAt: '2026-09-11T08:00:00.000Z',
  domain: 'example.com',
  id: '5d9e2c7a-4b1f-4e8d-9a3c-6f0b2e8d4a71',
  isVerified: false,
  oidc: {
    clientId: 'hotcodepush',
    discoveryEndpoint:
      'https://login.example.com/.well-known/openid-configuration',
    issuer: 'https://login.example.com',
    redirectUri: `https://api.example.com/v1/auth/sso/callback/${ACME_ORGANIZATION.id}`,
    scopes: null,
  },
  organizationId: ACME_ORGANIZATION.id,
  provider: 'oidc',
  saml: null,
  signInUrl: `https://console.example.com/login?sso=${ACME_ORGANIZATION.id}`,
  updatedAt: '2026-09-11T08:00:00.000Z',
  verification: {
    name: `_hotcodepush-sso-${ACME_ORGANIZATION.id}.example.com`,
    value: 'b7Kq2vX9mN4pR8sT1wY6zA3c',
  },
};

/**
 * A SAML provider whose domain is verified.
 */
export const VERIFIED_SAML_SSO_PROVIDER: SsoProvider = {
  ...SSO_PROVIDER,
  isVerified: true,
  oidc: null,
  provider: 'saml',
  saml: {
    acsUrl: `https://api.example.com/v1/auth/sso/saml2/sp/acs/${ACME_ORGANIZATION.id}`,
    entityId: null,
    entryPoint: 'https://idp.example.com/sso',
    issuer: 'https://idp.example.com',
    spMetadataUrl: `https://api.example.com/v1/auth/sso/saml2/sp/metadata?providerId=${ACME_ORGANIZATION.id}`,
  },
  verification: null,
};

export const OWNER_MEMBER: Member = {
  createdAt: '2026-09-01T08:00:00.000Z',
  id: '2a7d4e91-6c3b-4f58-8e0a-9b1c5d3f7e62',
  lastSeenAt: '2026-09-08T08:00:00.000Z',
  organizationId: ACME_ORGANIZATION.id,
  role: 'owner',
  updatedAt: '2026-09-01T08:00:00.000Z',
  user: {
    email: 'anna@example.com',
    hasPassword: true,
    id: '9c4e1b7a-3f2d-4a65-b8e0-7d1a5c3e9f04',
    isTwoFactorEnabled: true,
    name: 'Anna Example',
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
    email: 'bob@example.com',
    hasPassword: false,
    id: '7f3c9a1e-2d5b-4e80-b6a4-0c9e1d3f5a27',
    isTwoFactorEnabled: false,
    name: 'Bob Example',
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
  organizationName: ACME_ORGANIZATION.name,
  role: 'member',
  status: 'pending',
  updatedAt: '2026-09-10T08:00:00.000Z',
};
