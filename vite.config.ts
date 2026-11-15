import { execSync } from 'node:child_process'
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// B17: stamp the git revision into worker + client so the live origin can be verified.
const revision = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'unknown' } })()

export default defineConfig({ plugins: [react(), cloudflare()], define: { __BUILD_REVISION__: JSON.stringify(revision) } })
