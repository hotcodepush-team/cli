import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    clearMocks: true,
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    setupFiles: ['test/ci-info.ts'],
    unstubEnvs: true,
  },
});
