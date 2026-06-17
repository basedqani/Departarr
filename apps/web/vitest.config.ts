import { defineConfig } from 'vitest/config'

// Standalone vitest config for the web workspace. The tz/formatting helpers are
// pure (Intl-based) and need no DOM, so we use the default node environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
