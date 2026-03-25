import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './todomvc',
  timeout: 15000,
  workers: 2,
  fullyParallel: true,
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
