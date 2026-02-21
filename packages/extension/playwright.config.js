import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  use: {
    headless: false,
  },
  projects: [
    {
      name: 'extension',
      use: {
        launchOptions: {
          args: [
            ...(process.env.HEADED ? [] : ['--headless=new']),
            `--disable-extensions-except=${__dirname}`,
            `--load-extension=${__dirname}`,
            '--no-first-run',
            '--no-default-browser-check',
          ],
        },
      },
    },
  ],
});
