/**
 * E2E test fixtures — launches Chromium with the extension loaded,
 * sets up page.route() mocking, and provides fixtures to tests.
 */

import { test as base, chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../..');

/**
 * Custom test fixtures for the extension panel.
 *
 * Worker-scoped: browser context is shared across all tests in a worker.
 * Test-scoped: panelPage and mockResponse reset per test.
 */
export const test = base.extend({
  // Worker-scoped: launch browser once, reuse across tests
  extensionContext: [async ({}, use) => {
    const headlessArgs = process.env.HEADED ? [] : ['--headless=new'];

    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        ...headlessArgs,
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    // Get extension ID from the service worker URL
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extensionId = sw.url().split('/')[2];

    // Context-level route: applies to all pages, set up once
    await context.route('**/health', (route) => {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', version: '0.4.0-test' }),
      });
    });

    await use({ context, extensionId });
    await context.close();
  }, { scope: 'worker' }],

  // Test-scoped: fresh panelPage with route mocking for each test
  panelPage: async ({ extensionContext }, use) => {
    const { context, extensionId } = extensionContext;
    const page = await context.newPage();

    page._runResponse = { text: 'OK', isError: false };

    await page.route('**/run', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(page._runResponse),
      });
    });

    await page.goto(`chrome-extension://${extensionId}/panel/panel.html`);
    await page.waitForSelector('.line-info', { timeout: 10000 });

    await use(page);
    await page.close();
  },

  mockResponse: async ({ panelPage }, use) => {
    await use((response) => { panelPage._runResponse = response; });
  },
});

export { expect } from '@playwright/test';
