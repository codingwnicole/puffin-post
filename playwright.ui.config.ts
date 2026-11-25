import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// UI regression tests exercise the built app with mocked APIs. No Worker, live data or local server is needed.
const dist = resolve(process.env.UI_TEST_DIST ?? 'dist/client')
if (!existsSync(resolve(dist, 'index.html'))) throw new Error('Build the app first: npm.cmd run build')
process.env.UI_TEST_DIST = dist

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'ui-wheel-polish.spec.ts',
  outputDir: './test-results/ui',
  use: { baseURL: 'http://localhost:5173', serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
