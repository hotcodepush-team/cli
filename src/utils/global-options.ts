import { z } from 'zod';
import { defineOptions } from 'zodline';

const globalOptionsShape = {
  app: z
    .string()
    .optional()
    .describe(
      'The app, by id or name, when no hotcodepush.json is found or another app is meant.',
    ),
  config: z
    .string()
    .optional()
    .describe(
      'The hotcodepush.json to use, when it is not the nearest one up from the working directory.',
    ),
  json: z
    .boolean()
    .optional()
    .describe('Print machine output as JSON on stdout and ask nothing.'),
  organization: z
    .string()
    .optional()
    .describe('The organization, by id or name, when you belong to several.'),
  verbose: z.boolean().optional().describe('Print the detail behind an error.'),
  yes: z
    .boolean()
    .optional()
    .describe('Take every default, ask nothing, confirm nothing.'),
};

/**
 * The options of a command: its own, then the global ones every command accepts.
 */
export function defineCommandOptions<TShape extends z.ZodRawShape>(
  shape: TShape,
) {
  return defineOptions(z.object({ ...shape, ...globalOptionsShape }), {
    y: 'yes',
  });
}
