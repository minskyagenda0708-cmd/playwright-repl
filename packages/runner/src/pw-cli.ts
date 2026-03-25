#!/usr/bin/env node
/**
 * pw — drop-in replacement for npx playwright test
 *
 * Spawns Playwright's CLI as a child process, with PW_CUSTOM_WORKER
 * env variable pointing to our custom worker. The worker is loaded
 * by a patched workerMain that delegates to our bridge/node hybrid.
 *
 * Phase 1: Pass-through (prove the CLI works)
 * Phase 2: Custom worker with bridge routing
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const require = createRequire(__filename);

// Find Playwright's CLI
const pwCliPath = require.resolve('@playwright/test/cli');

// Our custom worker path
const customWorkerPath = path.resolve(path.dirname(__filename), 'pw-worker.js');

// Pass all args through, default to 'test' command
const args = process.argv.slice(2);
if (args.length === 0 || (args[0] && args[0].startsWith('-'))) {
  args.unshift('test');
}

const child = spawn(process.execPath, [pwCliPath, ...args], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: {
    ...process.env,
    PW_CUSTOM_WORKER: customWorkerPath,
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
