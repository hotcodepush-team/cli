import { z } from 'zod';

export const monthOptionShape = {
  month: z
    .string()
    .optional()
    .describe('The month, YYYY-MM; the current one by default.'),
};

export function resolveMonthText(month: string): string {
  return new Date(`${month}-01T00:00:00.000Z`).toLocaleString('en-US', {
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  });
}
