import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { runCli } from './cli.js';
import type { CommandRegistry } from './command-registry.js';
import { MissingParameterError } from './errors.js';
import { defineCommandOptions } from './global-options.js';

const META = {
  description: 'The HotCodePush CLI',
  name: 'hotcodepush',
  version: '1.2.3',
};

class ExitCalled extends Error {}

function createCommandTree() {
  const channelCreateAction = vi.fn();
  const fingerprintDiffAction = vi.fn();
  const commandRegistry: CommandRegistry = {
    'channel create': vi.fn(async () => ({
      default: defineCommand({
        action: channelCreateAction,
        description: 'Create a channel.',
        examples: [
          'hotcodepush channel create --name beta',
          'hotcodepush channel create --json',
        ],
        options: defineCommandOptions({
          name: z.string().optional().describe('The channel name.'),
          rolloutPercentage: z.coerce.number().max(100).optional(),
        }),
      }),
    })),
    'channel list': vi.fn(async () => ({
      default: defineCommand({
        action: () => undefined,
        description: 'List the channels.',
        examples: [
          'hotcodepush channel list',
          'hotcodepush channel list --json',
        ],
        options: defineCommandOptions({}),
      }),
    })),
    'fingerprint diff': vi.fn(async () => ({
      default: defineCommand({
        action: fingerprintDiffAction,
        args: z.array(z.string()),
        description: 'Compare two fingerprints.',
        examples: [
          'hotcodepush fingerprint diff a1 b2',
          'hotcodepush fingerprint diff a1 b2 --json',
        ],
        options: defineCommandOptions({}),
      }),
    })),
    'login': vi.fn(async () => ({
      default: defineCommand({
        action: () => {
          throw new MissingParameterError('--token');
        },
        description: 'Log in.',
        examples: ['hotcodepush login', 'hotcodepush login --json'],
        options: defineCommandOptions({}),
      }),
    })),
  };
  return { channelCreateAction, commandRegistry, fingerprintDiffAction };
}

function captureOutput() {
  const consoleLog = vi
    .spyOn(console, 'log')
    .mockImplementation(() => undefined);
  const stderrWrite = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  const stdoutWrite = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  return {
    readConsoleLog: () =>
      consoleLog.mock.calls.map(values => values.join(' ')).join('\n'),
    readStderr: () =>
      stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join(''),
    readStdout: () =>
      stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join(''),
  };
}

function stubExit() {
  return vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new ExitCalled();
  });
}

describe('runCli', () => {
  it('should run the command with its options and the global ones', async () => {
    const { channelCreateAction, commandRegistry } = createCommandTree();

    const exitCode = await runCli(
      commandRegistry,
      [
        'channel',
        'create',
        '--name',
        'beta',
        '--rollout-percentage',
        '50',
        '-y',
        '--json',
      ],
      META,
    );

    expect(exitCode).toBe(0);
    expect(channelCreateAction).toHaveBeenCalledWith(
      expect.objectContaining({
        json: true,
        name: 'beta',
        rolloutPercentage: 50,
        yes: true,
      }),
      [],
    );
  });

  it('should import only the command it runs', async () => {
    const { commandRegistry } = createCommandTree();

    await runCli(commandRegistry, ['channel', 'create'], META);

    expect(commandRegistry['channel create']).toHaveBeenCalledOnce();
    expect(commandRegistry['channel list']).not.toHaveBeenCalled();
    expect(commandRegistry.login).not.toHaveBeenCalled();
  });

  it('should pass the words after the command name as its arguments', async () => {
    const { commandRegistry, fingerprintDiffAction } = createCommandTree();

    await runCli(commandRegistry, ['fingerprint', 'diff', 'a1', 'b2'], META);

    expect(fingerprintDiffAction).toHaveBeenCalledWith(expect.any(Object), [
      'a1',
      'b2',
    ]);
  });

  it('should map an error the command throws to its exit code and message', async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();

    const exitCode = await runCli(commandRegistry, ['login'], META);

    expect(exitCode).toBe(2);
    expect(output.readStderr()).toMatch(
      /^E_MISSING_PARAMETER --token is missing — /,
    );
  });

  it('should print only the JSON error on stdout when --json is passed', async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();

    await runCli(commandRegistry, ['login', '--json'], META);

    expect(JSON.parse(output.readStdout())).toEqual({
      error: {
        code: 'E_MISSING_PARAMETER',
        fix: 'pass --token, or run the command interactively to be asked for it.',
        message: '--token is missing',
      },
    });
    expect(output.readStderr()).toBe('');
  });

  it('should answer E_INVALID_PARAMETER with exit code 2 when an option is invalid', async () => {
    const { channelCreateAction, commandRegistry } = createCommandTree();
    const output = captureOutput();

    const exitCode = await runCli(
      commandRegistry,
      ['channel', 'create', '--rollout-percentage', '120', '--json'],
      META,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(output.readStdout()).error.code).toBe(
      'E_INVALID_PARAMETER',
    );
    expect(channelCreateAction).not.toHaveBeenCalled();
  });

  it('should answer E_INVALID_PARAMETER when an option is unknown', async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();

    const exitCode = await runCli(
      commandRegistry,
      ['channel', 'create', '--colour'],
      META,
    );

    expect(exitCode).toBe(2);
    expect(output.readStderr()).toMatch(
      /^E_INVALID_PARAMETER Unknown option: --colour — /,
    );
  });

  it('should suggest the closest command when the command is unknown', async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();

    const exitCode = await runCli(commandRegistry, ['chanel', 'create'], META);

    expect(exitCode).toBe(1);
    expect(output.readStderr()).toContain(
      'E_UNKNOWN_COMMAND "chanel create" is not a command — did you mean "channel create"?',
    );
  });

  it("should print the noun's verbs and exit 0 when a noun is given alone", async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();
    const exit = stubExit();

    await runCli(commandRegistry, ['channel'], META);

    expect(exit).toHaveBeenCalledWith(0);
    expect(output.readConsoleLog()).toContain('channel create');
    expect(output.readConsoleLog()).toContain('channel list');
    expect(output.readConsoleLog()).not.toContain('login');
  });

  it("should end a command's help with its two examples", async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();
    stubExit();

    await runCli(commandRegistry, ['channel', 'create', '-h'], META);

    expect(output.readConsoleLog()).toMatch(
      /EXAMPLES\n+\s+hotcodepush channel create --name beta\n\s+hotcodepush channel create --json$/,
    );
  });

  it('should print the help without colour codes when colour is off', async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();
    stubExit();
    vi.stubEnv('NO_COLOR', '1');

    await runCli(commandRegistry, ['--help'], META);

    expect(output.readConsoleLog()).toContain('USAGE hotcodepush <command>');
    expect(output.readConsoleLog()).not.toContain('\x1b[');
  });

  it('should print the version when -v is passed', async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();
    const exit = stubExit();

    await runCli(commandRegistry, ['-v'], META);

    expect(exit).toHaveBeenCalledWith(0);
    expect(output.readConsoleLog()).toBe('1.2.3');
  });
});
