declare const __BUILD_REVISION__: string | undefined
// ponytail: falls back to 'dev' where vite's define isn't applied (e.g. some test runners).
export const BUILD_REVISION = typeof __BUILD_REVISION__ === 'string' ? __BUILD_REVISION__ : 'dev'
