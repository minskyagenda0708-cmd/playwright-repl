#!/usr/bin/env node
/**
 * pw — drop-in replacement for npx playwright test
 *
 * 1. Pre-launches Chrome with playwright-crx extension
 * 2. Exposes wsEndpoint for Playwright workers to connect
 * 3. Workers connect via connectOptions (no browser launch per worker)
 * 4. Context reuse via pw-preload.cjs (no fresh context per test)
 *
 * Test files stay unchanged.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const require = createRequire(__filename);

const pwCliPath = require.resolve('@playwright/test/cli');
const preloadPath = path.resolve(path.dirname(__filename), '..', 'src', 'pw-preload.cjs');

const args = process.argv.slice(2);
if (args.length === 0 || (args[0] && args[0].startsWith('-'))) {
  args.unshift('test');
}

// Find extension dist path
const extPkgPath = require.resolve('@playwright-repl/extension/package.json');
const extPath = path.resolve(path.dirname(extPkgPath), 'dist');

// Pre-launch Chrome with extension
const t0 = Date.now();
const pw = require('playwright-core');
const browser = await pw.chromium.launchServer({
  headless: !args.includes('--headed'),
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-infobars',
  ],
});
const wsEndpoint = browser.wsEndpoint();
console.log(`Browser + extension ready (${Date.now() - t0}ms)`);

// Spawn Playwright CLI
const existingNodeOptions = process.env.NODE_OPTIONS || '';
const child = spawn(process.execPath, [pwCliPath, ...args], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: {
    ...process.env,
    PW_WS_ENDPOINT: wsEndpoint,
    PW_REUSE_CONTEXT: '1',
    NODE_OPTIONS: `${existingNodeOptions} --require ${preloadPath}`.trim(),
  },
});

child.on('exit', async (code) => {
  await browser.close();
  process.exit(code ?? 1);
});
