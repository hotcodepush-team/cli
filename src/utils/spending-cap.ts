import { z } from 'zod';

const CENTS_PER_DOLLAR = 100;

/**
 * The flag `organization update` takes, in whole dollars where the API counts cents; the API checks the range.
 */
export const spendingCapShape = {
  spendingCap: z.coerce
    .number()
    .int()
    .optional()
    .describe(
      'The most the organization pays a month, in whole dollars from $5 to $10,000.',
    ),
};

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
