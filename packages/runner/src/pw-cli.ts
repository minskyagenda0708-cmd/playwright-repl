#!/usr/bin/env node
/**
 * pw — drop-in replacement for npx playwright test
 *
 * Spawns Playwright CLI with NODE_OPTIONS --require to preload
 * pw-preload.cjs, which patches browser.newContext to reuse one
 * context/page per worker instead of creating fresh ones per test.
 *
 * Each worker still launches its own browser (true parallelism).
 * No pre-launch needed — Playwright handles browser lifecycle.
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

const existingNodeOptions = process.env.NODE_OPTIONS || '';
const child = spawn(process.execPath, [pwCliPath, ...args], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: {
    ...process.env,
    PW_REUSE_CONTEXT: '1',
    NODE_OPTIONS: `${existingNodeOptions} --require ${preloadPath}`.trim(),
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
