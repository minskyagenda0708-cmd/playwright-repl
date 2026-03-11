/**
 * Bridge E2E test fixtures.
 *
 * Launches Chromium with the real extension loaded + a BridgeServer on a random port.
 * The extension's offscreen document connects via WebSocket after bridgePort is set.
 * Commands are sent via bridge.run() — no panel UI involved.
 */

import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { BridgeServer } from '../../../core/dist/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export { expect } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../dist');
// Use port 0 so the OS assigns a random available port — avoids clashing with
// a real extension instance that auto-connects to the default port (9876).
const BRIDGE_PORT = 0;

type BridgeContext = {
  context: BrowserContext;
  extensionId: string;
  sw: Worker;
  bridge: BridgeServer;
};

export const test = base.extend<
  // Test-scoped: auto-use fixture that reconnects the bridge before each test
  { _reconnect: void },
  { bridgeContext: BridgeContext }
>({
  // Force fresh WebSocket connection before each test
  _reconnect: [async ({ bridgeContext }, use) => {
    await bridgeContext.bridge.reconnect();
    await use();
  }, { auto: true }],
  // Worker-scoped: BridgeServer + browser, reused across all tests in a worker
  bridgeContext: [async ({}, use) => {
    // 1. Start BridgeServer BEFORE the browser so the offscreen doc connects on init
    const bridge = new BridgeServer();
    await bridge.start(BRIDGE_PORT);

    // 2. Launch browser with extension
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

    // 3. Get extension ID from service worker
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extensionId = sw.url().split('/')[2];

    // 4. Tell the test extension to connect to our random port.
    //    The offscreen doc defaults to 9876, which fails (no server there).
    //    Setting bridgePort in chrome.storage triggers background.ts to broadcast
    //    'bridge-port-changed', so the offscreen doc reconnects to our port.
    const actualPort = bridge.port;
    const [initialPage] = context.pages();
    if (initialPage) {
      await initialPage.goto(`chrome-extension://${extensionId}/panel/panel.html`);
      await initialPage.evaluate((p) => chrome.storage.local.set({ bridgePort: p }), actualPort);
      await initialPage.goto('https://httpbin.org');
      await initialPage.bringToFront();
    }

    // 5. Wait for offscreen document to connect via WebSocket
    await bridge.waitForConnection(30000);

    // 6. Small delay to let Chrome register the active tab for chrome.tabs.query
    await new Promise(r => setTimeout(r, 500));

    await use({ context, extensionId, sw, bridge });

    // Close browser first (terminates WebSocket client), then bridge server
    await context.close();
    // bridge.close() can hang if wss.close waits for dead connections — use timeout
    const closed = await Promise.race([
      bridge.close().then(() => true),
      new Promise<false>(r => setTimeout(() => r(false), 5000)),
    ]);
    if (!closed) {
      // Force-kill: terminate lingering connections so the port is freed
      (bridge as any).wss?.clients?.forEach((ws: any) => ws.terminate());
      await bridge.close().catch(() => {});
    }
  }, { scope: 'worker' }],

});
