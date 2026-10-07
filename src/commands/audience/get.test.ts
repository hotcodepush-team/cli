import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAPACITOR_FINGERPRINT,
  writeFingerprintInputs,
} from '../../../test/capacitor-project.js';
import { useCommandHarness } from '../../../test/command-harness.js';
import { DEMO_APP, STAGING_CHANNEL } from '../../../test/fixtures.js';
import {
  CHANNEL_PATH,
  respondWithStagingReleases,
  STAGING_AUDIENCE,
} from '../../../test/release-routes.js';
import audienceGetCommand from './get.js';

const DEVICE_ID = '6b1e9d37-2f5c-4a80-9c46-d8e3a1f7b259';

describe('audience get', () => {
  const harness = useCommandHarness();
  let stderrWrite: ReturnType<typeof vi.spyOn>;
  let workingDirectoryPath = '';

  beforeEach(() => {
    stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    respondWithStagingReleases(harness);
    // outside a project: no lockfile, so no fingerprint, unless a test writes one
    workingDirectoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-cwd-'));
    vi.spyOn(process, 'cwd').mockReturnValue(workingDirectoryPath);
  });

  afterEach(() => {
    rmSync(workingDirectoryPath, { force: true, recursive: true });
  });

  function readAudienceUrl(): URL | undefined {
    return harness.requests
      .map(({ url }) => new URL(url))
      .find(({ pathname }) => pathname === `${CHANNEL_PATH}/audience`);
  }

  it('should print the devices the conditions reach with the platforms and binary versions among them', async () => {
    harness.routes[`GET ${CHANNEL_PATH}/audience`] = () =>
      Response.json({ ...STAGING_AUDIENCE, estimatedAtRollout: 10 });

    await audienceGetCommand.action(
      {
        app: DEMO_APP.id,
        attribute: ['tier=beta'],
        binary: '>=2.3.0',
        channel: STAGING_CHANNEL.name,
        device: [DEVICE_ID],
        os: '>=17',
        rolloutPercentage: 10,
      },
      undefined,
    );

    expect(Object.fromEntries(readAudienceUrl()?.searchParams ?? [])).toEqual({
      attribute: 'tier=beta',
      binary: '>=2.3.0',
      device: DEVICE_ID,
      os: '>=17',
      rollout: '10',
    });
    expect(harness.readLines()).toEqual([
      'Reaches 100 of 120 active devices in staging; about 10 at a 10 percent rollout.',
      'PLATFORM  DEVICES',
      'ios       60',
      'android   40',
      'BINARY VERSION  DEVICES',
      '2.4.1           70',
      '2.3.0           30',
    ]);
  });

  it("should add the project's fingerprint as a condition when the project has a lockfile, as release create does", async () => {
    writeFingerprintInputs(workingDirectoryPath);
    harness.routes[`GET ${CHANNEL_PATH}/audience`] = () =>
      Response.json(STAGING_AUDIENCE);

    await audienceGetCommand.action(
      { app: DEMO_APP.id, channel: STAGING_CHANNEL.name },
      undefined,
    );

    expect(Object.fromEntries(readAudienceUrl()?.searchParams ?? [])).toEqual({
      fingerprint: CAPACITOR_FINGERPRINT,
      rollout: '100',
    });
  });

  it('should print only the sentence when no device is reached', async () => {
    harness.routes[`GET ${CHANNEL_PATH}/audience`] = () =>
      Response.json({
        ...STAGING_AUDIENCE,
        byBinaryVersion: [],
        byPlatform: [],
        estimatedAtRollout: 0,
        reached: 0,
      });

    await audienceGetCommand.action(
      { app: DEMO_APP.id, channel: STAGING_CHANNEL.name },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      'Reaches 0 of 120 active devices in staging.',
    ]);
  });

  it('should print the audience as JSON and its warnings on stderr', async () => {
    const warning = {
      code: 'UNSUPPORTED_CONDITION_SHARE',
      details: null,
      message:
        "12 of the channel's 120 active devices run an SDK that does not know the condition type attribute and will not see this release until the app ships a newer SDK.",
    };
    harness.routes[`GET ${CHANNEL_PATH}/audience`] = () =>
      Response.json({ ...STAGING_AUDIENCE, warnings: [warning] });

    await audienceGetCommand.action(
      {
        app: DEMO_APP.id,
        attribute: ['tier=beta'],
        channel: STAGING_CHANNEL.name,
        json: true,
      },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      ...STAGING_AUDIENCE,
      warnings: [warning],
    });
    expect(stderrWrite).toHaveBeenCalledWith(`Warning: ${warning.message}\n`);
  });

  it('should fail with E_INVALID_PARAMETER when an attribute is no key=value pair', async () => {
    await expect(
      audienceGetCommand.action(
        {
          app: DEMO_APP.id,
          attribute: ['=beta'],
          channel: STAGING_CHANNEL.name,
        },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'E_INVALID_PARAMETER' });
    expect(readAudienceUrl()).toBeUndefined();
  });
});
