import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages, resolveNextOffset } from './pagination.js';

describe('pagination', () => {
  describe('fetchAllPages', () => {
    it('should fetch pages of 100 until one comes back shorter', async () => {
      const fetchPage = vi.fn(async ({ offset }: { offset: number }) =>
        Array.from({ length: offset === 0 ? 100 : 3 }, (_, index) => ({
          index: offset + index,
        })),
      );

      const fetchedItems = await fetchAllPages(fetchPage);

      expect(fetchedItems).toHaveLength(103);
      expect(fetchPage.mock.calls).toEqual([
        [{ limit: 100, offset: 0 }],
        [{ limit: 100, offset: 100 }],
      ]);
    });
  });

  describe('resolveNextOffset', () => {
    it.each([
      [50, {}, 50],
      [49, {}, null],
      [10, { limit: 10, offset: 20 }, 30],
      [0, { limit: 10, offset: 20 }, null],
    ])(
      'should resolve %i items of the page %o to the next offset %o',
      (itemCount, page, nextOffset) => {
        expect(resolveNextOffset(itemCount, page)).toBe(nextOffset);
      },
    );
  });
});
