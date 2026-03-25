import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './todomvc',
  timeout: 15000,
  fullyParallel: true,
  workers: 1,
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // pw-cli sets PW_WS_ENDPOINT → connect to pre-launched browser
        // npx playwright test → launches own browser (no env var)
        ...(process.env.PW_WS_ENDPOINT ? {
          connectOptions: { wsEndpoint: process.env.PW_WS_ENDPOINT },
        } : {}),
      },
    },
  ],
});
