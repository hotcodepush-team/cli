import { describe, expect, it } from 'vitest';
import { ACME_ORGANIZATION, GLOBEX_ORGANIZATION } from '../../test/fixtures.js';
import { resolveMonthlyActiveDeviceCountLimit } from './spending-cap.js';

describe('spending cap', () => {
  describe('resolveMonthlyActiveDeviceCountLimit', () => {
    it("should resolve an Enterprise organization to its deal's limit", () => {
      expect(
        resolveMonthlyActiveDeviceCountLimit({
          ...GLOBEX_ORGANIZATION,
          enterpriseMonthlyActiveDeviceCountLimit: 250_000,
          plan: 'enterprise',
        }),
      ).toBe(250_000);
    });

    it('should resolve no limit when the Enterprise deal sets none', () => {
      expect(
        resolveMonthlyActiveDeviceCountLimit({
          ...GLOBEX_ORGANIZATION,
          plan: 'enterprise',
        }),
      ).toBeNull();
    });

    it('should resolve a Free organization to 1,000 devices', () => {
      expect(resolveMonthlyActiveDeviceCountLimit(ACME_ORGANIZATION)).toBe(
        1000,
      );
    });

    it.each(['canceled', 'unpaid'])(
      'should resolve no device when the subscription is %s',
      subscriptionStatus => {
        expect(
          resolveMonthlyActiveDeviceCountLimit({
            ...GLOBEX_ORGANIZATION,
            subscriptionStatus,
          }),
        ).toBe(0);
      },
    );

    it.each(['active', 'past_due'])(
      'should resolve 1,000 devices a dollar of the spending cap when the subscription is %s',
      subscriptionStatus => {
        expect(
          resolveMonthlyActiveDeviceCountLimit({
            ...GLOBEX_ORGANIZATION,
            subscriptionStatus,
          }),
        ).toBe(50_000);
      },
    );
  });
});
