import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/browser',
  use: { browserName: 'chromium' },
  workers: 1,
  reporter: 'list',
})
