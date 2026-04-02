import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  reporter: process.env.CI ? 'html' : 'list',
  timeout: 120_000,
  workers: 1,
  expect: {
    timeout: 30_000,
  },
  globalSetup: './globalSetup',
});
