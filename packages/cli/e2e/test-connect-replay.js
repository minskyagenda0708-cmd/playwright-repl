#!/usr/bin/env node
/**
 * E2E test for --connect --replay: spawns the CLI, launches Chrome with
 * the extension, connects them via CDP relay, and verifies the CLI exits
 * with code 0.
 *
 * Usage:  node packages/cli/e2e/test-connect-replay.js
 *         node packages/cli/e2e/test-connect-replay.js --headed
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const headed = process.argv.includes('--headed');
const EXTENSION_PATH = path.resolve(__dirname, '../../extension/dist');
const CLI_PATH = path.resolve(__dirname, '../dist/playwright-repl.js');
const EXAMPLES_DIR = path.resolve(__dirname, '../examples');
const RELAY_PORT = 19877;

// video-start/video-stop and tracing-start/tracing-stop require chrome.tabCapture
// and chrome.debugger tracing APIs — only available inside the extension context,
// not through CDP relay.
const SKIP_FILES = ['10-video-recording.pw', '11-tracing.pw'];

async function main() {
  // Collect .pw files, excluding extension-only examples
  const replayFiles = fs.readdirSync(EXAMPLES_DIR)
    .filter(f => f.endsWith('.pw') && !SKIP_FILES.includes(f))
    .map(f => path.join(EXAMPLES_DIR, f));

  // 1. Spawn CLI — starts CDPRelayServer and waits for extension to connect
  const cli = spawn('node', [
    CLI_PATH, '--connect', '--port', String(RELAY_PORT),
    '--replay', ...replayFiles,
  ]);

  let stdout = '';
  let stderr = '';
  cli.stdout.on('data', (chunk) => { stdout += chunk; process.stdout.write(chunk); });
  cli.stderr.on('data', (chunk) => { stderr += chunk; process.stderr.write(chunk); });

  // Wait for CLI to start its relay server
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`CLI didn't start relay server.\nstdout: ${stdout}\nstderr: ${stderr}`)),
      15_000,
    );
    const check = () => {
      if (stdout.includes('CDP relay listening')) { clearTimeout(timer); resolve(undefined); }
      else setTimeout(check, 100);
    };
    check();
  });

  // 2. Launch browser with extension
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: !headed,
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

  // 4. Tell extension to connect to CLI's relay port
  const [page] = context.pages();
  await page.goto(`chrome-extension://${extensionId}/panel/panel.html`);
  await page.evaluate((p) => chrome.storage.local.set({ relayPort: p }), RELAY_PORT);
  await page.goto('about:blank');
  await page.bringToFront();

  // Small delay for chrome.tabs.query to register the active tab
  await new Promise(r => setTimeout(r, 500));

  // 5. Wait for CLI to finish replaying
  const exitCode = await new Promise((resolve) => {
    cli.on('close', (code) => resolve(code ?? 1));
  });

  // 6. Cleanup (persistent context with extensions may hang on close on Windows/macOS)
  const timeout = new Promise(r => setTimeout(r, 3000));
  await Promise.race([context.close(), timeout]).catch(() => {});

  // 7. Report
  if (exitCode === 0) {
    console.log('\n\u2705 Connect replay test passed');
  } else {
    console.error(`\n\u274C Connect replay test failed (exit code ${exitCode})`);
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
