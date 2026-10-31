import { z } from 'zod';

interface Page {
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT = 50;

const MAX_LIMIT = 100;

export const paginationShape = {
  limit: z.coerce
    .number()
    .int()
    .optional()
    .describe(
      `How many to list, at most ${MAX_LIMIT}; ${DEFAULT_LIMIT} by default.`,
    ),
  offset: z.coerce
    .number()
    .int()
    .optional()
    .describe('How many to skip: the offset the previous page ended with.'),
};

export async function fetchAllPages<TItem>(
  fetchPage: (page: Required<Page>) => Promise<TItem[]>,
  limit = MAX_LIMIT,
): Promise<TItem[]> {
  const fetchedItems: TItem[] = [];
  for (let offset = 0; ; offset += limit) {
    const fetchedPage = await fetchPage({ limit, offset });
    fetchedItems.push(...fetchedPage);
    if (fetchedPage.length < limit) {
      return fetchedItems;
    }
  }
}

// The API answers a plain array without a total, so a full page implies another.
export function resolveNextOffset(
  itemCount: number,
  { limit = DEFAULT_LIMIT, offset = 0 }: Page,
): number | null {
  return itemCount < limit ? null : offset + limit;
}
