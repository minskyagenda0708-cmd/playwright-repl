#!/usr/bin/env node
/**
 * pw — drop-in replacement for npx playwright test
 *
 * 1. Spawns Playwright CLI with custom worker via --require preload
 * 2. Each worker lazily launches its own browser + bridge (reused across test groups)
 * 3. Worker compiles test → sends to bridge (one call) → results back
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const require = createRequire(__filename);

const pwCliPath = require.resolve('@playwright/test/cli');
const preloadPath = path.resolve(path.dirname(__filename), 'pw-preload.cjs');
// Chrome extension: bundled in dist/chrome-extension/ (npm), or monorepo fallback (dev)
import fs from 'node:fs';
const bundledExt = path.resolve(path.dirname(__filename), 'chrome-extension');
const monorepoExt = path.resolve(path.dirname(__filename), '../../extension/dist');
const extPath = fs.existsSync(path.join(bundledExt, 'manifest.json'))
  ? bundledExt
  : monorepoExt;

const args = process.argv.slice(2);
const subcommand = args[0];

// ─── Subcommands ─────────────────────────────────────────────────────────────

if (subcommand === 'launch') {
  const { handleLaunch } = await import('./pw-launch.js');
  await handleLaunch(args.slice(1));
  process.exit(0);
}

if (subcommand === 'close') {
  const { handleClose } = await import('./pw-launch.js');
  await handleClose(args.slice(1));
  process.exit(0);
}

if (subcommand === 'repl') {
  const { handleRepl } = await import('./pw-repl.js');
  await handleRepl(args.slice(1));
  // handleRepl keeps process alive via node:repl — don't exit here
}

if (subcommand === 'repl-extension') {
  const { handleReplExtension } = await import('./pw-repl-extension.js');
  await handleReplExtension(args.slice(1));
  // handleReplExtension keeps process alive via node:repl
}

// ─── Default: test ───────────────────────────────────────────────────────────

if (args.length === 0 || (args[0] && args[0].startsWith('-'))) {
  args.unshift('test');
}

const existingNodeOptions = process.env.NODE_OPTIONS || '';
const child = spawn(process.execPath, [pwCliPath, ...args], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: {
    ...process.env,
    PW_EXT_PATH: extPath,
    NODE_OPTIONS: `${existingNodeOptions} --require ${preloadPath}`.trim(),
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
