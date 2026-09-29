import { describe, expect, it, vi } from 'vitest';
import { defineCommand } from 'zodline';
import type { CommandRegistry } from './command-registry.js';
import {
  loadCommands,
  resolveClosestCommandName,
  resolveCommandName,
  resolveInvocation,
} from './command-registry.js';
import { UnknownCommandError } from './errors.js';

const COMMAND_NAMES = [
  'channel create',
  'channel list',
  'fingerprint',
  'fingerprint diff',
  'login',
  'release create',
];

describe('command registry', () => {
  describe('resolveCommandName', () => {
    it('should resolve the longest name the words spell', () => {
      expect(
        resolveCommandName(COMMAND_NAMES, ['fingerprint', 'diff', 'a', 'b']),
      ).toBe('fingerprint diff');
    });

    it('should resolve a shorter name when the next word is an argument', () => {
      expect(resolveCommandName(COMMAND_NAMES, ['fingerprint', 'a'])).toBe(
        'fingerprint',
      );
    });

    it('should resolve nothing when no name matches', () => {
      expect(resolveCommandName(COMMAND_NAMES, ['channel'])).toBeUndefined();
    });
  });

  describe('resolveInvocation', () => {
    it('should load only the command the words name', () => {
      expect(
        resolveInvocation(COMMAND_NAMES, [
          'channel',
          'create',
          '--name',
          'beta',
        ]),
      ).toEqual({
        argv: ['channel', 'create', '--name', 'beta'],
        commandNames: ['channel create'],
      });
    });

    it("should show the noun's verbs when a noun is given alone", () => {
      expect(resolveInvocation(COMMAND_NAMES, ['channel'])).toEqual({
        argv: ['channel', '--help'],
        commandNames: ['channel create', 'channel list'],
      });
    });

    it('should show the help when no command is given', () => {
      expect(resolveInvocation(COMMAND_NAMES, ['--json'])).toEqual({
        argv: ['--json', '--help'],
        commandNames: COMMAND_NAMES,
      });
    });

    it('should not repeat --help when it is already given', () => {
      expect(resolveInvocation(COMMAND_NAMES, ['-h']).argv).toEqual(['--help']);
    });

    it('should expand -h and -v to --help and --version', () => {
      expect(
        resolveInvocation(COMMAND_NAMES, ['release', 'create', '-h']).argv,
      ).toEqual(['release', 'create', '--help']);
      expect(resolveInvocation(COMMAND_NAMES, ['-v']).argv).toEqual([
        '--version',
        '--help',
      ]);
    });

    it('should throw E_UNKNOWN_COMMAND with the closest command when the words name none', () => {
      expect(() =>
        resolveInvocation(COMMAND_NAMES, ['channel', 'creat']),
      ).toThrow(new UnknownCommandError('channel creat', 'channel create'));
    });
  });

  describe('resolveClosestCommandName', () => {
    it('should suggest the command one typo away', () => {
      expect(
        resolveClosestCommandName(COMMAND_NAMES, ['relese', 'create']),
      ).toBe('release create');
    });

    it('should suggest the command when two letters are swapped', () => {
      expect(resolveClosestCommandName(COMMAND_NAMES, ['lgoin'])).toBe('login');
    });

    it('should compare only as many words as the command has', () => {
      expect(
        resolveClosestCommandName(COMMAND_NAMES, ['chanel', 'list', 'beta']),
      ).toBe('channel list');
    });

    it('should suggest nothing when no command is close', () => {
      expect(
        resolveClosestCommandName(COMMAND_NAMES, ['deploy']),
      ).toBeUndefined();
    });
  });

  describe('loadCommands', () => {
    it('should import only the commands asked for', async () => {
      const channelCreate = defineCommand({ action: () => undefined });
      const commandRegistry: CommandRegistry = {
        'channel create': vi.fn(async () => ({ default: channelCreate })),
        'login': vi.fn(async () => ({
          default: defineCommand({ action: () => undefined }),
        })),
      };

      const loadedCommands = await loadCommands(commandRegistry, [
        'channel create',
      ]);

      expect(loadedCommands).toEqual({ 'channel create': channelCreate });
      expect(commandRegistry.login).not.toHaveBeenCalled();
    });
  });
});
