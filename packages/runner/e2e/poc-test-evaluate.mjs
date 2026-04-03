#!/usr/bin/env node
/**
 * POC: Run a compiled test file via serviceWorker.evaluate()
 * instead of the WebSocket bridge.
 *
 * Usage: node packages/runner/e2e/poc-test-evaluate.mjs
 */

import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const EXTENSION_PATH = path.resolve(__dirname, '../../extension/dist');

// Use the existing compile function from bridge-utils
const { compile, needsNode } = require('../dist/bridge-utils.cjs');

const testFile = path.resolve(__dirname, '../examples/todomvc/adding-todos/should-add-single-todo.spec.ts');

async function main() {
  console.log(`Test file: ${path.relative(process.cwd(), testFile)}`);
  console.log(`Needs Node: ${needsNode(testFile)}`);

  // 1. Compile the test file
  console.log('Compiling...');
  const compiled = await compile(testFile);
  console.log(`Compiled: ${compiled.length} chars`);

  // 2. Launch Chrome with extension
  console.log('Launching Chrome with extension...');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker');

  // Navigate to the test page
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://demo.playwright.dev/todomvc/');
  await new Promise(r => setTimeout(r, 1000));

  // Attach to the tab
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true });
    if (tab?.id) await self.handleBridgeCommand({ command: `goto ${tab.url}`, scriptType: 'command' });
  });

  // 3. Send compiled test to service worker and run it
  console.log('Running test via serviceWorker.evaluate()...\n');

  const result = await sw.evaluate(async (code) => {
    // Evaluate the compiled IIFE (registers tests via shim)
    eval(code);
    // Run the registered tests
    return await (globalThis).__runTests();
  }, compiled);

  console.log(result);

  // 4. Cleanup
  await context.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
