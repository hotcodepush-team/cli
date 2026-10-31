import { z } from 'zod';

const CENTS_PER_DOLLAR = 100;

// The flag takes whole dollars, while the API counts cents and checks the range.
export const spendingCapShape = {
  spendingCap: z.coerce
    .number()
    .int()
    .optional()
    .describe(
      'The most the organization pays a month, in whole dollars from $5 to $10,000.',
    ),
};

export function resolveCents(dollars: number): number {
  return dollars * CENTS_PER_DOLLAR;
}

export function resolveDollarText(cents: number): string {
  return `$${(cents / CENTS_PER_DOLLAR).toLocaleString('en-US')}`;
}
