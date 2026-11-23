import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const durableObjectShim = fileURLToPath(new URL('./tests/durable-object-base.ts', import.meta.url))

export default defineConfig({
  resolve: { alias: { 'cloudflare:workers': durableObjectShim } },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // Keep integration-worker concurrency bounded: unbounded miniflare workers cause
    // sporadic 5s timeouts (e.g. character-archive-delete) under parallel load.
    maxWorkers: 4,
  },
})
