import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { resolveDiagnosticText } from '../../test/diagnostics.js';
import { runCli } from './cli.js';
import type { CommandRegistry } from './command-registry.js';
import { defineCommand } from './command.js';
import { MissingParameterError } from './errors.js';
import { defineCommandOptions } from './global-options.js';
import { printTelemetryNotice, reportFinishedCommand } from './telemetry.js';
import {
  printUpdateNotice,
  refreshLatestKnownVersion,
} from './update-notice.js';

const keyring = vi.hoisted(() => ({
  deletePassword: vi.fn(),
  getPassword: vi.fn(),
  setPassword: vi.fn(),
}));

vi.mock('@napi-rs/keyring', () => ({
  Entry: vi.fn(function () {
    return keyring;
  }),
}));
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
          rolloutPercent: z.coerce.number().max(100).optional(),
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
    readDiagnostics: () =>
      resolveDiagnosticText(
        stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join(''),
      ),
    readStdout: () =>
      stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join(''),
  };
}

// CI makes the run non-interactive, and a config folder that does not exist keeps a token on the machine out.
function stubMissingSession() {
  vi.stubEnv('CI', 'true');
  vi.stubEnv('HOTCODEPUSH_TOKEN', '');
  const configHomePath = join(tmpdir(), `hotcodepush-${randomUUID()}`);
  vi.stubEnv('APPDATA', configHomePath);
  vi.stubEnv('XDG_CONFIG_HOME', configHomePath);
}

function stubExit() {
  return vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new ExitCalled();
  });
}

describe('runCli', () => {
  beforeEach(() => {
    vi.stubEnv('CI', undefined);
    vi.stubEnv('HOTCODEPUSH_TOKEN', 'cli-test-token');
  });

  it('should run the command with its options and the global ones', async () => {
    const { channelCreateAction, commandRegistry } = createCommandTree();

    const exitCode = await runCli(
      commandRegistry,
      [
        'channel',
        'create',
        '--name',
        'beta',
        '--rollout-percent',
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
        rolloutPercent: 50,
        yes: true,
      }),
      [],
    );
  });

  it('should stop with `not_logged_in` before the action when no session exists and the run is not interactive', async () => {
    const { channelCreateAction, commandRegistry } = createCommandTree();
    const output = captureOutput();
    stubMissingSession();

    const exitCode = await runCli(commandRegistry, ['channel', 'create'], META);

    expect(exitCode).toBe(3);
    expect(channelCreateAction).not.toHaveBeenCalled();
    expect(output.readDiagnostics()).toBe(
      'You are not logged in.\nRun "hotcodepush login" or set HOTCODEPUSH_TOKEN.\nhttps://hotcodepush.com/docs/cli/errors#not_logged_in\n',
    );
  });

  it('should run a command whose authentication is optional without a session', async () => {
    const doctorAction = vi.fn();
    stubMissingSession();
    const commandRegistry: CommandRegistry = {
      doctor: async () => ({
        default: defineCommand({
          description: 'Check the project.',
          authentication: 'optional',
          examples: ['hotcodepush doctor', 'hotcodepush doctor --json'],
          options: defineCommandOptions({}),
          action: doctorAction,
        }),
      }),
    };

    const exitCode = await runCli(commandRegistry, ['doctor'], META);

    expect(exitCode).toBe(0);
    expect(doctorAction).toHaveBeenCalled();
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
    expect(output.readDiagnostics()).toBe(
      'No value was given for --token.\nPass --token, or run the command interactively to be asked for it.\nhttps://hotcodepush.com/docs/cli/errors#missing_parameter\n',
    );
  });

  it('should print only the JSON error on stdout when --json is passed', async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();

    await runCli(commandRegistry, ['login', '--json'], META);

    expect(JSON.parse(output.readStdout())).toEqual({
      error: {
        code: 'missing_parameter',
        fix: 'Pass --token, or run the command interactively to be asked for it.',
        message: 'No value was given for --token.',
      },
    });
    expect(output.readDiagnostics()).toBe('');
  });

  it('should answer `invalid_parameter` with exit code 2 when an option is invalid', async () => {
    const { channelCreateAction, commandRegistry } = createCommandTree();
    const output = captureOutput();

    const exitCode = await runCli(
      commandRegistry,
      ['channel', 'create', '--rollout-percent', '120', '--json'],
      META,
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(output.readStdout()).error.code).toBe(
      'invalid_parameter',
    );
    expect(channelCreateAction).not.toHaveBeenCalled();
  });

  it('should answer `invalid_parameter` when an option is unknown', async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();

    const exitCode = await runCli(
      commandRegistry,
      ['channel', 'create', '--colour'],
      META,
    );

    expect(exitCode).toBe(2);
    expect(output.readDiagnostics()).toBe(
      'Unknown option: --colour.\nRun the command with --help to see its options.\nhttps://hotcodepush.com/docs/cli/errors#invalid_parameter\n',
    );
  });

  it('should suggest the closest command when the command is unknown', async () => {
    const { commandRegistry } = createCommandTree();
    const output = captureOutput();

    const exitCode = await runCli(commandRegistry, ['chanel', 'create'], META);

    expect(exitCode).toBe(1);
    expect(output.readDiagnostics()).toBe(
      'There is no command "chanel create".\nDid you mean "channel create"?\nhttps://hotcodepush.com/docs/cli/errors#unknown_command\n',
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
        code: 'invalid_parameter',
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
    expect(output.readDiagnostics()).toBe(
      'Unknown option: --colour.\nRun the command with --help to see its options.\nhttps://hotcodepush.com/docs/cli/errors#invalid_parameter\n',
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
