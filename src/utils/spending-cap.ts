import { z } from 'zod';
import type { InteractivityOptions } from './environment.js';
import { promptText } from './prompts.js';

const CENTS_PER_DOLLAR = 100;

// whole dollars, as the cap is chosen; the API checks the range
const spendingCapSchema = z.coerce.number().int();

/**
 * The flag `billing update` and `checkout create` take, in whole dollars where the API counts cents.
 */
export const spendingCapShape = {
  spendingCap: spendingCapSchema
    .optional()
    .describe(
      'The most the organization pays a month, in whole dollars from 5 to 10000.',
    ),
};

/**
 * The cap asked for when the flag is missing and someone can answer, checked as the flag would be.
 */
export async function promptSpendingCap(
  options: InteractivityOptions,
): Promise<number> {
  const answer = await promptText(
    '--spending-cap',
    'What should the organization pay at most a month, in whole dollars?',
    options,
  );
  return z
    .object({ spendingCap: spendingCapSchema })
    .parse({ spendingCap: answer }).spendingCap;
}

/**
 * Whole dollars in the cents the API counts.
 */
export function resolveCents(dollars: number): number {
  return dollars * CENTS_PER_DOLLAR;
}

/**
 * Cents as the dollars a person chose, `$1,000`.
 */
export function resolveDollarText(cents: number): string {
  return `$${(cents / CENTS_PER_DOLLAR).toLocaleString('en-US')}`;
}
