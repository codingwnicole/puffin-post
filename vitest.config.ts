import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // Keep integration-worker concurrency bounded: unbounded miniflare workers cause
    // sporadic 5s timeouts (e.g. character-archive-delete) under parallel load.
    maxWorkers: 4,
  },
})
