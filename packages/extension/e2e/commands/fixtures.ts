/**
 * Command integration test fixtures.
 *
 * Launches Chromium with the real extension loaded. Commands are sent via
 * chrome.runtime.sendMessage to the background service worker (playwright-crx),
 * with no Engine or CommandServer involved.
 */

import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export { expect } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../dist');

type ExtensionContext = { context: BrowserContext; extensionId: string; sw: Worker };

export const test = base.extend<
  { panelPage: Page; testPage: Page },
  { extensionContext: ExtensionContext }
>({
  // Worker-scoped: browser launched once, reused across all tests in a worker
  extensionContext: [async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: !process.env.HEADED,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    // Navigate the initial blank tab to a real page so auto-attach never sees about:blank
    const [initialPage] = context.pages();
    if (initialPage) await initialPage.goto('https://httpbin.org');

    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extensionId = sw.url().split('/')[2];

    await use({ context, extensionId, sw });
    await context.close();
  }, { scope: 'worker' }],

  // Test-scoped: fresh panel page per test
  panelPage: async ({ extensionContext }, use) => {
    const { context, extensionId } = extensionContext;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/panel/panel.html`);
    await page.waitForSelector('[data-testid="command-input"]', { timeout: 10000 });
    await use(page);
    await page.close();
  },

  // Test-scoped: target page navigated to playwright.dev, attached to extension
  testPage: async ({ extensionContext, panelPage }, use) => {
    const { context } = extensionContext;
    const page = await context.newPage();
    await page.goto('https://playwright.dev');

    // Bring to front so it's the active tab for chrome.tabs.query
    await page.bringToFront();

    // Attach the extension to the active tab
    await panelPage.evaluate(() =>
      new Promise(resolve =>
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([tab]) =>
          tab?.id
            ? chrome.runtime.sendMessage({ type: 'attach', tabId: tab.id }, resolve)
            : resolve({ ok: false })
        )
      )
    );

    await use(page);
    await page.close();
  },
});

/**
 * Send a REPL command via chrome.runtime.sendMessage from the panel context.
 * Bypasses the UI — goes directly to the background service worker.
 */
export async function sendCommand(
  panelPage: Page,
  command: string,
): Promise<{ text: string; isError: boolean; image?: string }> {
  return panelPage.evaluate((cmd) =>
    new Promise(resolve =>
      chrome.runtime.sendMessage({ type: 'run', command: cmd }, resolve)
    ), command
  );
}

/**
 * Submit a command through the panel UI (CodeMirror input → Enter).
 * Required for run-code which routes through the sandbox iframe, not the background.
 */
export async function sendViaUI(
  panelPage: Page,
  command: string,
): Promise<{ text: string; isError: boolean }> {
  const resultSelector = '[data-type="success"], [data-type="error"]';
  const prevCount = await panelPage.locator(resultSelector).count();

  await panelPage.getByTestId('command-input').locator('.cm-content').click();
  await panelPage.keyboard.type(command, { delay: 0 });
  await panelPage.keyboard.press('Escape'); // close autocomplete
  await panelPage.keyboard.press('Enter');

  // Wait for a new result line (sandbox init + async round-trip)
  await panelPage.waitForFunction(
    ({ sel, n }) => document.querySelectorAll(sel).length > n,
    { sel: resultSelector, n: prevCount },
    { timeout: 15000 },
  );

  const last = panelPage.locator(resultSelector).last();
  const text = (await last.textContent()) ?? '';
  const isError = (await last.getAttribute('data-type')) === 'error';
  return { text, isError };
}
