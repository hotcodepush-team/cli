import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { runCli } from './cli.js';
import type { CommandRegistry } from './command-registry.js';
import { MissingParameterError } from './errors.js';
import { defineCommandOptions } from './global-options.js';
import { printTelemetryNotice, reportFinishedCommand } from './telemetry.js';
import {
  printUpdateNotice,
  refreshLatestKnownVersion,
} from './update-notice.js';

vi.mock('./telemetry.js', () => ({
  printTelemetryNotice: vi.fn(),
  reportFinishedCommand: vi.fn(),
}));
vi.mock('./update-notice.js', () => ({
  printUpdateNotice: vi.fn(),
  refreshLatestKnownVersion: vi.fn(),
}));

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
        description: 'Create a channel.',
        examples: [
          'hotcodepush channel create --name beta',
          'hotcodepush channel create --json',
        ],
        options: defineCommandOptions({
          name: z.string().optional().describe('The channel name.'),
          rolloutPercentage: z.coerce.number().max(100).optional(),
        }),
        action: channelCreateAction,
      }),
    })),
    'channel list': vi.fn(async () => ({
      default: defineCommand({
        description: 'List the channels.',
        examples: [
          'hotcodepush channel list',
          'hotcodepush channel list --json',
        ],
        options: defineCommandOptions({}),
        action: () => undefined,
      }),
    })),
    'completion': vi.fn(async () => ({
      default: defineCommand({
        description: 'Print the completion script.',
        examples: [
          'eval "$(hotcodepush completion zsh)"',
          'hotcodepush completion fish',
        ],
        args: z.array(z.string()),
        options: defineCommandOptions({}),
        action: () => undefined,
      }),
    })),
    'fingerprint diff': vi.fn(async () => ({
      default: defineCommand({
        description: 'Compare two fingerprints.',
        examples: [
          'hotcodepush fingerprint diff a1 b2',
          'hotcodepush fingerprint diff a1 b2 --json',
        ],
        args: z.array(z.string()),
        options: defineCommandOptions({}),
        action: fingerprintDiffAction,
      }),
    })),
    'login': vi.fn(async () => ({
      default: defineCommand({
        description: 'Log in.',
        examples: ['hotcodepush login', 'hotcodepush login --json'],
        options: defineCommandOptions({}),
        action: () => {
          throw new MissingParameterError('--token');
        },
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
    expect(output.readStderr()).toBe(
      'No value was given for --token. Pass --token, or run the command interactively to be asked for it.\nhttps://hotcodepush.com/docs/cli/errors#E_MISSING_PARAMETER\n',
    );
  });

  it('should print only the JSON error on stdout when --json is passed', async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();

    await runCli(commandRegistry, ['login', '--json'], META);

    expect(JSON.parse(output.readStdout())).toEqual({
      error: {
        code: 'E_MISSING_PARAMETER',
        fix: 'Pass --token, or run the command interactively to be asked for it.',
        message: 'No value was given for --token.',
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
    expect(output.readStderr()).toBe(
      'Unknown option: --colour. Run the command with --help to see its options.\nhttps://hotcodepush.com/docs/cli/errors#E_INVALID_PARAMETER\n',
    );
  });

  it('should suggest the closest command when the command is unknown', async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();

    const exitCode = await runCli(commandRegistry, ['chanel', 'create'], META);

    expect(exitCode).toBe(1);
    expect(output.readStderr()).toBe(
      'There is no command "chanel create". Did you mean "channel create"?\nhttps://hotcodepush.com/docs/cli/errors#E_UNKNOWN_COMMAND\n',
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

  it("should list --help, -h and --version, -v among a command's global options", async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();
    stubExit();
    vi.stubEnv('NO_COLOR', '1');

    await runCli(commandRegistry, ['channel', 'list', '--help'], META);

    expect(output.readConsoleLog()).toMatch(/--help, -h\s+Print this help\./);
    expect(output.readConsoleLog()).toMatch(
      /--version, -v\s+Print the CLI's version\./,
    );
  });

  it('should print the version and run nothing when a command is given with --version', async () => {
    const { channelCreateAction, commandRegistry } = createCommandTree();
    const output = captureOutput();
    const exit = stubExit();

    await runCli(commandRegistry, ['channel', 'create', '--version'], META);

    expect(exit).toHaveBeenCalledWith(0);
    expect(output.readConsoleLog()).toBe('1.2.3');
    expect(channelCreateAction).not.toHaveBeenCalled();
  });

  it('should end the message of an unknown option with a full stop under --json', async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();

    const exitCode = await runCli(
      commandRegistry,
      ['channel', 'create', '--colour', '--json'],
      META,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(output.readStdout())).toEqual({
      error: {
        code: 'E_INVALID_PARAMETER',
        fix: 'Run the command with --help to see its options.',
        message: 'Unknown option: --colour.',
      },
    });
  });

  it('should print the telemetry notice and report the finished command with its name, its error and its duration', async () => {
    const { commandRegistry } = createCommandTree();
    captureOutput();

    await runCli(commandRegistry, ['login'], META);

    expect(printTelemetryNotice).toHaveBeenCalled();
    expect(reportFinishedCommand).toHaveBeenCalledWith({
      cliError: new MissingParameterError('--token'),
      commandName: 'login',
      durationMs: expect.any(Number),
    });
  });

  it('should report a command that succeeded without an error', async () => {
    const { commandRegistry } = createCommandTree();

    await runCli(commandRegistry, ['channel', 'create'], META);

    expect(reportFinishedCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cliError: undefined,
        commandName: 'channel create',
      }),
    );
  });

  it('should report nothing when the command line names no command', async () => {
    const { commandRegistry } = createCommandTree();
    captureOutput();

    await runCli(commandRegistry, ['chanel', 'create'], META);

    expect(reportFinishedCommand).not.toHaveBeenCalled();
  });

  it('should check for a newer version beside the command and print its notice', async () => {
    const { commandRegistry } = createCommandTree();

    await runCli(commandRegistry, ['channel', 'create'], META);

    expect(refreshLatestKnownVersion).toHaveBeenCalledOnce();
    expect(printUpdateNotice).toHaveBeenCalledOnce();
  });

  it('should send no telemetry and check for no newer version when completion runs as a shell starts', async () => {
    const { commandRegistry } = createCommandTree();

    const exitCode = await runCli(commandRegistry, ['completion', 'zsh'], META);

    expect(exitCode).toBe(0);
    expect(printTelemetryNotice).not.toHaveBeenCalled();
    expect(reportFinishedCommand).not.toHaveBeenCalled();
    expect(refreshLatestKnownVersion).not.toHaveBeenCalled();
    expect(printUpdateNotice).not.toHaveBeenCalled();
  });

  it('should still print the error of a completion command line', async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();

    const exitCode = await runCli(
      commandRegistry,
      ['completion', '--colour'],
      META,
    );

    expect(exitCode).toBe(2);
    expect(output.readStderr()).toBe(
      'Unknown option: --colour. Run the command with --help to see its options.\nhttps://hotcodepush.com/docs/cli/errors#E_INVALID_PARAMETER\n',
    );
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
