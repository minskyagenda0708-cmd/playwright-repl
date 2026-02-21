import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 30000,
  retries: 0,
  projects: [
    {
      name: 'panel',
      testDir: './e2e/panel',
    },
    {
      name: 'commands',
      testDir: './e2e/commands',
      timeout: 60000,
    },
  ],
});
