import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testIgnore: ['playwright-tests/**'],  // exclude until pageTest wrapper is fixed
  timeout: 15000,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
