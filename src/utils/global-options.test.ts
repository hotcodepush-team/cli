import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommandOptions } from './global-options.js';

describe('defineCommandOptions', () => {
  it('should list the command options before the global ones', () => {
    const { schema } = defineCommandOptions({
      name: z.string().optional().describe('The channel name.'),
    });

    expect(Object.keys(schema.shape)).toEqual([
      'name',
      'app',
      'config',
      'help',
      'json',
      'organization',
      'verbose',
      'version',
      'yes',
    ]);
  });

  it("should describe a global option a command names itself with the command's description, among its own options", () => {
    const { schema } = defineCommandOptions({
      organization: z
        .string()
        .optional()
        .describe('The organization the app moves to, by id or name.'),
    });

    expect(Object.keys(schema.shape)).toEqual([
      'organization',
      'app',
      'config',
      'help',
      'json',
      'verbose',
      'version',
      'yes',
    ]);
    expect(schema.shape.organization.description).toBe(
      'The organization the app moves to, by id or name.',
    );
  });
});
