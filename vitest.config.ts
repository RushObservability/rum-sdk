import { defineConfig } from 'vitest/config'

// Tests live in test/ (outside src/) so `tsc --noEmit` over src stays clean and
// tsup never bundles them. happy-dom gives us window/document/navigator/storage
// without a full browser.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['test/**/*.test.ts'],
  },
})
