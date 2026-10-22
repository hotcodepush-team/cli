import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { booleanFlagSchema } from '../boolean-flag.js';
import type { Command } from '../command-registry.js';
import { defineCommandOptions } from '../global-options.js';
import { resolveCommandTree } from './command-tree.js';

const STUB_COMMANDS: Record<string, Command> = {
  'channel create': defineCommand({
    description: 'Create a channel.',
    options: defineCommandOptions({
      failureAction: z
        .enum(['none', 'pause'])
        .optional()
        .describe('What auto-pause does.'),
      failureThreshold: z.coerce
        .number()
        .optional()
        .describe('The failure percentage.'),
      platform: z
        .string()
        .transform(text => text.split(','))
        .pipe(z.array(z.enum(['android', 'ios'])))
        .optional()
        .describe('The platforms.'),
      protected: booleanFlagSchema
        .optional()
        .describe('Whether only Owners change it.'),
    }),
    action: () => undefined,
  }),
  'channel list': defineCommand({
    description: 'List the channels.',
    options: defineCommandOptions({}),
    action: () => undefined,
  }),
  'fingerprint': defineCommand({
    description: 'Print the fingerprint.',
    options: defineCommandOptions({}),
    action: () => undefined,
  }),
  'fingerprint diff': defineCommand({
    description: 'Print what moved.',
    options: defineCommandOptions({}),
    action: () => undefined,
  }),
  'whoami': defineCommand({
    description: 'Print the user.',
    options: defineCommandOptions({}),
    action: () => undefined,
  }),
};

const GLOBAL_FLAG_NAMES = [
  'app',
  'config',
  'help',
  'json',
  'organization',
  'verbose',
  'version',
  'yes',
];

describe('resolveCommandTree', () => {
  const tree = resolveCommandTree(STUB_COMMANDS);
  const [channel, fingerprint] = tree;
  const channelCreate = channel?.verbs[0];

  it("should nest each noun's verbs below it beside the standalone commands", () => {
    expect(
      tree.map(({ name, verbs }) => [name, verbs.map(verb => verb.name)]),
    ).toEqual([
      ['channel', ['create', 'list']],
      ['fingerprint', ['diff']],
      ['whoami', []],
    ]);
  });

  it('should describe a noun that runs nothing by its verbs', () => {
    expect(channel).toMatchObject({
      description: 'create, list',
      options: [],
    });
  });

  it('should keep the description and options of a standalone command that is a noun too', () => {
    expect(fingerprint?.description).toBe('Print the fingerprint.');
    expect(fingerprint?.options.map(({ name }) => name)).toEqual(
      GLOBAL_FLAG_NAMES,
    );
  });

  it('should take each option as its kebab-case flag with its description, the own ones first', () => {
    expect(channelCreate?.options.slice(0, 4)).toEqual([
      {
        choices: ['none', 'pause'],
        description: 'What auto-pause does.',
        hasValue: true,
        name: 'failure-action',
      },
      {
        choices: [],
        description: 'The failure percentage.',
        hasValue: true,
        name: 'failure-threshold',
      },
      {
        choices: ['android', 'ios'],
        description: 'The platforms.',
        hasValue: true,
        name: 'platform',
      },
      {
        choices: [],
        description: 'Whether only Owners change it.',
        hasValue: false,
        name: 'protected',
      },
    ]);
  });

  it('should give every command the global flags, the boolean ones without a value', () => {
    for (const command of [channelCreate, fingerprint, tree[2]]) {
      expect(
        command?.options
          .filter(({ name }) => GLOBAL_FLAG_NAMES.includes(name))
          .map(({ hasValue, name }) => [name, hasValue]),
      ).toEqual([
        ['app', true],
        ['config', true],
        ['help', false],
        ['json', false],
        ['organization', true],
        ['verbose', false],
        ['version', false],
        ['yes', false],
      ]);
    }
  });
});
