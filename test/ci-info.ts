import { vi } from 'vitest';

// `ci-info` reads the environment once on import, before a test stubs `CI`.
// Its stand-in follows `CI` on every read, `CI=false` included, and names no provider unless a test spies on `name`.
vi.mock('ci-info', () => ({
  get isCI() {
    return process.env.CI !== 'false' && Boolean(process.env.CI);
  },
  get name() {
    return null;
  },
}));
