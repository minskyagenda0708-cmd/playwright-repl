/**
 * End-to-end test: bundle a .spec.ts file and run it through the bridge.
 */
import { BridgeServer } from './packages/core/dist/index.js';
import { chromium } from 'playwright-core';
import path from 'node:path';
import esbuild from 'esbuild';
import fs from 'node:fs';

const extPath = path.resolve('packages/extension/dist');
const shimPath = path.resolve('packages/vscode/src/shim/test-runner.ts');
const testFile = path.resolve('test-sample.spec.ts');

// 1. Bundle the test file
console.log('Bundling test file...');
const result = await esbuild.build({
  entryPoints: [testFile],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: '__tests',
  platform: 'browser',
  alias: { '@playwright/test': shimPath },
  external: ['fs', 'path', 'child_process', 'os', 'crypto'],
});
const script = result.outputFiles[0].text + '\n\nawait globalThis.__runTests();\n';
console.log(`Bundle: ${script.length} bytes`);

// 2. Start bridge
const bridge = new BridgeServer();
await bridge.start(9876);
console.log('BridgeServer on port', bridge.port);

// 3. Launch Chrome with extension
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: false,
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
console.log('Extension loaded');

await bridge.waitForConnection(30000);
console.log('Bridge connected');

// 4. Navigate to a page so the extension can attach
const page = ctx.pages()[0];
await page.goto('https://example.com');
await new Promise(r => setTimeout(r, 1000));

// 5. Run a simple command first to ensure attachment
const snap = await bridge.run('snapshot');
console.log('Snapshot OK:', !snap.isError);

// 6. Run the bundled test script
console.log('\nRunning tests...\n');
const testResult = await bridge.runScript(script, 'javascript');
console.log(testResult.text);
if (testResult.isError) console.error('ERROR:', testResult.text);

// 7. Cleanup
await ctx.close();
await bridge.close();
process.exit(0);
